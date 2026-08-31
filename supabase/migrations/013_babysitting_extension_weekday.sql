-- Babysitting extensions start on the first weekday after the latest booking ends.
-- Apply after 012_service_changes_cancellations.sql.

create or replace function public.enforce_babysitting_extension_weekday()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  latest_end_date date;
  required_start_date date;
begin
  if new.request_kind <> 'EXTENSION' or new.service_type <> 'BABYSITTING' or new.status = 'CANCELLED' then
    return new;
  end if;

  select max(existing_booking.end_date)
  into latest_end_date
  from (
    select request.desired_start_date + (request.requested_weeks * 7 - 1) as end_date
    from public.client_service_requests request
    where request.client_id = new.client_id
      and request.id <> new.id
      and request.service_type = 'BABYSITTING'
      and request.status in ('PENDING', 'APPROVED')
      and request.approved_assignment_id is null

    union all

    select assignment.ends_at::date as end_date
    from public.care_assignments assignment
    join public.care_contracts contract on contract.id = assignment.contract_id
    where contract.client_id = new.client_id
      and assignment.service_type = 'BABYSITTING'
      and assignment.status <> 'CANCELLED'
      and (new.approved_assignment_id is null or assignment.id <> new.approved_assignment_id)
  ) existing_booking;

  if latest_end_date is null then
    raise exception 'A babysitting extension requires an existing babysitting booking';
  end if;

  required_start_date := latest_end_date + 1;
  while extract(isodow from required_start_date) in (6, 7) loop
    required_start_date := required_start_date + 1;
  end loop;

  if new.desired_start_date <> required_start_date then
    raise exception 'Babysitting extension must start on the first weekday after the existing booking ends: %', required_start_date;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_babysitting_extension_weekday_trigger
  on public.client_service_requests;

create trigger enforce_babysitting_extension_weekday_trigger
before insert or update of request_kind, service_type, desired_start_date, requested_weeks, status, approved_assignment_id
on public.client_service_requests
for each row execute function public.enforce_babysitting_extension_weekday();

comment on function public.enforce_babysitting_extension_weekday() is
  'Prevents gaps caused only by weekends: an extension starts Monday when the preceding booking ends Friday, Saturday, or Sunday.';
