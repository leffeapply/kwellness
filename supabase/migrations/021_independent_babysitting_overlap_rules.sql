-- Treat postpartum care and babysitting as independent offerings.
-- Only active postpartum intake and overlapping service periods are blocked.

create or replace function public.enforce_assignment_service_sequence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_client_id uuid;
  target_baby_id uuid;
begin
  if new.status = 'CANCELLED' then
    return new;
  end if;

  select client_id, baby_id
  into target_client_id, target_baby_id
  from public.care_contracts
  where id = new.contract_id;

  if exists (
    select 1
    from public.care_assignments existing_assignment
    join public.care_contracts existing_contract
      on existing_contract.id = existing_assignment.contract_id
    where existing_assignment.id <> new.id
      and existing_assignment.status <> 'CANCELLED'
      and (
        (target_baby_id is not null and existing_contract.baby_id = target_baby_id)
        or (target_baby_id is null and existing_contract.client_id = target_client_id)
      )
      and tstzrange(existing_assignment.starts_at, existing_assignment.ends_at, '[]')
          && tstzrange(new.starts_at, new.ends_at, '[]')
  ) then
    raise exception '동일 아기의 서비스 기간은 서로 겹칠 수 없습니다.';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_request_service_sequence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  request_end_date date;
begin
  if new.status in ('REJECTED', 'CANCELLED') then
    return new;
  end if;

  request_end_date := new.desired_start_date + (new.requested_weeks * 7 - 1);

  if new.service_type = 'BABYSITTING'
     and (tg_op = 'INSERT' or old.service_type is distinct from new.service_type)
     and exists (
       select 1
       from public.care_assignments postpartum_assignment
       join public.care_contracts postpartum_contract
         on postpartum_contract.id = postpartum_assignment.contract_id
       where postpartum_assignment.status <> 'CANCELLED'
         and postpartum_assignment.service_type = 'POSTPARTUM'
         and postpartum_contract.client_id = new.client_id
         and (
           (new.baby_id is not null and postpartum_contract.baby_id = new.baby_id)
           or new.baby_id is null
         )
         and now() between postpartum_assignment.starts_at and postpartum_assignment.ends_at
     ) then
    raise exception '동일 아기가 산후조리를 이용 중인 동안에는 베이비시팅을 새로 신청할 수 없습니다.';
  end if;

  if exists (
    select 1
    from public.care_assignments assignment
    join public.care_contracts contract on contract.id = assignment.contract_id
    where assignment.status <> 'CANCELLED'
      and (new.approved_assignment_id is null or assignment.id <> new.approved_assignment_id)
      and contract.client_id = new.client_id
      and (
        (new.baby_id is not null and contract.baby_id = new.baby_id)
        or new.baby_id is null
      )
      and daterange(assignment.starts_at::date, assignment.ends_at::date, '[]')
          && daterange(new.desired_start_date, request_end_date, '[]')
  ) then
    raise exception '신청한 기간이 동일 아기의 기존 서비스 일정과 겹칩니다.';
  end if;

  if exists (
    select 1
    from public.client_service_requests existing_request
    where existing_request.id <> new.id
      and existing_request.client_id = new.client_id
      and existing_request.status in ('PENDING', 'APPROVED')
      and existing_request.approved_assignment_id is null
      and (
        (new.baby_id is not null and existing_request.baby_id = new.baby_id)
        or new.baby_id is null
      )
      and daterange(
            existing_request.desired_start_date,
            existing_request.desired_start_date + (existing_request.requested_weeks * 7 - 1),
            '[]'
          ) && daterange(new.desired_start_date, request_end_date, '[]')
  ) then
    raise exception '신청한 기간이 동일 아기의 처리 중인 다른 신청과 겹칩니다.';
  end if;

  if new.service_type = 'POSTPARTUM' then
    new.weekly_rate := 1800.00;
    new.estimated_total := 1800.00 * new.requested_weeks;
  end if;

  return new;
end;
$$;

comment on function public.enforce_assignment_service_sequence() is
  'Prevents overlapping assignments for the same baby without imposing a service order.';

comment on function public.enforce_request_service_sequence() is
  'Allows independent babysitting requests, blocks new intake during active postpartum care, and prevents date overlap.';
