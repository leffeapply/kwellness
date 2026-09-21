-- Daily client instructions for an active postpartum or babysitting assignment.
-- Clients can save one request per assignment and device-local calendar day;
-- the assigned caregiver sees it alongside the original assignment brief.

begin;

create table if not exists public.client_daily_requests (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.care_assignments(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  request_date date not null,
  request_text text not null check (char_length(btrim(request_text)) between 1 and 500),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, request_date)
);

create index if not exists client_daily_requests_client_date_idx
  on public.client_daily_requests(client_id, request_date desc);

alter table public.client_daily_requests enable row level security;

revoke all on table public.client_daily_requests from public, anon, authenticated;
grant select on table public.client_daily_requests to authenticated;

drop policy if exists "daily requests: assignment participants read" on public.client_daily_requests;
create policy "daily requests: assignment participants read"
on public.client_daily_requests
for select to authenticated
using (public.can_read_care_assignment(assignment_id));

create or replace function public.save_client_daily_request(
  p_assignment_id uuid,
  p_request_date date,
  p_request_text text,
  p_time_zone text default 'America/New_York'
)
returns public.client_daily_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  target_assignment public.care_assignments%rowtype;
  target_contract public.care_contracts%rowtype;
  saved_request public.client_daily_requests%rowtype;
  requested_time_zone text := trim(coalesce(nullif(p_time_zone, ''), 'America/New_York'));
  effective_time_zone text;
  local_today date;
  normalized_request text := btrim(coalesce(p_request_text, ''));
begin
  if auth.uid() is null or not public.account_is_active() then
    raise exception 'An active signed-in account is required';
  end if;
  if p_assignment_id is null or p_request_date is null then
    raise exception 'Assignment and request date are required';
  end if;
  if char_length(normalized_request) not between 1 and 500 then
    raise exception 'Daily request must contain between 1 and 500 characters';
  end if;

  select zone.name
  into effective_time_zone
  from pg_catalog.pg_timezone_names zone
  where lower(zone.name) = lower(requested_time_zone)
  order by (zone.name = requested_time_zone) desc, zone.name
  limit 1;

  if effective_time_zone is null then
    raise exception 'Unsupported device time zone';
  end if;

  local_today := (now() at time zone effective_time_zone)::date;
  if p_request_date <> local_today then
    raise exception 'Daily requests may be saved only for the current device-local date';
  end if;

  select assignment.*
  into target_assignment
  from public.care_assignments assignment
  where assignment.id = p_assignment_id
  for update;

  if not found then
    raise exception 'Care assignment not found';
  end if;

  select contract.*
  into target_contract
  from public.care_contracts contract
  where contract.id = target_assignment.contract_id;

  if not found
     or not public.is_client_member(target_contract.client_id)
     or target_assignment.status <> 'CONFIRMED'
     or target_assignment.service_type::text not in ('POSTPARTUM', 'BABYSITTING')
     or local_today not between target_contract.start_date and target_contract.end_date then
    raise exception 'Only the assigned client can save a request during the confirmed service period';
  end if;

  insert into public.client_daily_requests (
    assignment_id,
    client_id,
    request_date,
    request_text,
    created_by,
    updated_by
  ) values (
    target_assignment.id,
    target_contract.client_id,
    local_today,
    normalized_request,
    auth.uid(),
    auth.uid()
  )
  on conflict (assignment_id, request_date) do update
  set request_text = excluded.request_text,
      updated_by = auth.uid(),
      updated_at = now()
  returning * into saved_request;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'SAVE_CLIENT_DAILY_REQUEST',
    'client_daily_requests',
    saved_request.id,
    jsonb_build_object(
      'assignment_id', target_assignment.id,
      'client_id', target_contract.client_id,
      'request_date', local_today,
      'service_type', target_assignment.service_type
    )
  );

  return saved_request;
end;
$$;

revoke all on function public.save_client_daily_request(uuid, date, text, text) from public;
revoke all on function public.save_client_daily_request(uuid, date, text, text) from anon;
grant execute on function public.save_client_daily_request(uuid, date, text, text) to authenticated;

comment on table public.client_daily_requests is
  'One editable client request per care assignment and device-local service date.';
comment on function public.save_client_daily_request(uuid, date, text, text) is
  'Allows the client family on a confirmed active care assignment to save or revise today''s request for the assigned caregiver.';

notify pgrst, 'reload schema';

commit;
