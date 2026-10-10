-- Apply after enabling Supabase Auth. Private files belong to the authenticated owner.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  source_language text not null default 'English' check (source_language in ('English','Hindi')),
  target_language text not null default 'Hindi' check (target_language in ('English','Hindi')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null, file_type text not null check (file_type in ('DOCX','PDF','TXT','CSV')),
  source_language text not null default 'English', target_language text not null default 'Hindi',
  original_object_path text not null, extracted_structure jsonb not null default '{}'::jsonb,
  processing_status text not null default 'uploaded' check (processing_status in ('uploaded','processing','ready','needs_review','failed')),
  warnings jsonb not null default '[]'::jsonb, row_version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.translations (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade, parent_version_id uuid references public.translations(id) on delete set null,
  version integer not null, translated_structure jsonb not null default '{}'::jsonb,
  status text not null default 'processing' check (status in ('processing','completed','needs_review','failed')),
  provider text, model text, settings jsonb not null default '{}'::jsonb, warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(document_id,version)
);
create table if not exists public.glossary_entries (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  source_term text not null, preferred_translation text not null, source_language text not null, target_language text not null,
  definition text, example_sentence text, notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id,source_term,source_language,target_language)
);
create table if not exists public.email_drafts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  subject text not null default '', body text not null default '', source_language text not null default 'English', target_language text not null default 'Hindi',
  provider text check (provider is null or provider in ('gmail','outlook')), provider_draft_id text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null, translation_id uuid references public.translations(id) on delete set null,
  event_type text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.translations enable row level security;
alter table public.glossary_entries enable row level security;
alter table public.email_drafts enable row level security;
alter table public.audit_events enable row level security;
create policy "Users manage own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "Users manage own documents" on public.documents for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Users manage own translations" on public.translations for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Users manage own glossary" on public.glossary_entries for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Users manage own drafts" on public.email_drafts for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Users view own activity" on public.audit_events for select using (owner_id = auth.uid());
create policy "Users record own activity" on public.audit_events for insert with check (owner_id = auth.uid());
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('private-documents','private-documents',false,20971520,array['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/pdf','text/plain','text/csv'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit;
create policy "Owners read private files" on storage.objects for select to authenticated using (bucket_id='private-documents' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Owners upload private files" on storage.objects for insert to authenticated with check (bucket_id='private-documents' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Owners update private files" on storage.objects for update to authenticated using (bucket_id='private-documents' and (storage.foldername(name))[1]=auth.uid()::text) with check (bucket_id='private-documents' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "Owners delete private files" on storage.objects for delete to authenticated using (bucket_id='private-documents' and (storage.foldername(name))[1]=auth.uid()::text);
