-- =============================================================================
-- Migration: 015_roster_columns
--
-- Phase 5: Class Roster as sole source of student identity
--
-- Changes:
--   1. Add roll_number (nullable text) to public.students
--      — The school-assigned roll / admission number from the paper register.
--        Distinct from student_code (the result-sheet ID).  Nullable so all
--        existing rows survive without data loss.
--
--   2. Add sex (nullable text) to public.students
--      CHECK ('M', 'F', 'Other') — nullable for back-compat with old rows.
--
--   3. Document (in comments) that the canonicalUpserts auto-creation path
--      in POST /api/batches has been REMOVED in Phase 5.  New batches must
--      match against an existing roster row; unmatched IDs are surfaced as
--      validation warnings and block processing.
--
--   4. Backfill safety: existing rows from the old auto-upsert path keep
--      grade/section/year intact; roll_number and sex stay NULL until a
--      teacher fills them via the Roster screen.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. Add roll_number ────────────────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'students'
      and column_name  = 'roll_number'
  ) then
    alter table public.students
      add column roll_number text;
    raise notice 'Added roll_number column';
  else
    raise notice 'roll_number already exists';
  end if;
end $$;

-- ── 2. Add sex ────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'students'
      and column_name  = 'sex'
  ) then
    alter table public.students
      add column sex text check (sex in ('M', 'F', 'Other'));
    raise notice 'Added sex column';
  else
    raise notice 'sex already exists';
  end if;
end $$;

-- ── 3. Confirm ────────────────────────────────────────────────────────────────
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'students'
order by ordinal_position;
