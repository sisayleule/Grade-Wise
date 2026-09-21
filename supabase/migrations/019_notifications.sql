-- ── Migration 019: notifications table ───────────────────────────────────────
--
-- Creates the notifications table used by both the teacher and student portals.
-- The routes for /api/notifications and /api/student/notifications reference
-- this table — it must exist before those routes will work without errors.
--
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.notifications (
  id                   uuid primary key default gen_random_uuid(),

  -- Who receives this notification
  recipient_type       text not null check (recipient_type in ('teacher', 'student')),
  recipient_school_id  uuid references auth.users(id) on delete cascade,  -- set for teacher
  recipient_student_id uuid references public.students(id) on delete cascade, -- set for student

  -- Content
  title                text not null default '',
  body                 text not null default '',
  notification_type    text not null default 'info'
                       check (notification_type in ('info', 'result_published', 'activity_published', 'system')),

  -- Optional deep-link: type + id so the frontend can route to the right page
  link_type            text,   -- e.g. 'result_batch', 'activity'
  link_id              text,   -- the relevant UUID as a string

  is_read              boolean not null default false,
  created_at           timestamptz not null default now()
);

-- Constraint: exactly one of recipient_school_id / recipient_student_id must be set
alter table public.notifications
  drop constraint if exists notifications_recipient_check;

alter table public.notifications
  add constraint notifications_recipient_check check (
    (recipient_type = 'teacher'  and recipient_school_id  is not null and recipient_student_id is null) or
    (recipient_type = 'student'  and recipient_student_id is not null and recipient_school_id  is null)
  );

-- Indexes for the common query patterns
create index if not exists notifications_teacher_idx
  on public.notifications(recipient_school_id, is_read, created_at desc)
  where recipient_type = 'teacher';

create index if not exists notifications_student_idx
  on public.notifications(recipient_student_id, is_read, created_at desc)
  where recipient_type = 'student';

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.notifications enable row level security;

-- Teachers: read/update their own school's notifications
drop policy if exists "notifications: teacher read"       on public.notifications;
drop policy if exists "notifications: teacher mark read"  on public.notifications;

create policy "notifications: teacher read"
  on public.notifications for select
  using (recipient_type = 'teacher' and recipient_school_id = auth.uid());

create policy "notifications: teacher mark read"
  on public.notifications for update
  using (recipient_type = 'teacher' and recipient_school_id = auth.uid());

-- Students: read/update their own notifications
drop policy if exists "notifications: student read own"       on public.notifications;
drop policy if exists "notifications: student mark read own"  on public.notifications;

create policy "notifications: student read own"
  on public.notifications for select
  using (
    recipient_type = 'student'
    and exists (
      select 1 from public.students s
      where s.id           = notifications.recipient_student_id
        and s.auth_user_id = auth.uid()
    )
  );

create policy "notifications: student mark read own"
  on public.notifications for update
  using (
    recipient_type = 'student'
    and exists (
      select 1 from public.students s
      where s.id           = notifications.recipient_student_id
        and s.auth_user_id = auth.uid()
    )
  );

-- Service role (used by API routes to insert notifications): no policy needed
-- — service role bypasses RLS entirely.

-- ── Confirm ───────────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'notifications') as table_exists,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'notifications') as policy_count,
  'Migration 019 complete' as status;
