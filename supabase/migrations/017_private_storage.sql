-- Private cloud storage for K-Wellness operational documents.
-- Every object path starts with either the owning user UUID or client UUID.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('profile-photos', 'profile-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('caregiver-certificates', 'caregiver-certificates', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png']),
  ('contracts', 'contracts', false, 20971520, array['application/pdf']),
  ('care-reports', 'care-reports', false, 20971520, array['application/pdf']),
  ('attachments', 'attachments', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_client_id(object_name text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case
    when split_part(object_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then split_part(object_name, '/', 1)::uuid
    else null
  end;
$$;

create policy "profile photos: owner or staff read"
on storage.objects for select to authenticated
using (
  bucket_id = 'profile-photos'
  and (split_part(name, '/', 1) = auth.uid()::text or public.is_care_staff())
);

create policy "profile photos: owner or staff insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-photos'
  and (split_part(name, '/', 1) = auth.uid()::text or public.is_care_staff())
);

create policy "profile photos: owner or staff update"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-photos'
  and (split_part(name, '/', 1) = auth.uid()::text or public.is_care_staff())
)
with check (
  bucket_id = 'profile-photos'
  and (split_part(name, '/', 1) = auth.uid()::text or public.is_care_staff())
);

create policy "profile photos: owner or staff delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-photos'
  and (split_part(name, '/', 1) = auth.uid()::text or public.is_care_staff())
);

create policy "caregiver certificates: owner or staff read"
on storage.objects for select to authenticated
using (
  bucket_id = 'caregiver-certificates'
  and (split_part(name, '/', 1) = auth.uid()::text or public.is_care_staff())
);

create policy "caregiver certificates: owner or staff insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'caregiver-certificates'
  and (split_part(name, '/', 1) = auth.uid()::text or public.is_care_staff())
);

create policy "caregiver certificates: staff update"
on storage.objects for update to authenticated
using (bucket_id = 'caregiver-certificates' and public.is_care_staff())
with check (bucket_id = 'caregiver-certificates' and public.is_care_staff());

create policy "caregiver certificates: staff delete"
on storage.objects for delete to authenticated
using (bucket_id = 'caregiver-certificates' and public.is_care_staff());

create policy "client documents: authorized read"
on storage.objects for select to authenticated
using (
  bucket_id in ('contracts', 'care-reports', 'attachments')
  and (
    public.is_care_staff()
    or public.is_client_member(public.storage_client_id(name))
    or public.caregiver_has_active_assignment(public.storage_client_id(name))
  )
);

create policy "client uploads: family or staff insert"
on storage.objects for insert to authenticated
with check (
  bucket_id in ('contracts', 'attachments')
  and (
    public.is_care_staff()
    or public.is_client_member(public.storage_client_id(name))
  )
);

create policy "care reports: staff insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'care-reports' and public.is_care_staff());

create policy "client documents: staff update"
on storage.objects for update to authenticated
using (bucket_id in ('contracts', 'care-reports', 'attachments') and public.is_care_staff())
with check (bucket_id in ('contracts', 'care-reports', 'attachments') and public.is_care_staff());

create policy "client documents: staff delete"
on storage.objects for delete to authenticated
using (bucket_id in ('contracts', 'care-reports', 'attachments') and public.is_care_staff());
