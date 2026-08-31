-- Babysitting requires at least four hours per day and a continuous two-week term.
-- Apply after 010_minimum_two_week_service.sql.

update public.client_service_requests
set daily_start_time = least(daily_start_time, time '19:45'),
    daily_end_time = least(daily_start_time, time '19:45') + interval '4 hours'
where service_type = 'BABYSITTING'
  and daily_end_time - daily_start_time < interval '4 hours';

alter table public.client_service_requests
  drop constraint if exists babysitting_request_minimum_four_hours;

alter table public.client_service_requests
  add constraint babysitting_request_minimum_four_hours
  check (
    service_type <> 'BABYSITTING'
    or (
      daily_start_time <= time '19:45'
      and daily_end_time - daily_start_time >= interval '4 hours'
    )
  );

update public.care_assignments
set daily_start_time = least(daily_start_time, time '19:45'),
    daily_end_time = least(daily_start_time, time '19:45') + interval '4 hours'
where service_type = 'BABYSITTING'
  and daily_start_time is not null
  and daily_end_time is not null
  and daily_end_time - daily_start_time < interval '4 hours';

alter table public.care_assignments
  drop constraint if exists babysitting_assignment_minimum_four_hours;

alter table public.care_assignments
  add constraint babysitting_assignment_minimum_four_hours
  check (
    service_type <> 'BABYSITTING'
    or daily_start_time is null
    or daily_end_time is null
    or (
      daily_start_time <= time '19:45'
      and daily_end_time - daily_start_time >= interval '4 hours'
    )
  );

comment on constraint babysitting_request_minimum_four_hours
  on public.client_service_requests is
  'Babysitting requests require at least four same-day hours and at least two consecutive weeks.';

comment on constraint babysitting_assignment_minimum_four_hours
  on public.care_assignments is
  'Administrator babysitting assignments require at least four same-day hours and at least two consecutive weeks.';
