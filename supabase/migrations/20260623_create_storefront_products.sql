-- ============================================================
-- Storefront product catalog — Postgres snapshot
-- Created: 2026-06-23
--
-- The catalog previously lived only in an OpenAI vector store and was
-- downloaded + parsed on EVERY request (twice). On Vercel (serverless)
-- `"use cache"` does not persist across requests, so this happened on
-- essentially every page load.
--
-- This table is a fast, indexed, paginatable snapshot of the catalog,
-- refreshed periodically by a scheduled job (see /api/admin/catalog/refresh).
-- Prices are stored already marked-up + VAT-inclusive so the read path
-- never needs to read supplier_markups again.
-- ============================================================

create extension if not exists pg_trgm;

create table if not exists public.storefront_products (
  id                  text primary key,
  slug                text not null,
  nobb_number         text not null,
  product_name        text not null,
  supplier_name       text not null,
  brand               text not null default '',
  unit                text not null default 'STK',
  price_unit          text,
  sales_unit          text,
  sales_unit_quantity numeric,
  package_area_sqm    numeric,
  unit_price_nok      integer not null default 0,
  list_price_nok      integer not null default 0,
  section_title       text not null default 'Byggevarer',
  category            text not null default 'Diverse',
  description         text not null default '',
  ean                 text,
  datasheet_url       text,
  image_path          text,            -- denormalized from public.nobb_images.storage_path (cached object, CDN-served)
  image_url           text,            -- original external image URL from the catalog source (if any)
  technical_details   text[] not null default '{}',
  quantity_suggestion text not null default '1 stk',
  quantity_reason     text not null default '',
  last_updated        date not null default current_date,
  source              text not null default 'price_lists',
  popularity_score    integer not null default 0,  -- profile-independent ranking, precomputed at refresh
  search_text         text not null default '',    -- lowercased haystack (name+brand+desc+category+section+tech) for category ILIKE
  updated_at          timestamptz not null default now()
);

-- Lookup + browse indexes
create unique index if not exists storefront_products_slug_idx
  on public.storefront_products (slug);
create index if not exists storefront_products_nobb_idx
  on public.storefront_products (nobb_number);
create index if not exists storefront_products_category_idx
  on public.storefront_products (category);
create index if not exists storefront_products_supplier_idx
  on public.storefront_products (supplier_name);
create index if not exists storefront_products_unit_price_idx
  on public.storefront_products (unit_price_nok);
-- Default ("relevance"/popularity) browse ordering
create index if not exists storefront_products_popularity_idx
  on public.storefront_products (popularity_score desc, product_name);
-- Trigram index accelerates category-alias ILIKE filtering on the haystack
create index if not exists storefront_products_search_trgm_idx
  on public.storefront_products using gin (search_text gin_trgm_ops);

-- Public catalog data: anyone may read. `using (true)` is constant (no per-row
-- auth function), so it does not trigger the auth_rls_initplan lint.
alter table public.storefront_products enable row level security;
drop policy if exists "Public read storefront products" on public.storefront_products;
create policy "Public read storefront products"
  on public.storefront_products
  for select
  to anon, authenticated
  using (true);

-- ============================================================
-- Precomputed facets so the landing page never scans the whole catalog
-- (category/supplier counts, broad category counts, price range).
-- Single-row table (id = 1).
-- ============================================================
create table if not exists public.storefront_catalog_meta (
  id                    integer primary key default 1,
  categories            jsonb       not null default '[]'::jsonb,
  suppliers             jsonb       not null default '[]'::jsonb,
  category_counts       jsonb       not null default '{}'::jsonb,
  supplier_counts       jsonb       not null default '{}'::jsonb,
  broad_category_counts jsonb       not null default '{}'::jsonb,
  price_min             integer     not null default 0,
  price_max             integer     not null default 0,
  product_count         integer     not null default 0,
  refreshed_at          timestamptz not null default now(),
  constraint storefront_catalog_meta_singleton check (id = 1)
);

alter table public.storefront_catalog_meta enable row level security;
drop policy if exists "Public read storefront catalog meta" on public.storefront_catalog_meta;
create policy "Public read storefront catalog meta"
  on public.storefront_catalog_meta
  for select
  to anon, authenticated
  using (true);
