-- Public-site service applications and distinct postpartum/babysitting workflows.
-- Apply after 007_care_trends_reviews.sql.

create type public.care_service_type as enum ('POSTPARTUM', 'BABYSITTING');

alter table public.client_service_requests
  add column service_type public.care_service_type not null default 'POSTPARTUM',
  add column requested_days text[] not null default array['월', '화', '수', '목', '금'],
  add column maternal_notes text,
  add column meal_instructions text,
  add column routine_notes text,
  add column pickup_notes text;

alter table public.client_service_requests
  drop constraint if exists client_service_requests_requested_weeks_check;

alter table public.client_service_requests
  add constraint client_service_requests_requested_weeks_check
  check (requested_weeks in (1, 2, 3, 4));

alter table public.care_assignments
  add column service_type public.care_service_type not null default 'POSTPARTUM',
  add column service_days text[] not null default array['월', '화', '수', '목', '금'],
  add column maternal_notes text,
  add column meal_instructions text,
  add column routine_notes text,
  add column pickup_notes text;

create index care_assignments_service_type_time_idx
  on public.care_assignments(service_type, starts_at, ends_at);

create or replace function public.sync_approved_request_service_details()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'APPROVED' and new.approved_assignment_id is not null then
    update public.care_assignments
    set service_type = new.service_type,
        service_days = new.requested_days,
        maternal_notes = new.maternal_notes,
        meal_instructions = new.meal_instructions,
        routine_notes = new.routine_notes,
        pickup_notes = new.pickup_notes,
        updated_at = now()
    where id = new.approved_assignment_id;
  end if;
  return new;
end;
$$;

create trigger sync_approved_request_service_details_trigger
after insert or update of status, approved_assignment_id on public.client_service_requests
for each row execute function public.sync_approved_request_service_details();

alter table public.care_events
  drop constraint if exists care_events_event_type_check;

alter table public.care_events
  add constraint care_events_event_type_check
  check (event_type in (
    'FEEDING', 'DIAPER', 'SLEEP', 'TEMPERATURE', 'BATH', 'WEIGHT',
    'MOTHER_CARE', 'NOTE', 'MEAL', 'SITTER_NOTE'
  ));

comment on column public.care_assignments.service_type is
  'Controls the role-specific workspace: postpartum clinical-style observations or simplified babysitting events.';

comment on column public.client_service_requests.requested_days is
  'Customer-selected recurring weekdays within the requested contract period.';
