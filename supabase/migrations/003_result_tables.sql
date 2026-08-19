-- =============================================================================
-- Migration: 003_result_tables
--
-- Creates result_batches and result_students tables.
-- Each school's results are isolated by school_id = auth.uid().
-- RLS policies mirror the schools table pattern.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── result_batches ────────────────────────────────────────────────────────────
create table if not exists public.result_batches (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references auth.users(id) on delete cascade,
  academic_year      text not null,
  grade              text not null,
  section            text not null,
  semester           text not null check (semester in ('Semester 1', 'Semester 2')),
  uploaded_file_name text not null default '',
  subjects           jsonb not null default '[]',
  num_students       integer not null default 0,
  processing_status  text not null default 'complete',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Unique constraint: one batch per (school, year, grade, section, semester)
  -- This is what drives duplicate detection.
  unique (school_id, academic_year, grade, section, semester)
);

-- Auto-update updated_at on every row change
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists result_batches_updated_at on public.result_batches;
create trigger result_batches_updated_at
  before update on public.result_batches
  for each row execute procedure public.set_updated_at();

-- ── result_students ───────────────────────────────────────────────────────────
create table if not exists public.result_students (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.result_batches(id) on delete cascade,
  student_id   text not null default '',
  student_name text not null default '',
  scores       jsonb not null default '{}',  -- { "English": 92, "Mathematics": 88, ... }
  total        numeric(8,2) not null default 0,
  average      numeric(6,2) not null default 0,
  percentage   numeric(6,2) not null default 0,
  rank         integer not null default 0
);

-- Index for fast per-batch lookups
create index if not exists result_students_batch_id_idx
  on public.result_students(batch_id);

-- ── Row-Level Security: result_batches ────────────────────────────────────────
alter table public.result_batches enable row level security;

drop policy if exists "result_batches: read own"   on public.result_batches;
drop policy if exists "result_batches: insert own" on public.result_batches;
drop policy if exists "result_batches: update own" on public.result_batches;
drop policy if exists "result_batches: delete own" on public.result_batches;

create policy "result_batches: read own"
  on public.result_batches for select
  using (auth.uid() = school_id);

create policy "result_batches: insert own"
  on public.result_batches for insert
  with check (auth.uid() = school_id);

create policy "result_batches: update own"
  on public.result_batches for update
  using (auth.uid() = school_id);

create policy "result_batches: delete own"
  on public.result_batches for delete
  using (auth.uid() = school_id);

-- ── Row-Level Security: result_students ───────────────────────────────────────
-- Students belong to a batch; access is via the batch's school_id.
alter table public.result_students enable row level security;

drop policy if exists "result_students: read own"   on public.result_students;
drop policy if exists "result_students: insert own" on public.result_students;
drop policy if exists "result_students: delete own" on public.result_students;

create policy "result_students: read own"
  on public.result_students for select
  using (
    exists (
      select 1 from public.result_batches rb
      where rb.id = result_students.batch_id
        and rb.school_id = auth.uid()
    )
  );

create policy "result_students: insert own"
  on public.result_students for insert
  with check (
    exists (
      select 1 from public.result_batches rb
      where rb.id = result_students.batch_id
        and rb.school_id = auth.uid()
    )
  );

create policy "result_students: delete own"
  on public.result_students for delete
  using (
    exists (
      select 1 from public.result_batches rb
      where rb.id = result_students.batch_id
        and rb.school_id = auth.uid()
    )
  );

-- ── Confirm ───────────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='result_batches') as batches_table,
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='result_students') as students_table,
  'Migration 003 complete' as status;
