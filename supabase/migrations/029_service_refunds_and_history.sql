-- Administrator-only service refunds and auditable service-history removal.
-- Financial and care records are retained even when a service is removed from
-- operational screens.

begin;

alter table public.client_service_requests
  add column if not exists administratively_removed_at timestamptz,
  add column if not exists administratively_removed_by uuid references public.profiles(id) on delete restrict,
  add column if not exists administrative_removal_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.client_service_requests'::regclass
      and conname = 'client_service_requests_removal_metadata_complete'
  ) then
    alter table public.client_service_requests
      add constraint client_service_requests_removal_metadata_complete check (
        (administratively_removed_at is null
          and administratively_removed_by is null
          and administrative_removal_reason is null)
        or
        (administratively_removed_at is not null
          and administratively_removed_by is not null
          and length(trim(administrative_removal_reason)) between 5 and 1000)
      );
  end if;
end;
$$;

create index if not exists client_service_requests_removed_idx
  on public.client_service_requests(administratively_removed_at desc)
  where administratively_removed_at is not null;

create table if not exists public.service_refund_transactions (
  id uuid primary key default gen_random_uuid(),
  client_service_request_id uuid not null
    references public.client_service_requests(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'COMPLETED' check (status in ('COMPLETED', 'VOIDED')),
  payment_method text not null check (length(trim(payment_method)) between 2 and 40),
  refund_reference text not null check (length(trim(refund_reference)) between 3 and 255),
  refund_reason text not null check (length(trim(refund_reason)) between 3 and 1000),
  idempotency_key text not null unique,
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  refunded_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_refund_reference_unique unique (payment_method, refund_reference)
);

create index if not exists service_refund_request_date_idx
  on public.service_refund_transactions(client_service_request_id, refunded_at desc)
  where status = 'COMPLETED';

alter table public.service_refund_transactions enable row level security;

drop policy if exists "service refunds: client or admin read"
  on public.service_refund_transactions;
create policy "service refunds: client or admin read"
on public.service_refund_transactions for select to authenticated
using (public.is_admin() or public.is_client_member(client_id));

revoke all on table public.service_refund_transactions from public;
revoke all on table public.service_refund_transactions from anon;
revoke all on table public.service_refund_transactions from authenticated;
grant select on table public.service_refund_transactions to authenticated;

comment on table public.service_refund_transactions is
  'Immutable administrator-recorded service refund events. Completed rows reduce cash-basis collection totals without rewriting the original receipt.';

create or replace function public.record_service_refund(
  p_request_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_refund_reference text,
  p_refund_reason text,
  p_refunded_on date
)
returns public.service_refund_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.client_service_requests%rowtype;
  saved_refund public.service_refund_transactions%rowtype;
  normalized_amount numeric(10,2) := round(coalesce(p_amount, 0)::numeric, 2);
  normalized_method text := upper(trim(coalesce(p_payment_method, '')));
  normalized_reference text := trim(coalesce(p_refund_reference, ''));
  normalized_reason text := trim(coalesce(p_refund_reason, ''));
  deposit_remaining numeric(10,2);
  balance_remaining numeric(10,2);
  previous_service_refunds numeric(10,2);
  refundable_available numeric(10,2);
  effective_at timestamptz;
begin
  if not public.is_admin() then
    raise exception 'Only an owner or administrator can record service refunds';
  end if;
  if normalized_amount <= 0 then
    raise exception 'The refund amount must be greater than zero';
  end if;
  if length(normalized_method) not between 2 and 40 then
    raise exception 'A valid refund method is required';
  end if;
  if length(normalized_reference) not between 3 and 255 then
    raise exception 'A valid external refund reference is required';
  end if;
  if length(normalized_reason) not between 3 and 1000 then
    raise exception 'A refund reason is required';
  end if;
  if p_refunded_on is null or p_refunded_on > current_date then
    raise exception 'The refund date cannot be in the future';
  end if;

  select request.* into request_row
  from public.client_service_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Service request not found';
  end if;

  select coalesce(sum(
    case
      when deposit.status = 'CAPTURED' then deposit.amount
      when deposit.status = 'REFUNDED' then greatest(deposit.amount - coalesce(deposit.refunded_amount, 0), 0)
      else 0
    end
  ), 0)::numeric(10,2)
  into deposit_remaining
  from public.deposit_transactions deposit
  where deposit.client_service_request_id = request_row.id;

  select coalesce(sum(
    case
      when balance.status = 'CAPTURED' then balance.amount
      when balance.status = 'REFUNDED' then greatest(balance.amount - balance.refunded_amount, 0)
      else 0
    end
  ), 0)::numeric(10,2)
  into balance_remaining
  from public.service_balance_transactions balance
  where balance.client_service_request_id = request_row.id;

  select coalesce(sum(refund.amount), 0)::numeric(10,2)
  into previous_service_refunds
  from public.service_refund_transactions refund
  where refund.client_service_request_id = request_row.id
    and refund.status = 'COMPLETED';

  refundable_available := greatest(
    deposit_remaining + balance_remaining - previous_service_refunds,
    0
  );

  if refundable_available <= 0 then
    raise exception 'This service request has no refundable collected amount';
  end if;
  if normalized_amount > refundable_available then
    raise exception 'The refund amount exceeds the refundable collected amount';
  end if;

  effective_at := public.payment_effective_timestamp(p_refunded_on);

  insert into public.service_refund_transactions (
    client_service_request_id,
    client_id,
    amount,
    currency,
    status,
    payment_method,
    refund_reference,
    refund_reason,
    idempotency_key,
    recorded_by,
    refunded_at
  ) values (
    request_row.id,
    request_row.client_id,
    normalized_amount,
    'USD',
    'COMPLETED',
    normalized_method,
    normalized_reference,
    normalized_reason,
    'service-refund:' || request_row.id::text || ':' || encode(
      digest(normalized_method || ':' || normalized_reference, 'sha256'),
      'hex'
    ),
    auth.uid(),
    effective_at
  )
  returning * into saved_refund;

  if request_row.deposit_status = 'REFUND_DUE'
     and previous_service_refunds + normalized_amount >= deposit_remaining then
    update public.client_service_requests
    set deposit_status = 'REFUNDED', updated_at = now()
    where id = request_row.id;

    if request_row.approved_assignment_id is not null then
      update public.care_assignments
      set deposit_status = 'REFUNDED', updated_at = now()
      where id = request_row.approved_assignment_id;
    end if;
  end if;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'RECORD_SERVICE_REFUND',
    'service_refund_transactions',
    saved_refund.id,
    jsonb_build_object(
      'client_service_request_id', request_row.id,
      'amount', saved_refund.amount,
      'currency', saved_refund.currency,
      'payment_method', saved_refund.payment_method,
      'refund_reference', saved_refund.refund_reference,
      'refund_reason', saved_refund.refund_reason,
      'refundable_before_refund', refundable_available,
      'refundable_after_refund', greatest(refundable_available - normalized_amount, 0),
      'refunded_on', p_refunded_on
    )
  );

  return saved_refund;
