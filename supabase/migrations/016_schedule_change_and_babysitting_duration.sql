-- Separate schedule changes from cancellation penalties.
-- Babysitting duration is represented by daily_end_time - daily_start_time;
-- customer and staff UIs collect start time plus a minimum four-hour duration.

alter table public.service_adjustment_requests
  drop constraint if exists service_adjustment_requests_policy_code_check;

alter table public.service_adjustment_requests
  add constraint service_adjustment_requests_policy_code_check
  check (policy_code in (
    'SCHEDULE_CHANGE_NO_DEPOSIT_PENALTY',
    'DEPOSIT_REFUNDABLE',
    'DEPOSIT_NON_REFUNDABLE',
    'POSTPARTUM_ACTIVE_PRORATED',
    'BABYSITTING_DEPOSIT_REFUNDABLE',
    'BABYSITTING_DEPOSIT_NON_REFUNDABLE',
    'STANDARD_NOTICE',
    'LATE_NOTICE',
    'SHORT_NOTICE'
  ));

comment on column public.service_adjustment_requests.policy_code is
  'Schedule changes never alter the deposit. Cancellation-only codes determine refund, non-refund, or started-service settlement.';

comment on column public.client_service_requests.daily_end_time is
  'For babysitting, calculated from the selected start time plus customer-selected care duration of at least four hours.';
