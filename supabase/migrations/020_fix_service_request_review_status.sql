-- Keep approval decisions type-safe when client_service_requests.status is an enum.
create or replace function public.review_client_service_request(
  p_request_id uuid,
  p_approve boolean,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client_id uuid;
  target_service_type public.care_service_type;
begin
  if not public.is_care_staff() then
    raise exception 'Only care administrators can review client requests';
  end if;

  select client_id, service_type into target_client_id, target_service_type
  from public.client_service_requests
  where id = p_request_id and status = 'PENDING'
  for update;

  if target_client_id is null then
    raise exception 'Pending client request not found';
  end if;

  update public.client_service_requests
  set status = case
        when p_approve then 'APPROVED'::public.client_request_status
        else 'REJECTED'::public.client_request_status
      end,
      deposit_amount = case target_service_type when 'POSTPARTUM' then 500.00 else 128.00 end,
      deposit_status = case when p_approve then 'PAID' else deposit_status end,
      deposit_paid_at = case when p_approve then now() else deposit_paid_at end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = p_review_note,
      updated_at = now()
  where id = p_request_id;

  if p_approve then
    update public.clients
    set status = 'ACTIVE', updated_at = now()
    where id = target_client_id;
  end if;
end;
$$;

revoke all on function public.review_client_service_request(uuid, boolean, text) from public;
grant execute on function public.review_client_service_request(uuid, boolean, text) to authenticated;
