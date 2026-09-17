begin;

-- Owner-approved service discounts are contract adjustments, not cash events.
-- They reduce the amount still due while remaining separate from revenue.
alter table public.client_service_requests
  add column if not exists owner_discount_amount numeric(10,2) not null default 0,
  add column if not exists owner_discount_reason text,
  add column if not exists owner_discounted_by uuid references public.profiles(id) on delete restrict,
  add column if not exists owner_discounted_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'client_service_requests_owner_discount_valid'
      and conrelid = 'public.client_service_requests'::regclass
  ) then
    alter table public.client_service_requests
      add constraint client_service_requests_owner_discount_valid
      check (
        owner_discount_amount >= 0
        and (
          owner_discount_amount = 0
          or (
            length(trim(coalesce(owner_discount_reason, ''))) between 3 and 500
            and owner_discounted_by is not null
            and owner_discounted_at is not null
          )
        )
      );
  end if;
end;
$$;

comment on column public.client_service_requests.owner_discount_amount is
  'Cumulative owner-approved contract discount. This is not cash revenue.';
comment on column public.client_service_requests.owner_discount_reason is
  'Latest owner-entered reason for the cumulative contract discount.';

-- Save the four required pre-shift confirmations in one atomic request. The
-- routine accepts only a fully completed checklist and never exposes an
-- uncheck operation.
create or replace function public.save_care_shift_checklist(
  p_assignment_id uuid,
  p_checks jsonb,
  p_service_date date default null,
  p_time_zone text default 'America/New_York'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  required_checks constant jsonb := jsonb_build_object(
    'arrival', true,
    'safety', true,
    'request', true,
    'scope', true
  );
  check_key text;
  saved_check public.care_shift_checks%rowtype;
  saved_rows jsonb := '[]'::jsonb;
begin
  if p_checks is null
     or jsonb_typeof(p_checks) <> 'object'
     or p_checks <> required_checks then
    raise exception 'Complete all four safety checks before saving';
  end if;

  foreach check_key in array array['arrival', 'safety', 'request', 'scope']
  loop
    saved_check := public.set_care_shift_check(
      p_assignment_id,
      check_key,
      true,
      p_service_date,
      p_time_zone
    );
    saved_rows := saved_rows || jsonb_build_array(to_jsonb(saved_check));
  end loop;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'COMPLETE_CARE_SHIFT_CHECKLIST',
    'care_assignments',
    p_assignment_id,
    jsonb_build_object(
      'service_date', coalesce(p_service_date, (now() at time zone p_time_zone)::date),
      'time_zone', p_time_zone,
      'check_keys', jsonb_build_array('arrival', 'safety', 'request', 'scope')
    )
  );

  return jsonb_build_object(
    'assignment_id', p_assignment_id,
    'completed', true,
    'checks', saved_rows
  );
end;
$$;

revoke all on function public.save_care_shift_checklist(uuid, jsonb, date, text) from public;
revoke all on function public.save_care_shift_checklist(uuid, jsonb, date, text) from anon;
grant execute on function public.save_care_shift_checklist(uuid, jsonb, date, text) to authenticated;

-- Rebuild balance recording with the owner discount included in the amount
-- due. The previous implementation also failed at runtime because pgcrypto's
-- digest() lived in the extensions schema while the function search_path only
-- contained public.
create or replace function public.record_service_balance_payment(
  p_request_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_reference text
)
returns public.service_balance_transactions
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  request_row public.client_service_requests%rowtype;
  result_row public.service_balance_transactions%rowtype;
  normalized_method text := upper(trim(coalesce(p_payment_method, '')));
  normalized_reference text := trim(coalesce(p_payment_reference, ''));
  normalized_amount numeric(10,2) := round(coalesce(p_amount, 0)::numeric, 2);
  expected_total numeric(10,2);
  deposit_net numeric(10,2);
  balance_net numeric(10,2);
  discount_total numeric(10,2);
  outstanding numeric(10,2);
