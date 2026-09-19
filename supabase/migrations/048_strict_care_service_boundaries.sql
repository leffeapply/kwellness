-- Keep postpartum and babysitting history permanently attached to its original service type.

create or replace function public.enforce_care_event_service_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_service_type text;
begin
  select assignment.service_type::text
  into target_service_type
  from public.care_sessions session
  join public.care_assignments assignment on assignment.id = session.assignment_id
  where session.id = new.care_session_id;

  if target_service_type is null then
    raise exception 'Care session assignment not found';
  end if;

  if target_service_type = 'BABYSITTING'
     and new.event_type not in ('MEAL', 'SITTER_NOTE') then
    raise exception 'Babysitting sessions accept only meal and activity-note events';
  elsif target_service_type = 'POSTPARTUM'
     and new.event_type not in (
       'FEEDING', 'DIAPER', 'SLEEP', 'TEMPERATURE',
       'BATH', 'WEIGHT', 'MOTHER_CARE', 'NOTE'
     ) then
    raise exception 'Postpartum sessions do not accept babysitting event types';
  elsif target_service_type not in ('POSTPARTUM', 'BABYSITTING') then
    raise exception 'This service type does not accept care log events';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_care_event_service_scope_trigger on public.care_events;
create trigger enforce_care_event_service_scope_trigger
before insert or update of care_session_id, event_type
on public.care_events
for each row execute function public.enforce_care_event_service_scope();

create or replace function public.prevent_care_assignment_service_type_history_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.service_type is distinct from new.service_type
     and exists (
       select 1
       from public.care_sessions session
       where session.assignment_id = old.id
     ) then
    raise exception 'Service type cannot be changed after care history has started';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_care_assignment_service_type_history_change_trigger on public.care_assignments;
create trigger prevent_care_assignment_service_type_history_change_trigger
before update of service_type
on public.care_assignments
for each row execute function public.prevent_care_assignment_service_type_history_change();

revoke all on function public.enforce_care_event_service_scope() from public, anon, authenticated;
revoke all on function public.prevent_care_assignment_service_type_history_change() from public, anon, authenticated;
