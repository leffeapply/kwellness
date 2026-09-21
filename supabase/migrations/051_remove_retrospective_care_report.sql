-- The dedicated retrospective work-report flow duplicated the dated care-event
-- editor. Keep previously recorded sessions, events, and audit logs intact while
-- removing the obsolete write endpoint.
drop function if exists public.record_retrospective_care_report(
  uuid,
  date,
  time,
  time,
  text
);