exception
  when unique_violation then
    raise exception 'This refund reference has already been recorded';
end;
$$;

revoke all on function public.record_service_refund(
  uuid, numeric, text, text, text, date
) from public;
revoke all on function public.record_service_refund(
  uuid, numeric, text, text, text, date
) from anon;
grant execute on function public.record_service_refund(
  uuid, numeric, text, text, text, date
) to authenticated;

create or replace function public.admin_archive_service_request(
  p_request_id uuid,
  p_reason text
)
returns public.client_service_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.client_service_requests%rowtype;
  target_assignment_id uuid;
  target_contract_id uuid;
  normalized_reason text := trim(coalesce(p_reason, ''));
  previous_status public.client_request_status;
begin
  if not public.is_admin() then
    raise exception 'Only an owner or administrator can remove service history';
  end if;
  if length(normalized_reason) not between 5 and 1000 then
    raise exception 'A detailed service removal reason is required';
  end if;

  select request.* into request_row
  from public.client_service_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Service request not found';
  end if;
  if request_row.administratively_removed_at is not null then
    return request_row;
  end if;

  target_assignment_id := request_row.approved_assignment_id;
  previous_status := request_row.status;

  if target_assignment_id is not null then
    if exists (
      select 1
      from public.care_sessions session
      where session.assignment_id = target_assignment_id
        and session.status = 'IN_PROGRESS'
    ) then
      raise exception 'An in-progress care session must be completed or cancelled before removing the service';
    end if;

    select assignment.contract_id into target_contract_id
    from public.care_assignments assignment
    where assignment.id = target_assignment_id
    for update;

    update public.care_sessions
    set status = 'CANCELLED', updated_at = now()
    where assignment_id = target_assignment_id
      and status = 'SCHEDULED';

    update public.care_assignments
    set status = case when status = 'COMPLETED' then status else 'CANCELLED' end,
        cancelled_at = case when status = 'COMPLETED' then cancelled_at else coalesce(cancelled_at, now()) end,
        cancelled_by = case when status = 'COMPLETED' then cancelled_by else auth.uid() end,
        cancellation_reason = case when status = 'COMPLETED' then cancellation_reason else normalized_reason end,
        updated_by = auth.uid(),
        updated_at = now()
    where id = target_assignment_id;

    if target_contract_id is not null then
      update public.care_contracts
      set status = case when status = 'COMPLETED' then status else 'CANCELLED' end,
          updated_at = now()
      where id = target_contract_id;
    end if;
  end if;

  update public.service_adjustment_requests
  set status = 'REJECTED',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = '관리자 서비스 삭제로 자동 종료: ' || normalized_reason,
      updated_at = now()
  where status = 'PENDING'
    and (
      client_service_request_id = request_row.id
      or (target_assignment_id is not null and care_assignment_id = target_assignment_id)
    );

  update public.client_service_requests
  set status = 'CANCELLED'::public.client_request_status,
      administratively_removed_at = now(),
      administratively_removed_by = auth.uid(),
      administrative_removal_reason = normalized_reason,
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'ADMIN_ARCHIVE_SERVICE_REQUEST',
    'client_service_requests',
    request_row.id,
    jsonb_build_object(
      'previous_status', previous_status,
      'service_type', request_row.service_type,
      'client_id', request_row.client_id,
      'approved_assignment_id', target_assignment_id,
      'removal_reason', normalized_reason,
      'financial_records_retained', true,
      'care_records_retained', true
    )
  );

  return request_row;
end;
$$;

revoke all on function public.admin_archive_service_request(uuid, text) from public;
revoke all on function public.admin_archive_service_request(uuid, text) from anon;
grant execute on function public.admin_archive_service_request(uuid, text) to authenticated;

comment on function public.admin_archive_service_request(uuid, text) is
  'Soft-removes a service from operations while retaining care, financial, and audit history. In-progress sessions must be closed first.';

notify pgrst, 'reload schema';

commit;
