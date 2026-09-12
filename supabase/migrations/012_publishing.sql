-- =============================================================================
-- Migration: 012_publishing
--
-- Phase 3: Result Publishing Workflow
--
-- Changes to result_batches:
--   1. Add `publish_status` column (separate from processing_status):
--        'draft' | 'processed' | 'reviewed' | 'published' | 'archived'
--        Default: 'processed' for new inserts going forward.
--   2. Add `published_student_ids` (jsonb) — array of student_id strings
--        for per-student publishing within a batch.
--   3. updated_at already exists (from migration 003 trigger) — no change.
--
-- Migration strategy for existing rows:
--   All existing batches → publish_status = 'published'
--   (Nothing already live should suddenly become invisible.)
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. Add publish_status column ─────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'result_batches'
      and column_name  = 'publish_status'
  ) then
    alter table public.result_batches
      add column publish_status text not null default 'processed'
        check (publish_status in ('draft','processed','reviewed','published','archived'));
    raise notice 'Added publish_status column';
  end if;
end $$;

-- ── 2. Add published_student_ids column ──────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'result_batches'
      and column_name  = 'published_student_ids'
  ) then
    alter table public.result_batches
      add column published_student_ids jsonb not null default '[]'::jsonb;
    raise notice 'Added published_student_ids column';
  end if;
end $$;

-- ── 3. Migrate existing rows → publish_status = 'published' ──────────────────
-- All batches saved before this migration are considered already-published
-- so no data appears to vanish from the teacher's view.
update public.result_batches
  set publish_status = 'published'
where publish_status = 'processed';  -- default is 'processed', rows never had this col

-- ── 4. Confirm ────────────────────────────────────────────────────────────────
select
  publish_status,
  count(*) as batch_count
from public.result_batches
group by publish_status
order by publish_status;
