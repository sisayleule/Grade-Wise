-- =============================================================================
-- Migration: 002_migrate_to_vault
--
-- The schools table was created by the first migration run with the old
-- gemini_api_key text column before the vault migration added
-- gemini_key_secret_id.  This migration:
--
--   1. Adds the gemini_key_secret_id column if it doesn't exist
--   2. For any existing rows that have a plaintext key in gemini_api_key,
--      migrates them into Vault and stores only the UUID reference
--   3. Drops the plaintext gemini_api_key column
--
-- Safe to re-run (all steps are idempotent).
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. Add vault reference column (no-op if already exists) ──────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'schools'
       and column_name  = 'gemini_key_secret_id'
  ) then
    alter table public.schools
      add column gemini_key_secret_id uuid references vault.secrets(id) on delete set null;
    raise notice 'Added gemini_key_secret_id column';
  else
    raise notice 'gemini_key_secret_id column already exists — skipping';
  end if;
end $$;

-- ── 2. Migrate any existing plaintext keys into Vault ────────────────────────
-- If gemini_api_key column still exists, move each non-null value into Vault
-- and replace it with the returned UUID reference.
do $$
declare
  r           record;
  v_secret_id uuid;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'schools'
       and column_name  = 'gemini_api_key'
  ) then
    for r in
      select id, gemini_api_key
        from public.schools
       where gemini_api_key is not null
         and gemini_api_key <> ''
         -- only migrate rows that don't already have a vault reference
         and gemini_key_secret_id is null
    loop
      -- Store the plaintext key in Vault (encrypted at rest)
      select vault.create_secret(
        r.gemini_api_key,
        'school_gemini_key_' || r.id::text,
        'Gemini API key for school ' || r.id::text
      ) into v_secret_id;

      -- Write the UUID reference back to the schools row
      update public.schools
         set gemini_key_secret_id = v_secret_id
       where id = r.id;

      raise notice 'Migrated key for school % into vault secret %', r.id, v_secret_id;
    end loop;
  else
    raise notice 'gemini_api_key column does not exist — nothing to migrate';
  end if;
end $$;

-- ── 3. Drop the plaintext column ─────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'schools'
       and column_name  = 'gemini_api_key'
  ) then
    alter table public.schools drop column gemini_api_key;
    raise notice 'Dropped gemini_api_key column';
  else
    raise notice 'gemini_api_key column already gone — skipping';
  end if;
end $$;

-- ── 4. Verify ─────────────────────────────────────────────────────────────────
select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'schools'
order by ordinal_position;

-- Expected: id (uuid), name (text), gemini_key_secret_id (uuid), created_at (timestamptz)
-- gemini_api_key should NOT appear.
