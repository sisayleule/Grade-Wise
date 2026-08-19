-- =============================================================================
-- Migration: 004_approval_gate
--
-- Adds two columns to public.schools:
--   status   text  default 'pending'  — 'pending' | 'approved' | 'rejected' | 'suspended'
--   is_admin boolean default false    — true only for the platform owner
--
-- Updates the new-user trigger so every signup starts as 'pending'.
-- The admin sets their own account to approved + is_admin=true via a
-- one-time SQL Editor query shown in the comment at the bottom.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. Add columns (idempotent) ────────────────────────────────────────────
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='schools' and column_name='status'
  ) then
    alter table public.schools add column status text not null default 'pending'
      check (status in ('pending','approved','rejected','suspended'));
    raise notice 'Added status column';
  else
    raise notice 'status column already exists';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='schools' and column_name='is_admin'
  ) then
    alter table public.schools add column is_admin boolean not null default false;
    raise notice 'Added is_admin column';
  else
    raise notice 'is_admin column already exists';
  end if;
end $$;

-- ── 2. Update the auto-create trigger to include status='pending' ──────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.schools (id, name, status, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'school_name', split_part(new.email, '@', 1)),
    'pending',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ── 3. Patch any existing rows that don't have a status yet ───────────────
-- (Rows created before this migration have no status — set them to 'approved'
--  so existing accounts don't get locked out.)
update public.schools
   set status = 'approved'
 where status = 'pending'
   and created_at < now() - interval '5 minutes';
-- Note: rows created in the last 5 minutes keep 'pending' — they're new signups.

-- ── 4. RLS: allow schools to read only their own status/is_admin ──────────
-- The existing "schools: read own row" policy already covers this
-- (it selects the whole row). No change needed there.

-- Allow admins to read ALL school rows (for the admin panel)
drop policy if exists "schools: admin reads all" on public.schools;
create policy "schools: admin reads all"
  on public.schools for select
  using (
    -- Either it's your own row, or you're an admin
    auth.uid() = id
    or exists (
      select 1 from public.schools
      where id = auth.uid() and is_admin = true
    )
  );

-- Allow admins to update any school row (for approve/reject)
drop policy if exists "schools: admin updates any" on public.schools;
create policy "schools: admin updates any"
  on public.schools for update
  using (
    auth.uid() = id
    or exists (
      select 1 from public.schools
      where id = auth.uid() and is_admin = true
    )
  );

-- ── 5. Confirm ────────────────────────────────────────────────────────────
select
  column_name, data_type, column_default
from information_schema.columns
where table_schema='public' and table_name='schools'
  and column_name in ('status','is_admin')
order by column_name;

-- =============================================================================
-- AFTER RUNNING THIS MIGRATION:
-- Set your own account to approved + admin with this one-time query
-- (replace the email with your actual login email):
--
--   update public.schools
--      set status   = 'approved',
--          is_admin = true
--    where id = (
--      select id from auth.users where email = 'zsisay535@gmail.com'
--    );
--
-- Then verify:
--   select id, name, status, is_admin from public.schools;
-- =============================================================================
