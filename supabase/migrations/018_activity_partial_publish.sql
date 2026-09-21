-- ── Migration 018: activity partial publish state ────────────────────────────
--
-- Adds 'partially_published' to the activities.publish_status CHECK constraint.
--
-- WHY:
--   Before this migration the constraint only allowed ('draft', 'published').
--   When "Publish to Selected Students" was used, the API wrote 'published'
--   even though only a subset of students had is_published = true on their
--   activity_scores rows. This caused:
--     • The activity list to show "Published" for a partially-published activity
--     • The publish buttons to disappear in the scores view, blocking the
--       teacher from returning to publish the remaining students
--     • No visual indicator of how many students had actually been published
--
-- The new state machine:
--   draft               → no student has is_published = true
--   partially_published → at least one, but not all, scored students published
--   published           → every scored student (score IS NOT NULL) is published
--
-- The API (PATCH /api/activities/[id]) now derives the correct state from the
-- actual is_published counts after each publish action instead of accepting the
-- client-supplied value. The client still sends { publish_status: 'published' }
-- for all publish requests; the server writes the correct derived value.
--
-- This migration is safe to re-run (idempotent).

-- ── 1. Drop the old constraint ────────────────────────────────────────────────
alter table public.activities
  drop constraint if exists activities_publish_status_check;

-- ── 2. Add the updated constraint ─────────────────────────────────────────────
alter table public.activities
  add constraint activities_publish_status_check
    check (publish_status in ('draft', 'partially_published', 'published'));

-- ── 3. Verify existing rows are still valid ───────────────────────────────────
-- All existing rows have publish_status IN ('draft', 'published'), both of
-- which remain valid under the new constraint. No data migration needed.

-- ── 4. Update any existing partially-published activities ─────────────────────
-- Fix any activities currently marked 'published' that actually only have a
-- subset of their scored students published (data inconsistency from the bug).
-- We do this in a single UPDATE using window functions to avoid N+1 queries.
update public.activities a
set publish_status = 'partially_published'
where a.publish_status = 'published'
  and exists (
    -- At least one scored student who is NOT published
    select 1
    from public.activity_scores s
    where s.activity_id = a.id
      and s.score is not null
      and s.is_published = false
  )
  and exists (
    -- And at least one scored student who IS published (not a full-unpublish)
    select 1
    from public.activity_scores s
    where s.activity_id = a.id
      and s.score is not null
      and s.is_published = true
  );

-- ── 5. Confirm ────────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.table_constraints
    where table_schema = 'public'
      and table_name   = 'activities'
      and constraint_name = 'activities_publish_status_check') as constraint_exists,
  (select count(*) from public.activities
    where publish_status not in ('draft', 'partially_published', 'published')) as invalid_rows,
  'Migration 018 complete' as status;
