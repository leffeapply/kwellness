-- Enforce the two-week minimum in every service request and assignment path.
-- Apply after 009_service_sequence_insured_staffing.sql.

update public.client_service_requests
set requested_weeks = 2,
    estimated_total = case
      when service_type = 'POSTPARTUM' then 3600.00
      else estimated_total
    end
where requested_weeks < 2;

alter table public.client_service_requests
  drop constraint if exists client_service_requests_requested_weeks_check;

alter table public.client_service_requests
  add constraint client_service_requests_requested_weeks_check
  check (requested_weeks in (2, 3, 4));

update public.care_assignments
set contract_weeks = 2,
    ends_at = ends_at + interval '7 days',
    weekly_rate = case
      when service_type = 'POSTPARTUM' then 1800.00
      else weekly_rate
    end,
    contract_value = case
      when service_type = 'POSTPARTUM' then 3600.00
      else contract_value
    end
where contract_weeks < 2;

alter table public.care_assignments
  drop constraint if exists care_assignments_contract_weeks_check;

alter table public.care_assignments
  add constraint care_assignments_contract_weeks_check
  check (contract_weeks in (2, 3, 4));

comment on constraint client_service_requests_requested_weeks_check
  on public.client_service_requests is
  'Customer service requests require a minimum two-week term.';

comment on constraint care_assignments_contract_weeks_check
  on public.care_assignments is
  'Administrator-created care assignments require a minimum two-week term.';
