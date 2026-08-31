-- Prevent overlapping contracts for the same client and keep assignment deletion safe.
-- Apply after 004_client_requests_monthly_schedule.sql.

create or replace function public.prevent_overlapping_client_contracts()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status not in ('CANCELLED', 'COMPLETED') and exists (
    select 1
    from public.care_contracts existing
    where existing.client_id = new.client_id
      and existing.id <> new.id
      and existing.status not in ('CANCELLED', 'COMPLETED')
      and daterange(existing.start_date, existing.end_date, '[]')
          && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'This client already has a contract during the requested period';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_overlapping_client_contracts_trigger
  on public.care_contracts;

create trigger prevent_overlapping_client_contracts_trigger
before insert or update of client_id, start_date, end_date, status
on public.care_contracts
for each row execute function public.prevent_overlapping_client_contracts();

alter table public.client_service_requests
  drop constraint if exists client_service_requests_approved_assignment_id_fkey;

alter table public.client_service_requests
  add constraint client_service_requests_approved_assignment_id_fkey
  foreign key (approved_assignment_id)
  references public.care_assignments(id)
  on delete set null;

create or replace function public.delete_care_assignment(target_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_contract_id uuid;
begin
  if not public.is_care_staff() then
    raise exception 'Only care administrators can delete assignments';
  end if;

  select contract_id into target_contract_id
  from public.care_assignments
  where id = target_assignment_id
  for update;

  if not found then
    raise exception 'Assignment not found';
  end if;

  insert into public.audit_logs(actor_id, action, table_name, record_id)
  values (auth.uid(), 'DELETE_ASSIGNMENT', 'care_assignments', target_assignment_id);

  delete from public.care_sessions where assignment_id = target_assignment_id;
  delete from public.care_assignments where id = target_assignment_id;

  if not exists (
    select 1 from public.care_assignments where contract_id = target_contract_id
  ) then
    delete from public.care_contracts where id = target_contract_id;
  end if;
end;
$$;

-- The app must call delete_care_assignment() only after the administrator
-- confirms the destructive action in the second confirmation dialog.
