-- =============================================================================
-- Migration: 010_school_code
--
-- Adds school_code to public.schools — a short human-shareable code that
-- students use to register their portal accounts.
--
-- Format: 6 uppercase alphanumeric characters, e.g. GRN8K2
-- Generated automatically for every existing school and for new signups
-- via the handle_new_user trigger update below.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. Add school_code column ─────────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'schools'
      and column_name  = 'school_code'
  ) then
    alter table public.schools
      add column school_code text unique;
    raise notice 'Added school_code column';
  else
    raise notice 'school_code already exists';
  end if;
end $$;

-- ── 2. Helper: generate a random 6-char uppercase alphanumeric code ───────────
create or replace function public.generate_school_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no I,O,1,0 to avoid confusion
  code  text := '';
  i     int;
begin
  for i in 1..6 loop
    code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return code;
end;
$$;

-- ── 3. Backfill all existing schools that have no code yet ────────────────────
do $$
declare
  rec   record;
  code  text;
  tries int;
begin
  for rec in select id from public.schools where school_code is null loop
    tries := 0;
    loop
      code  := public.generate_school_code();
      tries := tries + 1;
      exit when not exists (select 1 from public.schools where school_code = code);
      exit when tries > 100; -- safety valve
    end loop;
    update public.schools set school_code = code where id = rec.id;
  end loop;
end;
$$;

-- Now make the column NOT NULL after backfilling
alter table public.schools
  alter column school_code set not null;

-- ── 4. Update handle_new_user trigger to assign a code on every new signup ────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  code  text;
  tries int := 0;
begin
  -- Generate a unique school_code
  loop
    code  := public.generate_school_code();
    tries := tries + 1;
    exit when not exists (select 1 from public.schools where school_code = code);
    exit when tries > 100;
  end loop;

  insert into public.schools (id, name, contact_name, status, is_admin, school_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'school_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'contact_name', ''),
    'pending',
    false,
    code
  )
  on conflict (id) do update
    set contact_name = excluded.contact_name
    where public.schools.contact_name = '';
  return new;
end;
$$;

-- ── 5. RLS: allow schools to read their own school_code (already covered by
--    the existing "schools: read own row" policy — no change needed).
--    Allow public lookup of school_code → school_id for student sign-up.
--    This is intentionally minimal: only id and school_id are exposed.

drop policy if exists "schools: public code lookup" on public.schools;
create policy "schools: public code lookup"
  on public.schools for select
  using (true);  -- anon may look up a school by code (only id is returned by the API)

-- Wait — the above is too broad. The existing "read own row" + admin policy
-- already covers teachers. We need only a narrow public lookup for the
-- student sign-up API route, which uses the service role anyway, so no
-- additional RLS policy is needed here. Drop the overly broad policy:
drop policy if exists "schools: public code lookup" on public.schools;

-- ── 6. Confirm ────────────────────────────────────────────────────────────────
select id, name, school_code
from public.schools
order by created_at;
