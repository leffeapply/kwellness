begin;

-- Resolve the service total from the same business rules used by the client.
-- Older approved requests may predate estimated_total even though their
-- contract/assignment and schedule are valid, which previously made the UI
-- show a balance that the receipt RPC refused to save.
create or replace function public.service_request_expected_total(p_request_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  request_row public.client_service_requests%rowtype;
  assignment_row public.care_assignments%rowtype;
  contract_row public.care_contracts%rowtype;
  scheduled_day_count integer;
  daily_hours numeric;
  resolved_total numeric(10,2);
begin
  select request.* into request_row
  from public.client_service_requests request
  where request.id = p_request_id;

  if not found then
    raise exception 'Service request not found';
  end if;

  if request_row.approved_assignment_id is not null then
    select assignment.* into assignment_row
    from public.care_assignments assignment
    where assignment.id = request_row.approved_assignment_id;

    if found then
      select contract.* into contract_row
      from public.care_contracts contract
      where contract.id = assignment_row.contract_id;
    end if;
  end if;

  resolved_total := round(coalesce(
    nullif(request_row.estimated_total, 0),
    nullif(assignment_row.contract_value, 0),
    nullif(contract_row.agreed_rate, 0)
  )::numeric, 2);

  if coalesce(resolved_total, 0) <= 0 and request_row.service_type = 'POSTPARTUM' then
    resolved_total := round(
      coalesce(request_row.requested_weeks, assignment_row.contract_weeks, 0)
        * coalesce(nullif(request_row.weekly_rate, 0), nullif(assignment_row.weekly_rate, 0), 1800.00),
      2
    );
  elsif coalesce(resolved_total, 0) <= 0 and request_row.service_type = 'BABYSITTING' then
    scheduled_day_count := coalesce(
      nullif(cardinality(request_row.requested_days), 0),
      nullif(cardinality(assignment_row.service_days), 0),
      0
    );
    daily_hours := extract(epoch from (
      coalesce(request_row.daily_end_time, assignment_row.daily_end_time)
        - coalesce(request_row.daily_start_time, assignment_row.daily_start_time)
    )) / 3600.0;
    resolved_total := round(
      greatest(coalesce(daily_hours, 0), 0)
        * scheduled_day_count
        * coalesce(request_row.requested_weeks, assignment_row.contract_weeks, 0)
        * 32.00,
      2
    );
  end if;

  return greatest(coalesce(resolved_total, 0), 0);
end;
$$;

revoke all on function public.service_request_expected_total(uuid) from public;
revoke all on function public.service_request_expected_total(uuid) from anon;
revoke all on function public.service_request_expected_total(uuid) from authenticated;

create or replace function public.record_service_balance_payment(
  p_request_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_reference text
)
returns public.service_balance_transactions
language plpgsql
security definer
set search_path = public
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

  outstanding := greatest(expected_total - deposit_net - balance_net, 0);
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
    'service-balance:' || request_row.id::text || ':' || encode(digest(normalized_method || ':' || normalized_reference, 'sha256'), 'hex'),
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
      'resolved_service_total', expected_total
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

-- New records remain restricted to an in-progress visit. A correction to an
-- existing record is allowed later, while preserving the original row id,
-- author and complete before/after audit trail.
create or replace function public.guard_care_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_session_id uuid;
  session_row public.care_sessions%rowtype;
begin
  target_session_id := case when tg_op = 'DELETE' then old.care_session_id else new.care_session_id end;

  if tg_op = 'UPDATE' and new.care_session_id <> old.care_session_id then
    raise exception 'A care record cannot be moved to another service visit';
  end if;

  select session.* into session_row
  from public.care_sessions session
  where session.id = target_session_id
  for update;

  if not found then
    raise exception 'Care session not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('assignment-session:' || session_row.assignment_id::text, 0)
  );

  if tg_op in ('INSERT', 'DELETE') and session_row.status <> 'IN_PROGRESS' then
    raise exception 'Care records may be added or deleted only while the care session is in progress';
  end if;

  if tg_op in ('INSERT', 'DELETE') and exists (
    select 1
    from public.care_reports report
    where report.care_session_id = session_row.id
      and (report.status = 'PUBLISHED' or report.published_at is not null)
  ) then
    raise exception 'Published care report events cannot be added or deleted';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.guard_care_event_mutation() from public;
revoke all on function public.guard_care_event_mutation() from anon;
revoke all on function public.guard_care_event_mutation() from authenticated;

create or replace function public.update_care_event(
  p_event_id uuid,
  p_event_time timestamptz,
  p_payload jsonb,
  p_notes text default null
)
returns public.care_events
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.care_events%rowtype;
  session_row public.care_sessions%rowtype;
  assignment_row public.care_assignments%rowtype;
  caregiver_user_id uuid;
  normalized_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  saved_event public.care_events%rowtype;
  correction_count integer;
  feeding_method text;
  feeding_amount numeric;
  feeding_duration numeric;
