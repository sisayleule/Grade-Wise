-- =============================================================================
-- Migration: 013_student_portal_rls
--
-- Phase 4: Student Portal Views
--
-- Problem: result_batches currently has NO read policy for students — only
-- school owners can read their batches (school_id = auth.uid()).  The student
-- portal API routes need to filter on publish_status and
-- published_student_ids, which requires reading result_batches rows where
-- the student's canonical `students.school_id` matches `result_batches.school_id`.
--
-- Solution: Add a SECURITY DEFINER helper + one new SELECT policy on
-- result_batches that:
--   1. The student is authenticated (has a students row with auth_user_id = uid)
--   2. The batch belongs to the same school as the student
--   3. publish_status = 'published'
--   4. Either published_student_ids is '[]' (publish-all) OR the student's
--      student_code is contained in published_student_ids
--
-- NOTE: The published_student_ids check is enforced here in the RLS policy,
-- not just at the API layer — defence in depth.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. SECURITY DEFINER helper: get current student's (school_id, student_code)
-- Mirrors current_user_is_admin() and current_user_is_student() patterns.
-- Returns a record; returns NULL if the caller is not a portal student.

create or replace function public.current_student_info()
returns table(school_id uuid, student_code text)
language sql
security definer
stable
set search_path = public
as $$
  select s.school_id, s.student_code
  from public.students s
  where s.auth_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.current_student_info() from public;
grant execute on function public.current_student_info() to anon, authenticated;

-- ── 2. Add SELECT policy on result_batches for portal students ───────────────

drop policy if exists "result_batches: student read published own" on public.result_batches;

create policy "result_batches: student read published own"
  on public.result_batches for select
  using (
    -- The batch must be published
    publish_status = 'published'
    and
    -- The batch must belong to the same school as the logged-in student
    school_id in (
      select si.school_id from public.current_student_info() si
    )
    and
    -- The student must be personally published:
    -- Either published_student_ids is empty (= everyone) or contains their code
    (
      published_student_ids = '[]'::jsonb
      or
      published_student_ids @> to_jsonb(
        (select si.student_code from public.current_student_info() si)
      )
    )
  );

-- ── 3. Confirm ────────────────────────────────────────────────────────────────
select
  policyname,
  cmd,
  tablename
from pg_policies
where schemaname = 'public'
  and tablename in ('result_batches', 'result_students', 'students')
order by tablename, policyname;