begin
  if not public.is_admin() then
    raise exception 'Only an owner or administrator can record service payments';
  end if;
  if length(normalized_method) not between 2 and 40 then
    raise exception 'A valid payment method is required';
  end if;
  if length(normalized_reference) not between 3 and 255 then
    raise exception 'A valid external payment reference is required';
  end if;
  if normalized_amount <= 0 then
    raise exception 'The received amount must be greater than zero';
  end if;

  select request.* into request_row
  from public.client_service_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Service request not found';
  end if;
  if request_row.status <> 'APPROVED' then
    raise exception 'Only an approved service request can receive a balance payment';
  end if;

  expected_total := public.service_request_expected_total(request_row.id);
  if expected_total <= 0 then
    raise exception 'The approved request does not have a valid service total';
  end if;

  if coalesce(request_row.estimated_total, 0) <= 0 then
    update public.client_service_requests
    set estimated_total = expected_total,
        updated_at = now()
    where id = request_row.id;
  end if;

  select coalesce(sum(
    case
      when deposit.status = 'CAPTURED' then deposit.amount
      when deposit.status = 'REFUNDED' then greatest(deposit.amount - coalesce(deposit.refunded_amount, 0), 0)
      else 0
    end
  ), 0)::numeric(10,2)
  into deposit_net
  from public.deposit_transactions deposit
  where deposit.client_service_request_id = request_row.id;

  if deposit_net <= 0 then
    raise exception 'Captured reservation-deposit evidence is required before recording a balance payment';
  end if;

  select coalesce(sum(
    case
      when balance.status = 'CAPTURED' then balance.amount
      when balance.status = 'REFUNDED' then greatest(balance.amount - balance.refunded_amount, 0)
      else 0
    end
  ), 0)::numeric(10,2)
  into balance_net
  from public.service_balance_transactions balance
  where balance.client_service_request_id = request_row.id;

  discount_total := greatest(coalesce(request_row.owner_discount_amount, 0), 0);
  outstanding := greatest(expected_total - discount_total - deposit_net - balance_net, 0);
  if outstanding <= 0 then
    raise exception 'This service request has no outstanding balance';
  end if;
  if normalized_amount > outstanding then
    raise exception 'The received amount exceeds the outstanding balance';
  end if;

  insert into public.service_balance_transactions (
    client_service_request_id,
    client_id,
    amount,
    currency,
    status,
    payment_method,
    external_reference,
    idempotency_key,
    recorded_by,
    captured_at
  ) values (
    request_row.id,
    request_row.client_id,
    normalized_amount,
    'USD',
    'CAPTURED',
    normalized_method,
    normalized_reference,
    'service-balance:' || request_row.id::text || ':' || encode(
      extensions.digest(normalized_method || ':' || normalized_reference, 'sha256'::text),
      'hex'
    ),
    auth.uid(),
    now()
  )
  returning * into result_row;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'RECORD_SERVICE_BALANCE_PAYMENT',
    'service_balance_transactions',
    result_row.id,
    jsonb_build_object(
      'client_service_request_id', request_row.id,
      'amount', result_row.amount,
      'currency', result_row.currency,
      'payment_method', result_row.payment_method,
      'outstanding_before_payment', outstanding,
      'outstanding_after_payment', greatest(outstanding - result_row.amount, 0),
      'resolved_service_total', expected_total,
      'owner_discount_total', discount_total
    )
  );

  return result_row;
exception
  when unique_violation then
    raise exception 'This payment reference has already been recorded';
end;
$$;

revoke all on function public.record_service_balance_payment(uuid, numeric, text, text) from public;
revoke all on function public.record_service_balance_payment(uuid, numeric, text, text) from anon;
grant execute on function public.record_service_balance_payment(uuid, numeric, text, text) to authenticated;

