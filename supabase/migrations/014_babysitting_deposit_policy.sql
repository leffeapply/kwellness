-- Unify babysitting reservation protection around one four-hour deposit.
-- Hourly rate: $32; deposit: $128. Cancellation more than 72 hours
-- before service is refundable; cancellation at or within 72 hours and
-- no-shows are non-refundable.

alter table public.service_adjustment_requests
  drop constraint if exists service_adjustment_requests_policy_code_check;

alter table public.service_adjustment_requests
  add constraint service_adjustment_requests_policy_code_check
  check (policy_code in (
    'DEPOSIT_REFUNDABLE',
    'DEPOSIT_NON_REFUNDABLE',
    'BABYSITTING_DEPOSIT_REFUNDABLE',
    'BABYSITTING_DEPOSIT_NON_REFUNDABLE',
    'STANDARD_NOTICE',
    'LATE_NOTICE',
    'SHORT_NOTICE'
  ));

update public.client_service_requests
set deposit_amount = 128.00,
    deposit_status = 'PAID',
    deposit_paid_at = coalesce(deposit_paid_at, reviewed_at, created_at)
where service_type = 'BABYSITTING'
  and status = 'APPROVED'
  and (
    deposit_amount is distinct from 128.00
    or deposit_status is distinct from 'PAID'
    or deposit_paid_at is null
  );

update public.care_assignments
set deposit_amount = 128.00,
    deposit_status = 'PAID',
    deposit_paid_at = coalesce(deposit_paid_at, created_at)
where service_type = 'BABYSITTING'
  and status in ('PROPOSED', 'CONFIRMED', 'COMPLETED')
  and (
    deposit_amount is distinct from 128.00
    or deposit_status is distinct from 'PAID'
    or deposit_paid_at is null
  );

create or replace function public.enforce_service_deposit_before_approval()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  required_deposit numeric(10,2);
begin
  if new.status <> 'APPROVED' then
    return new;
  end if;

  required_deposit := case new.service_type
    when 'POSTPARTUM' then 500.00
    when 'BABYSITTING' then 128.00
    else null
  end;

  if required_deposit is not null and (
    new.deposit_amount is distinct from required_deposit
    or new.deposit_status is distinct from 'PAID'
    or new.deposit_paid_at is null
  ) then
    raise exception '% service requires a confirmed $% deposit before approval',
      new.service_type,
      required_deposit;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_postpartum_deposit_before_approval_trigger
  on public.client_service_requests;
drop trigger if exists enforce_service_deposit_before_approval_trigger
  on public.client_service_requests;

create trigger enforce_service_deposit_before_approval_trigger
before insert or update of status, service_type, deposit_amount, deposit_status, deposit_paid_at
on public.client_service_requests
for each row execute function public.enforce_service_deposit_before_approval();

comment on column public.service_adjustment_requests.policy_snapshot is
  'Immutable request-time snapshot: postpartum $500 deposit and 30-day cutoff, or babysitting $128 four-hour deposit with a strict 72-hour cancellation cutoff.';
