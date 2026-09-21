-- =============================================================================
-- Migration: 011_fix_student_trigger
--
-- Problem: The handle_new_user trigger fires on EVERY auth.users insert,
-- including student portal accounts created via service-role admin API.
-- This causes student accounts to get a phantom schools row with status='pending',
-- which makes the middleware treat them as a pending teacher account.
--
-- Fix: Update handle_new_user to skip creating a schools row when the user's
-- metadata indicates role='student'. Also clean up any phantom schools rows
-- already created for existing student accounts.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. Update trigger to skip student accounts ────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  code  text;
  tries int := 0;
begin
  -- Skip creating a schools row for student portal accounts.
  -- Students are identified by role='student' in their user_metadata.
  if (new.raw_user_meta_data->>'role') = 'student' then
    return new;
  end if;

  -- Generate a unique school_code for teacher/school accounts
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

-- ── 2. Clean up phantom schools rows created for existing student accounts ────
-- Delete any schools row where the auth user's metadata has role='student'
-- AND the schools row has no real school_name (i.e. it was auto-generated).
-- We identify these by cross-referencing with public.students.

delete from public.schools
where id in (
  select s.id
  from public.schools s
  inner join public.students st on st.auth_user_id = s.id
  -- Only delete if it looks like a phantom row: no real data set
  where s.name = split_part(
    (select email from auth.users where id = s.id),
    '@', 1
  )
  or s.name = ''
);

-- ── 3. Confirm ────────────────────────────────────────────────────────────────
select
  (select count(*) from public.schools) as school_rows,
  (select count(*) from public.students where auth_user_id is not null) as student_portal_accounts,
  'Migration 011 complete' as status;
