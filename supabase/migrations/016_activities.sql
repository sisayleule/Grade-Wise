-- =============================================================================
-- Migration: 016_activities
--
-- Phase 5: Assessments & Activities Module
--
-- Creates two tables:
--   activities        — one row per activity (Quiz, Test, Assessment, etc.)
--   activity_scores   — one row per student per activity
--
-- These tables are entirely separate from result_batches / result_students.
-- Activity scores NEVER affect quarter/semester totals, averages, ranks, or
-- letter grades. The two systems are designed to be independent.
--
-- RLS:
--   Teachers  — full CRUD on rows where school_id = auth.uid()
--   Students  — SELECT only on activity_scores where:
--                 (a) student_ref_id → students.id → auth_user_id = auth.uid()
--                 (b) is_published = true
--               Students have NO access to the activities table directly;
--               the student API route reads it server-side with the service client.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. activities ─────────────────────────────────────────────────────────────
create table if not exists public.activities (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references auth.users(id) on delete cascade,

  activity_type    text not null
                   check (activity_type in (
                     'Quiz', 'Test', 'Assessment', 'Assignment',
                     'Midterm Exam', 'Final Exam', 'Other'
                   )),
  name             text not null default '',
  subject          text not null default '',

  -- Class identity — same normalised format as the rest of the app:
  -- grade = "Grade 9", section = "C", academic_year = "2025 / 2026"
  academic_year    text not null default '',
  grade            text not null default '',
  section          text not null default '',

  activity_date    date,
  max_score        numeric(8,2) not null default 100,
  description      text,
  teacher_comment  text,

  publish_status   text not null default 'draft'
                   check (publish_status in ('draft', 'published')),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function public.set_activities_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists activities_updated_at on public.activities;
create trigger activities_updated_at
  before update on public.activities
  for each row execute procedure public.set_activities_updated_at();

-- Indexes
create index if not exists activities_school_class_idx
  on public.activities(school_id, academic_year, grade, section);

-- ── 2. activity_scores ────────────────────────────────────────────────────────
create table if not exists public.activity_scores (
  id               uuid primary key default gen_random_uuid(),
  activity_id      uuid not null references public.activities(id) on delete cascade,
  student_ref_id   uuid not null references public.students(id) on delete cascade,

  score            numeric(8,2),          -- null = student listed but not yet scored
  is_published     boolean not null default false,

  unique (activity_id, student_ref_id)   -- one score row per student per activity
);

create index if not exists activity_scores_activity_idx
  on public.activity_scores(activity_id);

create index if not exists activity_scores_student_idx
  on public.activity_scores(student_ref_id);

-- ── 3. RLS: activities ────────────────────────────────────────────────────────
alter table public.activities enable row level security;

drop policy if exists "activities: teacher read"   on public.activities;
drop policy if exists "activities: teacher insert" on public.activities;
drop policy if exists "activities: teacher update" on public.activities;
drop policy if exists "activities: teacher delete" on public.activities;

create policy "activities: teacher read"
  on public.activities for select
  using (school_id = auth.uid());

create policy "activities: teacher insert"
  on public.activities for insert
  with check (school_id = auth.uid());

create policy "activities: teacher update"
  on public.activities for update
  using (school_id = auth.uid());

create policy "activities: teacher delete"
  on public.activities for delete
  using (school_id = auth.uid());

-- ── 4. RLS: activity_scores ───────────────────────────────────────────────────
alter table public.activity_scores enable row level security;

-- Teacher: access all scores for activities that belong to their school
drop policy if exists "activity_scores: teacher read"   on public.activity_scores;
drop policy if exists "activity_scores: teacher insert" on public.activity_scores;
drop policy if exists "activity_scores: teacher update" on public.activity_scores;
drop policy if exists "activity_scores: teacher delete" on public.activity_scores;

create policy "activity_scores: teacher read"
  on public.activity_scores for select
  using (
    exists (
      select 1 from public.activities a
      where a.id = activity_scores.activity_id
        and a.school_id = auth.uid()
    )
  );

create policy "activity_scores: teacher insert"
  on public.activity_scores for insert
  with check (
    exists (
      select 1 from public.activities a
      where a.id = activity_scores.activity_id
        and a.school_id = auth.uid()
    )
  );

create policy "activity_scores: teacher update"
  on public.activity_scores for update
  using (
    exists (
      select 1 from public.activities a
      where a.id = activity_scores.activity_id
        and a.school_id = auth.uid()
    )
  );

create policy "activity_scores: teacher delete"
  on public.activity_scores for delete
  using (
    exists (
      select 1 from public.activities a
      where a.id = activity_scores.activity_id
        and a.school_id = auth.uid()
    )
  );

-- Student: SELECT only their own published scores
-- Conditions:
--   (a) student_ref_id → students.id → auth_user_id = auth.uid()
--   (b) is_published = true
-- Students can never see another student's score, never an unpublished score,
-- and can never insert/update/delete.
drop policy if exists "activity_scores: student read own published" on public.activity_scores;

create policy "activity_scores: student read own published"
  on public.activity_scores for select
  using (
    is_published = true
    and exists (
      select 1 from public.students s
      where s.id           = activity_scores.student_ref_id
        and s.auth_user_id = auth.uid()
    )
  );

-- ── 5. Confirm ────────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='activities') as activities_table,
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='activity_scores') as scores_table,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='activities') as activity_policies,
  (select count(*) from pg_policies
    where schemaname='public' and tablename='activity_scores') as score_policies,
  'Migration 016 complete' as status;
