-- Care trend expansion: baby weight records and one-time assignment reviews.

alter table public.care_events
  drop constraint if exists care_events_event_type_check;

alter table public.care_events
  add constraint care_events_event_type_check
  check (event_type in ('FEEDING', 'DIAPER', 'SLEEP', 'TEMPERATURE', 'BATH', 'WEIGHT', 'MOTHER_CARE', 'NOTE'));

create table public.caregiver_reviews (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.care_assignments(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  caregiver_id uuid not null references public.caregivers(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  tags text[] not null default '{}',
  comment text not null check (char_length(trim(comment)) between 1 and 500),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.caregiver_reviews enable row level security;

create policy "caregiver reviews: related parties read" on public.caregiver_reviews
for select to authenticated using (
  public.is_care_staff()
  or public.is_client_member(client_id)
  or exists (
    select 1 from public.caregivers c
    where c.id = caregiver_id and c.user_id = auth.uid()
  )
);

create policy "caregiver reviews: client submits once after care" on public.caregiver_reviews
for insert to authenticated with check (
  created_by = auth.uid()
  and public.is_client_member(client_id)
  and exists (
    select 1
    from public.care_assignments a
    join public.care_contracts cc on cc.id = a.contract_id
    left join public.care_sessions s on s.assignment_id = a.id
    where a.id = assignment_id
      and a.caregiver_id = caregiver_id
      and cc.client_id = client_id
      and (a.ends_at < now() or s.ended_at is not null)
  )
);

create index caregiver_reviews_caregiver_created_idx
  on public.caregiver_reviews(caregiver_id, created_at desc);

-- No update or delete policy is intentionally defined: one assignment can receive
-- one immutable client review. Administrative corrections should use an audited,
-- separately authorized support workflow rather than editing the original review.
