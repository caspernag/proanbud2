-- ============================================================
-- Prisimport med gjennomgang av restene
--
-- En import treffer tre grupper: nye produkter, produkter som finnes fra før
-- (oppdateres), og produkter i katalogen som IKKE lå i filen. Den siste gruppen
-- ble tidligere enten slettet blindt eller liggende for alltid. Nå stemples hver
-- rad importen rørte med `last_import_id`, slik at restene kan listes opp og
-- beholdes eller slettes i bulk etterpå.
-- ============================================================

alter table public.storefront_products
  add column if not exists last_import_id text;

comment on column public.storefront_products.last_import_id is
  'ID-en til siste prisimport som bekreftet dette produktet (importert eller manuelt beholdt). Rader med en eldre ID er "rester" som venter på gjennomgang.';

-- Restene hentes som «leverandør X, men ikke stemplet av kjøring Y».
create index if not exists storefront_products_import_review_idx
  on public.storefront_products (supplier_name, last_import_id);

create table if not exists public.product_import_runs (
  id                text primary key,
  file_name         text        not null,
  supplier_name     text        not null default 'Byggmakker',
  format            text        not null default 'ukjent',
  sheet_name        text,
  parsed_rows       integer     not null default 0,
  inserted_count    integer     not null default 0,
  updated_count     integer     not null default 0,
  missing_count     integer     not null default 0,  -- rester ved importtidspunktet
  kept_count        integer     not null default 0,
  deleted_count     integer     not null default 0,
  status            text        not null default 'review',
  warnings          text[]      not null default '{}',
  mapped_columns    jsonb       not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  constraint product_import_runs_status_check check (status in ('review', 'done'))
);

create index if not exists product_import_runs_created_idx
  on public.product_import_runs (created_at desc);

-- Kun service-role (adminpanelet) skal se importkjøringer. RLS på uten policy
-- betyr at anon/authenticated ikke får noe — service-role går utenom RLS.
alter table public.product_import_runs enable row level security;
