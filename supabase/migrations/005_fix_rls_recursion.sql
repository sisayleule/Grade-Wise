-- =============================================================================
-- Migration: 005_fix_rls_recursion
--
-- The "admin reads all" and "admin updates any" policies added in 004 contain
-- a correlated subquery on public.schools inside the policy USING clause.
-- When an anon-role client queries public.schools, Postgres evaluates the
-- policy, which re-queries public.schools to check is_admin, which fires the
-- policy again — infinite recursion.  Postgres resolves this by returning
-- 0 rows silently, so requireApproved() always sees status=null → 'pending'.
--
-- Fix:
--   1. Drop the recursive policies.
--   2. Create a SECURITY DEFINER helper function that reads is_admin without
--      going through RLS — breaking the cycle.
--   3. Re-create the admin policies using that function instead of a subquery.
--   4. Keep the original "read own row" policy unchanged.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

-- ── 1. Drop the recursive policies ────────────────────────────────────────
drop policy if exists "schools: admin reads all"   on public.schools;
drop policy if exists "schools: admin updates any" on public.schools;

-- ── 2. Security-definer helper: is the current user an admin? ─────────────
-- SECURITY DEFINER bypasses RLS when it runs, so it can safely read
-- public.schools without triggering the calling policy.
create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.schools where id = auth.uid()),
    false
  );
$$;

-- Only the anon + authenticated roles should call this (no external access needed)
revoke all on function public.current_user_is_admin() from public;
grant execute on function public.current_user_is_admin() to anon, authenticated;

-- ── 3. Re-create policies using the helper (no recursive subquery) ─────────
create policy "schools: admin reads all"
  on public.schools for select
  using (
    auth.uid() = id                   -- own row
    or public.current_user_is_admin() -- OR calling user is admin
  );

create policy "schools: admin updates any"
  on public.schools for update
  using (
    auth.uid() = id
    or public.current_user_is_admin()
  );

-- ── 4. Verify policies ────────────────────────────────────────────────────
select policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'schools'
order by policyname;
