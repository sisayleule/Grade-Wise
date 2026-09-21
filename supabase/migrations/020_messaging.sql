-- =============================================================================
-- Migration: 020_messaging
--
-- Phase 7: Messaging & Complaints
--
-- Creates two tables:
--   student_messages  — one row per message thread initiated by a student
--   message_replies   — one row per reply in a thread (teacher or student)
--
-- Attachment support is intentionally excluded: Supabase Storage has not been
-- set up in this project. Adding attachments is a follow-up task that requires
-- storage bucket creation + signed-URL generation infrastructure.
--
-- RLS design:
--   student_messages:
--     Students: SELECT + INSERT only their own rows (student_ref_id → own students row).
--               May NOT update status or delete — teacher-only.
--     Teachers: SELECT all messages where school_id = auth.uid().
--               UPDATE (status only) on their own school's messages.
--               No INSERT — only students initiate threads.
--
--   message_replies:
--     Students: SELECT replies on their own threads (via message_id → student_ref_id).
--               INSERT new replies where message_id belongs to their thread AND
--               sender_type = 'student'. May not update or delete.
--     Teachers: SELECT all replies on their school's threads.
--               INSERT replies on their school's threads with sender_type = 'teacher'.
--               No update, no delete.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. student_messages ───────────────────────────────────────────────────────

create table if not exists public.student_messages (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references auth.users(id) on delete cascade,
  student_ref_id   uuid not null references public.students(id) on delete cascade,

  category         text not null
                   check (category in ('complaint', 'recommendation', 'question', 'other')),

  message          text not null default '',

  -- attachment_url intentionally omitted — Storage not yet configured.
  -- Add in a follow-up migration once Supabase Storage buckets are set up.

  status           text not null default 'pending'
                   check (status in ('pending', 'resolved', 'archived')),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function public.set_student_messages_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists student_messages_updated_at on public.student_messages;
create trigger student_messages_updated_at
  before update on public.student_messages
  for each row execute procedure public.set_student_messages_updated_at();

-- Indexes
create index if not exists student_messages_school_idx
  on public.student_messages(school_id, created_at desc);

create index if not exists student_messages_student_idx
  on public.student_messages(student_ref_id, created_at desc);

create index if not exists student_messages_status_idx
  on public.student_messages(school_id, status);

-- ── 2. message_replies ────────────────────────────────────────────────────────

create table if not exists public.message_replies (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.student_messages(id) on delete cascade,
  sender_type  text not null check (sender_type in ('teacher', 'student')),
  reply_text   text not null default '',
  created_at   timestamptz not null default now()
);

create index if not exists message_replies_message_idx
  on public.message_replies(message_id, created_at asc);

-- ── 3. RLS: student_messages ──────────────────────────────────────────────────

alter table public.student_messages enable row level security;

drop policy if exists "student_messages: student read own"   on public.student_messages;
drop policy if exists "student_messages: student insert own" on public.student_messages;
drop policy if exists "student_messages: teacher read"       on public.student_messages;
drop policy if exists "student_messages: teacher update"     on public.student_messages;

-- Students: SELECT their own threads
create policy "student_messages: student read own"
  on public.student_messages for select
  using (
    student_ref_id in (
      select s.id from public.students s
      where s.auth_user_id = auth.uid()
    )
  );

-- Students: INSERT new threads (school_id + student_ref_id must match their row)
create policy "student_messages: student insert own"
  on public.student_messages for insert
  with check (
    student_ref_id in (
      select s.id from public.students s
      where s.auth_user_id = auth.uid()
    )
    and
    school_id in (
      select s.school_id from public.students s
      where s.auth_user_id = auth.uid()
    )
  );

-- Teachers: SELECT all their school's messages
create policy "student_messages: teacher read"
  on public.student_messages for select
  using (school_id = auth.uid());

-- Teachers: UPDATE (status changes) on their school's messages
create policy "student_messages: teacher update"
  on public.student_messages for update
  using (school_id = auth.uid())
  with check (school_id = auth.uid());

-- ── 4. RLS: message_replies ───────────────────────────────────────────────────

alter table public.message_replies enable row level security;

drop policy if exists "message_replies: student read"   on public.message_replies;
drop policy if exists "message_replies: student insert" on public.message_replies;
drop policy if exists "message_replies: teacher read"   on public.message_replies;
drop policy if exists "message_replies: teacher insert" on public.message_replies;

-- Students: SELECT replies on their own threads
create policy "message_replies: student read"
  on public.message_replies for select
  using (
    message_id in (
      select sm.id from public.student_messages sm
      where sm.student_ref_id in (
        select s.id from public.students s
        where s.auth_user_id = auth.uid()
      )
    )
  );

-- Students: INSERT replies on their own threads, sender_type must be 'student'
create policy "message_replies: student insert"
  on public.message_replies for insert
  with check (
    sender_type = 'student'
    and
    message_id in (
      select sm.id from public.student_messages sm
      where sm.student_ref_id in (
        select s.id from public.students s
        where s.auth_user_id = auth.uid()
      )
    )
  );

-- Teachers: SELECT all replies on their school's threads
create policy "message_replies: teacher read"
  on public.message_replies for select
  using (
    message_id in (
      select sm.id from public.student_messages sm
      where sm.school_id = auth.uid()
    )
  );

-- Teachers: INSERT replies on their school's threads, sender_type must be 'teacher'
create policy "message_replies: teacher insert"
  on public.message_replies for insert
  with check (
    sender_type = 'teacher'
    and
    message_id in (
      select sm.id from public.student_messages sm
      where sm.school_id = auth.uid()
    )
  );

-- ── 5. Also add 'message_reply' to the notifications type check ───────────────
-- Migration 019 defined notification_type IN ('result_published',
-- 'activity_published', 'student_message'). Phase 7 adds 'message_reply' for
-- teacher-reply → student notifications.

alter table public.notifications
  drop constraint if exists notifications_notification_type_check;

alter table public.notifications
  add constraint notifications_notification_type_check
    check (notification_type in (
      'result_published',
      'activity_published',
      'student_message',
      'message_reply'
    ));

-- ── 6. Confirm ────────────────────────────────────────────────────────────────
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'student_messages') as messages_table,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'message_replies') as replies_table,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'student_messages') as message_policies,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'message_replies') as reply_policies,
  'Migration 020 complete' as status;