-- Atomically apply an optional owner-only discount and record any real cash
-- received on the selected date. A full discount may close the balance with a
-- zero cash receipt; administrators can still record ordinary payments.
create or replace function public.settle_service_balance_payment(
  p_request_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_reference text,
  p_received_on date,
  p_discount_amount numeric default 0,
  p_discount_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  request_row public.client_service_requests%rowtype;
  saved_payment public.service_balance_transactions%rowtype;
  expected_total numeric(10,2);
  deposit_net numeric(10,2);
  balance_net numeric(10,2);
  existing_discount numeric(10,2);
  normalized_amount numeric(10,2) := round(coalesce(p_amount, 0)::numeric, 2);
  normalized_discount numeric(10,2) := round(coalesce(p_discount_amount, 0)::numeric, 2);
  normalized_reason text := trim(coalesce(p_discount_reason, ''));
  outstanding_before_discount numeric(10,2);
  outstanding_after_discount numeric(10,2);
begin
  if not public.is_admin() then
    raise exception 'Only an owner or administrator can settle service balances';
  end if;
  if normalized_amount < 0 or normalized_discount < 0 then
    raise exception 'Payment and discount amounts cannot be negative';
  end if;
  if normalized_amount = 0 and normalized_discount = 0 then
    raise exception 'Enter a received amount or an owner discount';
  end if;
  if p_received_on is null or p_received_on > current_date then
    raise exception 'The received date cannot be in the future';
  end if;
  if normalized_discount > 0 and not public.has_role('OWNER') then
    raise exception 'Only an owner can approve a service discount';
  end if;
  if normalized_discount > 0 and length(normalized_reason) not between 3 and 500 then
    raise exception 'A discount reason must contain between 3 and 500 characters';
  end if;

  select request.* into request_row
  from public.client_service_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Service request not found';
  end if;
  if request_row.status <> 'APPROVED' then
    raise exception 'Only an approved service request can be settled';
  end if;

  expected_total := public.service_request_expected_total(request_row.id);
  if expected_total <= 0 then
    raise exception 'The approved request does not have a valid service total';
  end if;

  select coalesce(sum(
    case
      when deposit.status = 'CAPTURED' then deposit.amount
      when deposit.status = 'REFUNDED' then greatest(deposit.amount - coalesce(deposit.refunded_amount, 0), 0)
      else 0
    end
  ), 0)::numeric(10,2)
  into deposit_net
  from public.deposit_transactions deposit
  where deposit.client_service_request_id = request_row.id;

  if deposit_net <= 0 then
    raise exception 'Captured reservation-deposit evidence is required before recording a balance payment';
  end if;

  select coalesce(sum(
    case
      when balance.status = 'CAPTURED' then balance.amount
      when balance.status = 'REFUNDED' then greatest(balance.amount - balance.refunded_amount, 0)
      else 0
    end
  ), 0)::numeric(10,2)
  into balance_net
  from public.service_balance_transactions balance
  where balance.client_service_request_id = request_row.id;

  existing_discount := greatest(coalesce(request_row.owner_discount_amount, 0), 0);
  outstanding_before_discount := greatest(expected_total - existing_discount - deposit_net - balance_net, 0);

  if outstanding_before_discount <= 0 then
    raise exception 'This service request has no outstanding balance';
  end if;
  if normalized_discount > outstanding_before_discount then
    raise exception 'The owner discount exceeds the outstanding balance';
  end if;

  outstanding_after_discount := outstanding_before_discount - normalized_discount;
  if normalized_amount > outstanding_after_discount then
    raise exception 'The received amount exceeds the outstanding balance after discount';
  end if;
  if normalized_amount = 0 and outstanding_after_discount > 0 then
    raise exception 'A cash receipt is required for the balance remaining after discount';
  end if;

  if normalized_discount > 0 then
    update public.client_service_requests
    set owner_discount_amount = existing_discount + normalized_discount,
        owner_discount_reason = normalized_reason,
        owner_discounted_by = auth.uid(),
        owner_discounted_at = now(),
        updated_at = now()
    where id = request_row.id;

    insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
    values (
      auth.uid(),
      'APPLY_OWNER_SERVICE_DISCOUNT',
      'client_service_requests',
      request_row.id,
      jsonb_build_object(
        'discount_amount', normalized_discount,
        'discount_total', existing_discount + normalized_discount,
        'reason', normalized_reason,
        'outstanding_before_discount', outstanding_before_discount,
        'outstanding_after_discount', outstanding_after_discount
      )
    );
  end if;

  if normalized_amount > 0 then
    saved_payment := public.record_service_balance_payment_dated(
      p_request_id,
      normalized_amount,
      p_payment_method,
      p_payment_reference,
      p_received_on
    );
  end if;

  return jsonb_build_object(
    'request_id', request_row.id,
    'payment_id', saved_payment.id,
    'received_amount', normalized_amount,
    'discount_amount', normalized_discount,
    'discount_total', existing_discount + normalized_discount,
    'outstanding_after_settlement', greatest(outstanding_after_discount - normalized_amount, 0),
    'settled', outstanding_after_discount - normalized_amount = 0
  );
end;
$$;

revoke all on function public.settle_service_balance_payment(uuid, numeric, text, text, date, numeric, text) from public;
revoke all on function public.settle_service_balance_payment(uuid, numeric, text, text, date, numeric, text) from anon;
grant execute on function public.settle_service_balance_payment(uuid, numeric, text, text, date, numeric, text) to authenticated;

-- The refund ledger used the same unqualified pgcrypto routine. Extending the
-- existing SECURITY DEFINER search path fixes that path without changing its
-- authorization or accounting rules.
alter function public.record_service_refund(uuid, numeric, text, text, text, date)
  set search_path = public, extensions;

commit;
