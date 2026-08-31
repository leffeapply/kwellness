-- Auditable customer change/cancellation requests and deposit protection rules.
-- Apply after 011_babysitting_minimum_booking.sql.

alter table public.client_service_requests
  add column if not exists request_kind text not null default 'NEW'
    check (request_kind in ('NEW', 'EXTENSION')),
  add column if not exists deposit_amount numeric(10,2),
  add column if not exists deposit_status text
    check (deposit_status is null or deposit_status in ('DUE_ON_APPROVAL', 'PAID', 'REFUND_DUE', 'REFUNDED', 'NON_REFUNDABLE')),
  add column if not exists deposit_paid_at timestamptz;

alter table public.care_assignments
  add column if not exists deposit_amount numeric(10,2),
  add column if not exists deposit_status text
    check (deposit_status is null or deposit_status in ('DUE_ON_APPROVAL', 'PAID', 'REFUND_DUE', 'REFUNDED', 'NON_REFUNDABLE')),
  add column if not exists deposit_paid_at timestamptz;

update public.client_service_requests
set deposit_amount = 500.00,
    deposit_status = 'PAID',
    deposit_paid_at = coalesce(deposit_paid_at, reviewed_at, created_at)
where service_type = 'POSTPARTUM'
  and status = 'APPROVED'
  and deposit_status is distinct from 'PAID';

create or replace function public.enforce_postpartum_deposit_before_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.service_type = 'POSTPARTUM' and new.status = 'APPROVED' then
    if new.deposit_amount <> 500.00 or new.deposit_status <> 'PAID' or new.deposit_paid_at is null then
      raise exception 'Postpartum service requires a confirmed $500 deposit before approval';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_postpartum_deposit_before_approval_trigger
  on public.client_service_requests;

create trigger enforce_postpartum_deposit_before_approval_trigger
before insert or update of status, deposit_amount, deposit_status, deposit_paid_at
on public.client_service_requests
for each row execute function public.enforce_postpartum_deposit_before_approval();

create table public.service_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  service_type public.care_service_type not null,
  client_service_request_id uuid references public.client_service_requests(id) on delete cascade,
  care_assignment_id uuid references public.care_assignments(id) on delete cascade,
  action text not null check (action in ('CHANGE', 'CANCEL')),
  proposed_start_date date,
  proposed_daily_start_time time,
  proposed_daily_end_time time,
  proposed_weeks integer check (proposed_weeks is null or proposed_weeks in (2, 3, 4)),
  reason text not null check (length(trim(reason)) > 0),
  policy_code text not null check (policy_code in ('DEPOSIT_REFUNDABLE', 'DEPOSIT_NON_REFUNDABLE', 'STANDARD_NOTICE', 'LATE_NOTICE', 'SHORT_NOTICE')),
  policy_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint one_adjustment_target check (
    (client_service_request_id is not null and care_assignment_id is null)
    or (client_service_request_id is null and care_assignment_id is not null)
  ),
  constraint complete_change_schedule check (
    action = 'CANCEL'
    or (
      proposed_start_date is not null
      and proposed_daily_start_time is not null
      and proposed_daily_end_time is not null
      and proposed_daily_end_time > proposed_daily_start_time
      and proposed_weeks is not null
    )
  ),
  constraint babysitting_adjustment_minimum_four_hours check (
    action = 'CANCEL'
    or service_type <> 'BABYSITTING'
    or proposed_daily_end_time - proposed_daily_start_time >= interval '4 hours'
  )
);

create unique index one_pending_adjustment_per_request
  on public.service_adjustment_requests(client_service_request_id)
  where status = 'PENDING' and client_service_request_id is not null;

create unique index one_pending_adjustment_per_assignment
  on public.service_adjustment_requests(care_assignment_id)
  where status = 'PENDING' and care_assignment_id is not null;

create index service_adjustment_review_queue
  on public.service_adjustment_requests(status, created_at);

alter table public.service_adjustment_requests enable row level security;

create policy "service adjustments: family or staff read"
on public.service_adjustment_requests for select to authenticated
using (public.is_care_staff() or public.is_client_member(client_id));

create policy "service adjustments: family create pending"
on public.service_adjustment_requests for insert to authenticated
with check (
  requested_by = auth.uid()
  and status = 'PENDING'
  and public.is_client_member(client_id)
);

create policy "service adjustments: staff review"
on public.service_adjustment_requests for update to authenticated
using (public.is_care_staff())
with check (public.is_care_staff());

comment on table public.service_adjustment_requests is
  'Customer requests never mutate approved service dates directly. Care staff reviews policy, caregiver availability, and service sequence before applying a change or cancellation.';

comment on column public.service_adjustment_requests.policy_snapshot is
  'Immutable request-time snapshot: postpartum $500 deposit and 30-day refund cutoff, or babysitting 72/24-hour caregiver protection tier.';
