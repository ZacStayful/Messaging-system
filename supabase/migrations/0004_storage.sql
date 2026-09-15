-- 0004_storage.sql
-- Private bucket for message attachments. Object paths are
--   <org_id>/<conversation_id>/<message_id>/<file name>
-- so membership can be checked from the path alone.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false,
  52428800, -- 50 MB (spec 3.2)
  array['image/jpeg','image/png','image/webp','image/gif','image/heic','application/pdf',
        'text/plain','text/csv','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'audio/mpeg','audio/mp4','audio/webm','video/mp4','video/quicktime']
)
on conflict (id) do nothing;

create or replace function public.storage_path_conversation_id(name text)
returns uuid language sql immutable as $$
  select case
    when split_part(name, '/', 2) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then split_part(name, '/', 2)::uuid
    else null
  end
$$;

create policy "attachments: members read files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and split_part(name, '/', 1) = public.auth_org_id()::text
    and public.is_member(public.storage_path_conversation_id(name))
  );

create policy "attachments: members upload files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and split_part(name, '/', 1) = public.auth_org_id()::text
    and public.is_member(public.storage_path_conversation_id(name))
  );

create policy "attachments: uploader removes own files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and owner = auth.uid());
