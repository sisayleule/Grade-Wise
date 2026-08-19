-- =============================================================================
-- Migration: 007_school_profile
--
-- Adds school profile fields to public.schools so they are stored in the
-- database instead of the browser's localStorage.
--
-- New columns:
--   teacher    text  — class teacher / prepared-by name shown on reports
--   principal  text  — principal / authorized-person name shown on reports
--   logo       text  — URL for the school logo image shown on reports
--   footer     text  — footer text shown on every printed report document
--
-- All columns default to '' so existing rows are unaffected.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- =============================================================================

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='schools' and column_name='teacher'
  ) then
    alter table public.schools add column teacher text not null default '';
    raise notice 'Added teacher column';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='schools' and column_name='principal'
  ) then
    alter table public.schools add column principal text not null default '';
    raise notice 'Added principal column';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='schools' and column_name='logo'
  ) then
    alter table public.schools add column logo text not null default '';
    raise notice 'Added logo column';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='schools' and column_name='footer'
  ) then
    alter table public.schools add column footer text not null default '';
    raise notice 'Added footer column';
  end if;
end $$;

-- Confirm
select column_name, data_type, column_default
from information_schema.columns
where table_schema='public' and table_name='schools'
  and column_name in ('teacher','principal','logo','footer')
order by column_name;
