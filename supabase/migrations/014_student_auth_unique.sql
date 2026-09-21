-- =============================================================================
-- Migration: 014_student_auth_unique
--
-- Phase 4 fix: Cross-class result visibility & one-account-per-student
--
-- Problems fixed:
--
--   1. No unique constraint on students.auth_user_id
--      A single login could be linked to more than one canonical student row
--      (e.g. one record per class the student ever appeared in). This made the
--      /student/results query — which calls .maybeSingle() on auth_user_id —
--      non-deterministic, and allowed one portal account to surface results
--      belonging to a different student record.
--
--   2. Dirty data: if any auth_user_id currently appears on more than one row,
--      we keep the row with the most recent non-blank grade/section and clear
--      auth_user_id + email + portal_status on the others so they become
--      claimable again by the real students they belong to.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. Fix existing duplicate auth_user_id rows ───────────────────────────────
-- For every auth_user_id that appears more than once, keep the single row that
-- has the most complete data (non-blank grade and section preferred, else the
-- most recently created row), and clear the identity fields on all others.

do $$
declare
  dup record;
  keep_id uuid;
begin
  for dup in
    select auth_user_id
    from public.students
    where auth_user_id is not null
    group by auth_user_id
    having count(*) > 1
  loop
    -- Pick the row to keep: prefer non-blank grade+section, then newest
    select id into keep_id
    from public.students
    where auth_user_id = dup.auth_user_id
    order by
      (case when grade <> '' and section <> '' then 0 else 1 end) asc,
      created_at desc
    limit 1;

    -- Clear identity fields on all OTHER rows for this auth_user_id
    update public.students
    set
      auth_user_id  = null,
      email         = null,
      portal_status = 'inactive'
    where auth_user_id = dup.auth_user_id
      and id <> keep_id;

    raise notice 'Fixed duplicate auth_user_id %, kept row %', dup.auth_user_id, keep_id;
  end loop;
end;
$$;

-- ── 2. Add UNIQUE constraint on auth_user_id (nulls excluded) ─────────────────
-- A partial unique index on non-null values is the standard Postgres pattern —
-- it allows many rows with auth_user_id = NULL (unclaimed students) while
-- making it impossible for two claimed rows to share the same auth user.

drop index if exists public.students_auth_user_id_unique_idx;

create unique index students_auth_user_id_unique_idx
  on public.students(auth_user_id)
  where auth_user_id is not null;

-- ── 3. Confirm ────────────────────────────────────────────────────────────────
select
  (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and tablename  = 'students'
      and indexname  = 'students_auth_user_id_unique_idx'
  ) as unique_index_exists,
  (
    -- Should be 0 after the cleanup above
    select count(*)
    from public.students
    where auth_user_id in (
      select auth_user_id
      from public.students
      where auth_user_id is not null
      group by auth_user_id
      having count(*) > 1
    )
  ) as remaining_duplicate_rows,
  'Migration 014 complete' as status;
