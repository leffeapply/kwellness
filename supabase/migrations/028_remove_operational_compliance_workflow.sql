-- Insurance and W-2 statements are customer-facing company operating
-- principles. They are not application evidence, approval, scheduling, or
-- care-session gates.

begin;

do $migration$
declare
  target_routine regprocedure;
  gate_message text;
  existing_definition text;
  patched_definition text;
  two_space_lock text := E'  perform pg_advisory_xact_lock(\n    hashtextextended(''company-compliance-scheduling'', 0)\n  );\n';
  four_space_lock text := E'    perform pg_advisory_xact_lock(\n      hashtextextended(''company-compliance-scheduling'', 0)\n    );\n';
  six_space_lock text := E'      perform pg_advisory_xact_lock(\n        hashtextextended(''company-compliance-scheduling'', 0)\n      );\n';
begin
  for target_routine, gate_message in
    select * from (values
      (
        'public.set_care_session_status(uuid, public.session_status)'::regprocedure,
        'Current liability, workers compensation, and W-2 evidence must be verified before care starts'::text
      ),
      (
        'public.review_service_adjustment(uuid, boolean, text)'::regprocedure,
        'Current liability, workers compensation, and W-2 evidence must be verified before changing a schedule'::text
      ),
      (
        'public.schedule_approved_client_request(uuid, uuid)'::regprocedure,
        'Current liability, workers compensation, and W-2 evidence must be verified before scheduling'::text
      ),
      (
        'public.admin_reassign_caregiver(uuid, uuid, text)'::regprocedure,
        'Current liability, workers compensation, and W-2 evidence must be verified before reassignment'::text
      )
    ) target(target_routine, gate_message)
  loop
    select pg_get_functiondef(target_routine) into existing_definition;
    if existing_definition is null then
      raise exception 'Required routine % is missing', target_routine;
    end if;

    patched_definition := replace(existing_definition, six_space_lock, '');
    patched_definition := replace(patched_definition, four_space_lock, '');
    patched_definition := replace(patched_definition, two_space_lock, '');
    patched_definition := replace(
      patched_definition,
      E'      if not public.company_care_compliance_is_current() then\n        raise exception '''
        || gate_message || E''';\n      end if;\n',
      ''
    );
    patched_definition := replace(
      patched_definition,
      E'    if not public.company_care_compliance_is_current() then\n      raise exception '''
        || gate_message || E''';\n    end if;\n',
      ''
    );
    patched_definition := replace(
      patched_definition,
      E'  if not public.company_care_compliance_is_current() then\n    raise exception '''
        || gate_message || E''';\n  end if;\n',
      ''
    );

    if position('company_care_compliance_is_current()' in patched_definition) > 0
       or position(gate_message in patched_definition) > 0 then
      raise exception 'The obsolete evidence gate could not be removed from %', target_routine;
    end if;

    if patched_definition <> existing_definition then
      execute patched_definition;
    end if;
  end loop;
end;
$migration$;

-- Keep the general application/sequence consent, but do not make the
-- promotional insured-staffing acknowledgement a submission or scheduling
-- prerequisite.
do $migration$
declare
  target_routine regprocedure := 'public.submit_client_service_request(public.care_service_type, uuid, text, date, integer, date, time, time, text[], text, integer, text, text, text, text, text, text, text, boolean, boolean)'::regprocedure;
  existing_definition text;
  patched_definition text;
  old_guard text := E'  if p_sequence_policy_accepted is distinct from true\n     or p_insured_staffing_acknowledged is distinct from true then\n';
  new_guard text := E'  if p_sequence_policy_accepted is distinct from true then\n';
begin
  select pg_get_functiondef(target_routine) into existing_definition;
  patched_definition := replace(existing_definition, old_guard, new_guard);

  if patched_definition = existing_definition
     and position('or p_insured_staffing_acknowledged is distinct from true' in existing_definition) > 0 then
    raise exception 'The obsolete insured-staffing submission guard was not found';
  end if;

  if patched_definition <> existing_definition then
    execute patched_definition;
  end if;
end;
$migration$;

do $migration$
declare
  target_routine regprocedure := 'public.schedule_approved_client_request(uuid, uuid)'::regprocedure;
  existing_definition text;
  patched_definition text;
  old_guard text := E'  if request_row.sequence_policy_accepted is distinct from true\n     or request_row.insured_staffing_acknowledged is distinct from true then\n';
  new_guard text := E'  if request_row.sequence_policy_accepted is distinct from true then\n';
begin
  select pg_get_functiondef(target_routine) into existing_definition;
  patched_definition := replace(existing_definition, old_guard, new_guard);

  if patched_definition = existing_definition
     and position('or request_row.insured_staffing_acknowledged is distinct from true' in existing_definition) > 0 then
    raise exception 'The obsolete insured-staffing scheduling guard was not found';
  end if;

  if patched_definition <> existing_definition then
    execute patched_definition;
  end if;
end;
$migration$;

-- Retain historical rows only for audit/migration continuity. Browser roles
-- cannot read or mutate them, and no operational routine calls the legacy
-- verification helper.
drop policy if exists "company compliance: administrators read"
  on public.company_compliance_controls;
revoke all on table public.company_compliance_controls from public;
revoke all on table public.company_compliance_controls from anon;
revoke all on table public.company_compliance_controls from authenticated;
revoke all on function public.admin_update_company_compliance(
  text, text, timestamptz, date, text, text
) from public;
revoke all on function public.admin_update_company_compliance(
  text, text, timestamptz, date, text, text
) from anon;
revoke all on function public.admin_update_company_compliance(
  text, text, timestamptz, date, text, text
) from authenticated;
revoke all on function public.company_care_compliance_is_current() from public;
revoke all on function public.company_care_compliance_is_current() from anon;
revoke all on function public.company_care_compliance_is_current() from authenticated;

comment on table public.company_compliance_controls is
  'Inactive legacy audit data. The ProMoms application does not read, edit, verify, or enforce these records.';
comment on function public.admin_update_company_compliance(
  text, text, timestamptz, date, text, text
) is 'Inactive legacy routine with no browser-role execution permission.';
comment on function public.company_care_compliance_is_current() is
  'Inactive legacy helper retained only for migration history; no operational routine calls it.';

comment on function public.schedule_approved_client_request(uuid, uuid) is
  'Schedules approved requests on past, current, or future dates. Exact caregiver/baby overlap, captured-deposit, active-account, and employment checks remain mandatory; company insurance and W-2 evidence are not application gates.';

notify pgrst, 'reload schema';

commit;
