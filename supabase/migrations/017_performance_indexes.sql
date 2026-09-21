-- ── Migration 017: performance indexes ───────────────────────────────────────
--
-- Adds indexes that were missing from earlier migrations and are needed to
-- make RLS-filtered queries fast at scale.
--
-- All indexes are created with IF NOT EXISTS so this migration is fully
-- idempotent and safe to re-run.
--
-- Affected query patterns:
--   1. result_batches WHERE school_id = $1
--      Used by GET /api/batches (loads ALL batches for a teacher) and by the
--      RLS policy "result_batches: read own" on every student portal query.
--      The old UNIQUE(school_id, academic_year, grade, section, semester)
--      composite constraint has school_id as its leading column, so Postgres
--      CAN use it for a school_id-only scan — but only via an index scan on
--      the whole composite key.  A dedicated single-column index is lighter
--      and faster for the common full-table list query.
--
--   2. students WHERE school_id = $1 (without student_code)
--      The existing composite index students_school_code_idx covers
--      (school_id, student_code) so it already satisfies WHERE school_id = $1
--      with school_id as the leading column.  No new index needed here; this
--      comment documents that the existing index IS sufficient.
--
--   3. result_students WHERE batch_id = $1  (already exists from migration 003)
--      Documented here for completeness — already covered.
--
--   4. result_students WHERE student_ref_id = $1 (already exists from migration 009)
--      Documented here for completeness — already covered.
--
--   5. activities WHERE school_id = $1  (covered by composite index from migration 016)
--      Leading column = school_id, so already efficient.

-- ── 1. Standalone index on result_batches(school_id) ─────────────────────────
-- Speeds up:
--   GET /api/batches           → .eq('school_id', userId)
--   RLS "result_batches: read own" → auth.uid() = school_id
--   Student results query      → .eq('school_id', studentRow.school_id)
create index if not exists result_batches_school_id_idx
  on public.result_batches(school_id);

-- ── 2. Standalone index on result_batches(publish_status) ────────────────────
-- Speeds up the student-portal RLS policy on result_batches from migration 013,
-- which filters by publish_status = 'published'.
-- Without this, Postgres does a sequential scan on result_batches filtered by
-- school_id and then rechecks publish_status row-by-row.
create index if not exists result_batches_publish_status_idx
  on public.result_batches(publish_status);

-- ── 3. Composite index: result_batches(school_id, publish_status) ────────────
-- The student portal query pattern is always:
--   WHERE school_id = $1 AND grade = $2 AND section = $3 AND id = ANY($4)
-- combined with the RLS check publish_status = 'published'.
-- A composite covering (school_id, publish_status) lets Postgres satisfy both
-- the teacher ownership filter and the publication filter in a single index scan.
create index if not exists result_batches_school_publish_idx
  on public.result_batches(school_id, publish_status);

-- ── 4. Standalone index on students(school_id) ───────────────────────────────
-- The existing composite index students_school_code_idx(school_id, student_code)
-- already covers WHERE school_id = $1 as the leading column.  This standalone
-- index is added for the common "list all students for a school" pattern that
-- does NOT filter by student_code (e.g., the roster page's full class list and
-- the result-upload matching query that uses .in('student_code', codes)).
-- Postgres will choose the cheaper index automatically.
create index if not exists students_school_id_idx
  on public.students(school_id);

-- ── 5. Composite index: students(school_id, grade, section) ──────────────────
-- Many queries filter students by school + grade + section simultaneously:
--   GET /api/roster            → .eq('school_id', ...).eq('grade', ...).eq('section', ...)
--   POST /api/batches match    → .eq('school_id', ...).in('student_code', codes)
--   Student RLS policy checks  → school_id + grade + section membership
-- This composite covers all three columns so Postgres can satisfy the full
-- WHERE clause with a single index scan instead of filtering after a school scan.
create index if not exists students_school_grade_section_idx
  on public.students(school_id, grade, section);

-- ── 6. Composite index: result_students(batch_id, student_ref_id) ────────────
-- The student portal results API (GET /api/student/results) runs:
--   SELECT batch_id FROM result_students WHERE student_ref_id = $1
-- This is already covered by result_students_ref_idx (migration 009).
-- The composite (batch_id, student_ref_id) additionally covers the reverse
-- lookup used when a teacher publishes selective results:
--   WHERE batch_id = $1 AND student_ref_id = $2
-- and the RLS "result_students: student read own" policy which must join on both.
create index if not exists result_students_batch_student_idx
  on public.result_students(batch_id, student_ref_id);