begin
  if auth.uid() is null or not public.account_is_active() then
    raise exception 'An active signed-in account is required';
  end if;
  if p_event_id is null or p_event_time is null then
    raise exception 'Care record and recorded time are required';
  end if;
  if jsonb_typeof(normalized_payload) <> 'object' then
    raise exception 'Care record details must be a JSON object';
  end if;
  if p_event_time > now() + interval '15 minutes' then
    raise exception 'Care record time cannot be more than 15 minutes in the future';
  end if;

  select event.* into event_row
  from public.care_events event
  where event.id = p_event_id
  for update;

  if not found then
    raise exception 'Care record not found';
  end if;

  select session.* into session_row
  from public.care_sessions session
  where session.id = event_row.care_session_id;

  select assignment.* into assignment_row
  from public.care_assignments assignment
  where assignment.id = session_row.assignment_id;

  select caregiver.user_id into caregiver_user_id
  from public.caregivers caregiver
  where caregiver.id = assignment_row.caregiver_id;

  if not public.is_admin()
     and event_row.created_by <> auth.uid()
     and caregiver_user_id is distinct from auth.uid() then
    raise exception 'Only the assigned caregiver or an administrator can correct this care record';
  end if;

  if (p_event_time at time zone session_row.service_time_zone)::date <> session_row.service_date then
    raise exception 'The corrected time must remain within the original service date';
  end if;

  if event_row.event_type = 'FEEDING' then
    feeding_method := normalized_payload ->> 'method';
    if feeding_method not in ('breast', 'pumped', 'formula') then
      raise exception 'A valid feeding method is required';
    end if;
    if feeding_method = 'breast' then
      feeding_duration := nullif(normalized_payload ->> 'duration', '')::numeric;
      if feeding_duration is null or feeding_duration not between 1 and 180 then
        raise exception 'Direct breastfeeding duration must be between 1 and 180 minutes';
      end if;
      normalized_payload := normalized_payload - 'amount';
    else
      feeding_amount := nullif(normalized_payload ->> 'amount', '')::numeric;
      if feeding_amount is null or feeding_amount not between 5 and 500 then
        raise exception 'Pumped milk and formula volume must be between 5 and 500 ml';
      end if;
      normalized_payload := normalized_payload - 'duration' - 'side';
    end if;
  elsif event_row.event_type = 'MEAL' then
    if length(trim(coalesce(normalized_payload ->> 'menu', ''))) = 0 then
      raise exception 'Meal menu or amount is required';
    end if;
    normalized_payload := jsonb_set(normalized_payload, '{mealType}', to_jsonb('식사'::text), true);
  elsif event_row.event_type = 'SITTER_NOTE' then
    if length(trim(coalesce(normalized_payload ->> 'category', ''))) = 0 then
      raise exception 'An activity category is required';
    end if;
  end if;

  correction_count := coalesce(nullif(event_row.payload ->> 'correctionCount', '')::integer, 0) + 1;
  normalized_payload := jsonb_set(normalized_payload, '{correctionCount}', to_jsonb(correction_count), true);
  normalized_payload := jsonb_set(normalized_payload, '{serverCorrectedAt}', to_jsonb(now()), true);
  normalized_payload := jsonb_set(normalized_payload, '{serverCorrectedBy}', to_jsonb(auth.uid()::text), true);

  update public.care_events
  set event_time = p_event_time,
      payload = normalized_payload,
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where id = event_row.id
  returning * into saved_event;

  insert into public.audit_logs(actor_id, action, table_name, record_id, metadata)
  values (
    auth.uid(),
    'CORRECT_CARE_EVENT',
    'care_events',
    saved_event.id,
    jsonb_build_object(
      'care_session_id', saved_event.care_session_id,
      'event_type', saved_event.event_type,
      'before_event_time', event_row.event_time,
      'after_event_time', saved_event.event_time,
      'before_payload', event_row.payload,
      'after_payload', saved_event.payload,
      'correction_count', correction_count
    )
  );

  return saved_event;
end;
$$;

revoke all on function public.update_care_event(uuid, timestamptz, jsonb, text) from public;
revoke all on function public.update_care_event(uuid, timestamptz, jsonb, text) from anon;
grant execute on function public.update_care_event(uuid, timestamptz, jsonb, text) to authenticated;

comment on function public.update_care_event(uuid, timestamptz, jsonb, text) is
  'Corrects an existing care record without changing its visit, type, original author, or audit history.';

notify pgrst, 'reload schema';

commit;
