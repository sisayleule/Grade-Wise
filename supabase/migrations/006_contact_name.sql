-- =============================================================================
-- Migration: 006_contact_name
--
-- Adds a contact_name column to public.schools to store the individual
-- user's own name (e.g. the teacher or admin who signed up), separate from
-- the school's name.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'schools'
      and column_name  = 'contact_name'
  ) then
    alter table public.schools add column contact_name text not null default '';
    raise notice 'Added contact_name column to public.schools';
  else
    raise notice 'contact_name column already exists — skipping';
  end if;
end $$;

-- Update the new-user trigger to also capture contact_name from sign-up metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.schools (id, name, contact_name, status, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'school_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'contact_name', ''),
    'pending',
    false
  )
  on conflict (id) do update
    set contact_name = excluded.contact_name
    where public.schools.contact_name = '';
  return new;
end;
$$;

-- Confirm
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'schools'
  and column_name  = 'contact_name';
