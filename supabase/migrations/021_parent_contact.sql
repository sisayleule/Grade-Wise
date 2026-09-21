-- =============================================================================
-- Migration: 021_parent_contact
--
-- Adds parent_name and parent_phone to public.students.
--
-- Both columns are nullable so existing rows (created before this migration)
-- remain valid without any backfill. The UI shows "Not provided" when null.
--
-- RLS is unchanged: the existing policies on public.students already cover
-- these columns because policies operate at row level, not column level.
-- A student can still only read their own row; a teacher can still read/update
-- all rows for their school.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. Add parent_name ────────────────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'students'
      and column_name  = 'parent_name'
  ) then
    alter table public.students
      add column parent_name text;
    raise notice 'Added parent_name column';
  else
    raise notice 'parent_name already exists';
  end if;
end $$;

-- ── 2. Add parent_phone ───────────────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'students'
      and column_name  = 'parent_phone'
  ) then
    alter table public.students
      add column parent_phone text;
    raise notice 'Added parent_phone column';
  else
    raise notice 'parent_phone already exists';
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
  and column_name  in ('parent_name', 'parent_phone')
order by column_name;
