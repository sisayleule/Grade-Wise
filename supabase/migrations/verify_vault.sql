-- =============================================================================
-- Vault verification queries
-- Run these in the Supabase SQL Editor after adding a key via the Settings page.
-- Every check should show NO readable key value in the schools table.
-- =============================================================================

-- 1. Confirm the schools table has NO plaintext key column
--    Should return columns: id, name, gemini_key_secret_id, created_at
--    If you see a "gemini_api_key" column, the migration didn't run yet.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'schools'
 order by ordinal_position;

-- 2. Inspect all school rows — you should see only a UUID reference, never a key string
--    gemini_key_secret_id should look like: "7095d222-efe5-4cd5-b5c6-5755b451e223"
--    NOT like: "AQ.Ab8RN6JPID2..."
select id, name, gemini_key_secret_id, created_at
  from public.schools;

-- 3. Inspect vault.secrets — the encrypted blob for the school's key
--    "secret" column is the ciphertext (base64 garbled string, NOT the raw key)
--    "decrypted_secret" is only available via vault.decrypted_secrets view
select id, name, description,
       left(secret, 40) || '...' as secret_ciphertext_preview,
       created_at, updated_at
  from vault.secrets
 where name like 'school_gemini_key_%'
 order by created_at desc;

-- 4. Confirm the three RPC functions exist and have correct security settings
select routine_name, security_type, routine_definition is not null as has_body
  from information_schema.routines
 where routine_schema = 'public'
   and routine_name in (
       'get_school_gemini_key',
       'upsert_school_gemini_key',
       'delete_school_gemini_key'
   )
 order by routine_name;

-- 5. Confirm anon/authenticated are blocked from vault
--    Should return 0 rows (no privileges granted)
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'vault'
   and table_name   in ('secrets', 'decrypted_secrets')
   and grantee      in ('anon', 'authenticated');

-- Expected results:
-- Query 1: 4 columns — id, name, gemini_key_secret_id, created_at (no gemini_api_key)
-- Query 2: rows with a UUID in gemini_key_secret_id, NOT a raw key string
-- Query 3: ciphertext preview is base64 noise, not an "AQ." key
-- Query 4: all 3 functions present, security_type = 'DEFINER'
-- Query 5: 0 rows (anon/authenticated have no vault access)
