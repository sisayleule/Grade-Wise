-- =============================================================================
-- Migration: 001_schools  (idempotent — safe to re-run)
--
-- What this does:
--   1. Enables the Supabase Vault extension (pgsodium-backed)
--   2. Creates the schools table with gemini_key_secret_id (a UUID reference
--      into vault.secrets) instead of a plaintext gemini_api_key column
--   3. Row-Level Security: each school can only touch their own row
--   4. Trigger: auto-creates a schools row on new user sign-up
--   5. SECURITY DEFINER RPC: get_school_gemini_key(school_id) — the only
--      server-side path to decrypt a school's key; callable only by service role
--   6. SECURITY DEFINER RPCs: upsert_school_gemini_key / delete_school_gemini_key
--      — write through Vault instead of a plaintext column
--
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. Enable Vault ──────────────────────────────────────────────────────────
-- Vault is pre-installed on every Supabase project; this is a no-op if already on.
create extension if not exists supabase_vault with schema vault;

-- ── 2. Schools table ─────────────────────────────────────────────────────────
create table if not exists public.schools (
  id                    uuid primary key references auth.users(id) on delete cascade,
  name                  text not null default '',
  -- UUID reference into vault.secrets — NOT the raw key value
  gemini_key_secret_id  uuid references vault.secrets(id) on delete set null,
  created_at            timestamptz not null default now()
);

-- ── 3. Row-Level Security ─────────────────────────────────────────────────────
alter table public.schools enable row level security;

-- Drop existing policies to make this re-runnable
drop policy if exists "schools: read own row"   on public.schools;
drop policy if exists "schools: insert own row" on public.schools;
drop policy if exists "schools: update own row" on public.schools;

-- Each school may select only their own row.
-- gemini_key_secret_id is a harmless UUID reference — the secret itself lives
-- in vault.secrets and is never exposed through this policy.
create policy "schools: read own row"
  on public.schools for select
  using (auth.uid() = id);

create policy "schools: insert own row"
  on public.schools for insert
  with check (auth.uid() = id);

create policy "schools: update own row"
  on public.schools for update
  using (auth.uid() = id);

-- ── 4. Auto-create schools row on sign-up ────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.schools (id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'school_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── 5. RPC: get_school_gemini_key ─────────────────────────────────────────────
-- Callable by the server-side service role only.
-- Looks up the secret UUID for this school, then decrypts it via vault.decrypted_secrets.
-- Returns NULL if the school has no key stored.
-- SECURITY DEFINER: runs as the postgres superuser so it can read vault.decrypted_secrets
-- even though the calling role (service_role) cannot query that view directly.
drop function if exists public.get_school_gemini_key(uuid);
create or replace function public.get_school_gemini_key(school_id uuid)
returns text
language plpgsql
security definer set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_key       text;
begin
  -- Verify the caller is the service role (extra guard)
  if current_user not in ('postgres', 'service_role') then
    raise exception 'permission denied';
  end if;

  select gemini_key_secret_id
    into v_secret_id
    from public.schools
   where id = school_id;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret
    into v_key
    from vault.decrypted_secrets
   where id = v_secret_id;

  return v_key;
end;
$$;

-- Revoke from all, then grant only to service_role
revoke all on function public.get_school_gemini_key(uuid) from public, anon, authenticated;
grant execute on function public.get_school_gemini_key(uuid) to service_role;

-- ── 6. RPC: upsert_school_gemini_key ─────────────────────────────────────────
-- Creates or replaces the Vault secret for a school and stores only the UUID.
-- Called from the server-side POST /api/settings/gemini-key route.
drop function if exists public.upsert_school_gemini_key(uuid, text, text);
create or replace function public.upsert_school_gemini_key(
  school_id   uuid,
  raw_key     text,
  school_name text default null
)
returns void
language plpgsql
security definer set search_path = public, vault
as $$
declare
  v_existing_secret_id uuid;
  v_new_secret_id      uuid;
  v_secret_name        text;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'permission denied';
  end if;

  -- Use a stable secret name so we can update rather than always inserting new
  v_secret_name := 'school_gemini_key_' || school_id::text;

  -- Check if a secret already exists for this school
  select gemini_key_secret_id
    into v_existing_secret_id
    from public.schools
   where id = school_id;

  if v_existing_secret_id is not null then
    -- Update the existing secret in-place (keeps the same UUID)
    perform vault.update_secret(
      v_existing_secret_id,
      raw_key,
      v_secret_name,
      'Gemini API key for school ' || school_id::text
    );
  else
    -- Create a new secret and capture its UUID
    select vault.create_secret(
      raw_key,
      v_secret_name,
      'Gemini API key for school ' || school_id::text
    ) into v_new_secret_id;

    -- Upsert the school row storing only the reference UUID
    insert into public.schools (id, name, gemini_key_secret_id)
    values (
      school_id,
      coalesce(school_name, school_id::text),
      v_new_secret_id
    )
    on conflict (id) do update
      set gemini_key_secret_id = excluded.gemini_key_secret_id,
          name = coalesce(excluded.name, public.schools.name);
  end if;

  -- If school row exists but had no key yet, also set the name if provided
  if school_name is not null then
    update public.schools
       set name = school_name
     where id = school_id and name = '';
  end if;
end;
$$;

revoke all on function public.upsert_school_gemini_key(uuid, text, text) from public, anon, authenticated;
grant execute on function public.upsert_school_gemini_key(uuid, text, text) to service_role;

-- ── 7. RPC: delete_school_gemini_key ─────────────────────────────────────────
drop function if exists public.delete_school_gemini_key(uuid);
create or replace function public.delete_school_gemini_key(school_id uuid)
returns void
language plpgsql
security definer set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'permission denied';
  end if;

  select gemini_key_secret_id
    into v_secret_id
    from public.schools
   where id = school_id;

  -- NULLify the reference first
  update public.schools
     set gemini_key_secret_id = null
   where id = school_id;

  -- Delete the secret from vault (cleans up encrypted storage)
  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
end;
$$;

revoke all on function public.delete_school_gemini_key(uuid) from public, anon, authenticated;
grant execute on function public.delete_school_gemini_key(uuid) to service_role;

-- ── 8. Block direct vault access from anon/authenticated roles ───────────────
-- Belt-and-suspenders: ensure anon and authenticated cannot query vault views
revoke all on vault.secrets           from anon, authenticated;
revoke all on vault.decrypted_secrets from anon, authenticated;

-- ── 9. Confirm ───────────────────────────────────────────────────────────────
select
  'Migration complete' as status,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'schools') as schools_table,
  (select count(*) from information_schema.routines
    where routine_schema = 'public'
      and routine_name in (
        'get_school_gemini_key',
        'upsert_school_gemini_key',
        'delete_school_gemini_key'
      )) as vault_rpcs;
