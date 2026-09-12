-- =============================================================================
-- Migration: 009_student_accounts
--
-- Phase 2: Student Accounts & Security Model
--
-- 1. Creates public.students — canonical student identities, one row per
--    unique student_code per school, persisted across all periods.
--
-- 2. Adds student_ref_id to result_students — a FK back to students.id so
--    the per-batch score row knows which canonical student it belongs to.
--
-- 3. RLS policies:
--    schools:         UNCHANGED — teachers read/write their own rows
--    students:        teachers CRUD their own school's students
--                     students can SELECT only their own single row
--    result_batches:  UNCHANGED — teachers only
--    result_students: teacher policy UNCHANGED
--                     new student SELECT policy via student_ref_id
--
-- 4. Helper function: is_student() — SECURITY DEFINER, breaks any potential
--    RLS recursion, mirrors the existing current_user_is_admin() pattern.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. Create public.students ─────────────────────────────────────────────────

create table if not exists public.students (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references auth.users(id) on delete cascade,
  student_code     text not null,              -- matches student_id in result sheets
  full_name        text not null default '',
  grade            text not null default '',   -- most recent grade
  section          text not null default '',   -- most recent section
  academic_year    text not null default '',   -- most recent academic year
  email            text,                       -- set when portal account is activated
  auth_user_id     uuid references auth.users(id) on delete set null,
  portal_status    text not null default 'inactive'
                     check (portal_status in ('inactive', 'invited', 'active')),
  created_at       timestamptz not null default now(),

  -- One canonical record per student code per school
  unique (school_id, student_code)
);

-- Index for fast lookup by auth_user_id (used in student RLS policies)
create index if not exists students_auth_user_id_idx
  on public.students(auth_user_id);

-- Index for fast upsert by school + code (used in batch save)
create index if not exists students_school_code_idx
  on public.students(school_id, student_code);

-- ── 2. Add student_ref_id to result_students ──────────────────────────────────

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'result_students'
      and column_name  = 'student_ref_id'
  ) then
    alter table public.result_students
      add column student_ref_id uuid references public.students(id) on delete set null;
    raise notice 'Added student_ref_id to result_students';
  else
    raise notice 'student_ref_id already exists';
  end if;
end $$;

create index if not exists result_students_ref_idx
  on public.result_students(student_ref_id);

-- ── 3. Widen the semester check on result_batches to allow quarters ────────────
-- (Migration 003 only allowed 'Semester 1'/'Semester 2'; Phase 1 expanded the
--  API validation but the DB constraint was never updated.)
alter table public.result_batches
  drop constraint if exists result_batches_semester_check;

alter table public.result_batches
  add constraint result_batches_semester_check
    check (semester in (
      'Semester 1', 'Semester 2',
      'Quarter 1',  'Quarter 2', 'Quarter 3', 'Quarter 4'
    ));

-- ── 4. RLS: public.students ───────────────────────────────────────────────────

alter table public.students enable row level security;

-- Drop all policies first (idempotent re-run safety)
drop policy if exists "students: teacher read"   on public.students;
drop policy if exists "students: teacher insert" on public.students;
drop policy if exists "students: teacher update" on public.students;
drop policy if exists "students: teacher delete" on public.students;
drop policy if exists "students: student read own row" on public.students;

-- Teachers can do everything on their own school's rows
create policy "students: teacher read"
  on public.students for select
  using (school_id = auth.uid());

create policy "students: teacher insert"
  on public.students for insert
  with check (school_id = auth.uid());

create policy "students: teacher update"
  on public.students for update
  using (school_id = auth.uid());

create policy "students: teacher delete"
  on public.students for delete
  using (school_id = auth.uid());

-- A student (portal account) can select ONLY their own single row.
-- They cannot insert, update, or delete anything.
create policy "students: student read own row"
  on public.students for select
  using (auth_user_id = auth.uid());

-- ── 5. RLS: result_students — add student read policy ─────────────────────────
-- Teacher policies already exist from migration 003 and are UNCHANGED.
-- Add the new student-side read policy.

drop policy if exists "result_students: student read own" on public.result_students;

create policy "result_students: student read own"
  on public.result_students for select
  using (
    -- The student's auth_user_id must match the canonical students row
    -- that owns this result_students row via student_ref_id.
    -- Students can NEVER see another student's rows.
    exists (
      select 1 from public.students s
      where s.id           = result_students.student_ref_id
        and s.auth_user_id = auth.uid()
    )
  );

-- ── 6. Security-definer helper: is the current user a portal student? ─────────
-- Mirrors current_user_is_admin() from migration 005 — used in middleware
-- to distinguish teacher vs student sessions without triggering RLS loops.

create or replace function public.current_user_is_student()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.students
    where auth_user_id = auth.uid()
  );
$$;

revoke all on function public.current_user_is_student() from public;
grant execute on function public.current_user_is_student() to anon, authenticated;

-- ── 7. Deny students access to schools (Gemini keys, approval status, etc.) ───
-- The existing schools RLS only allows a row where auth.uid() = id (teacher)
-- or current_user_is_admin(). A student's auth.uid() will never equal a
-- school's id, and is_admin is false, so they are already blocked by the
-- existing policies. This comment documents the confirmed security boundary.
--
-- Explicitly: students have NO policies on:
--   public.schools            (blocked by existing policies — they have no row)
--   public.result_batches     (no policy added for students — teacher-only)
--   vault.secrets             (no access at all — service role only)
--   public.result_students    (only via student_ref_id → their own rows)

-- ── 8. Confirm ────────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'students') as students_table,
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'result_students'
      and column_name  = 'student_ref_id') as ref_col,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'students') as student_policies,
  'Migration 009 complete' as status;
