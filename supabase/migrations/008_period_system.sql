-- =============================================================================
-- Migration: 008_period_system
--
-- Adds period_system column to public.schools.
--
--   period_system  text  default 'semester'
--     Allowed values: 'semester' | 'quarter'
--     All existing schools default to 'semester' — no behaviour change unless
--     a school actively changes this setting to 'quarter'.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'schools'
      and column_name  = 'period_system'
  ) then
    alter table public.schools
      add column period_system text not null default 'semester'
        check (period_system in ('semester', 'quarter'));
    raise notice 'Added period_system column to public.schools';
  else
    raise notice 'period_system column already exists — skipping';
  end if;
end $$;

-- Confirm
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'schools'
  and column_name  = 'period_system';
