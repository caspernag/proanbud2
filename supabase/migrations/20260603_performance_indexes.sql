-- ============================================================
-- Performance indexes and query optimizations
-- Created: 2026-06-03
-- ============================================================

-- ============================================================
-- 1. PROJECTS
-- Queries always filter by user_id. Also look up by slug.
-- slug already has a UNIQUE constraint (implicit index), nothing extra needed.
-- ============================================================

-- Composite: user_id + created_at — used on dashboard listing ordered by newest
create index if not exists projects_user_id_created_at_idx
  on public.projects (user_id, created_at desc);

-- Partial: fast lookup of paid projects per user (most common post-payment queries)
create index if not exists projects_user_id_paid_idx
  on public.projects (user_id)
  where payment_status = 'paid';


-- ============================================================
-- 2. MATERIAL ORDERS
-- material_orders_user_id_idx and material_orders_status_idx already exist.
-- Add composite to cover the dashboard query (user + status + date).
-- ============================================================

-- Composite: user_id + status — dashboard lists orders filtered by status
create index if not exists material_orders_user_status_idx
  on public.material_orders (user_id, status);

-- Composite: user_id + created_at — sorted listing on /min-side
create index if not exists material_orders_user_created_at_idx
  on public.material_orders (user_id, created_at desc);

-- Partial: active (non-terminal) orders — used for "open order value" widget
create index if not exists material_orders_active_idx
  on public.material_orders (user_id, total_nok)
  where status not in ('cancelled', 'failed');


-- ============================================================
-- 3. MATERIAL ORDER ITEMS
-- material_order_items_order_id_idx already exists.
-- Add composite to speed up the is_included filter which is used on every item fetch.
-- ============================================================

-- Composite: order_id + is_included — avoids full-scan on big orders
create index if not exists material_order_items_order_included_idx
  on public.material_order_items (order_id, is_included);

-- Composite: order_id + supplier_label — used to group items by supplier
create index if not exists material_order_items_order_supplier_idx
  on public.material_order_items (order_id, supplier_label);


-- ============================================================
-- 4. MATERIAL ORDER EVENTS
-- material_order_events_order_id_idx already exists.
-- Add event_type to allow the idempotency-check lookup to use an index-only scan.
-- ============================================================

-- Composite: order_id + event_type — used in idempotency checks before sending emails
create index if not exists material_order_events_order_event_type_idx
  on public.material_order_events (order_id, event_type);


-- ============================================================
-- 5. SHOP ORDERS
-- shop_orders_status_idx and shop_orders_created_at_idx already exist.
-- ============================================================

-- Composite: customer_email + created_at — RLS policy joins on customer_email;
-- adding created_at turns the subquery scan into an index-only scan
create index if not exists shop_orders_email_created_at_idx
  on public.shop_orders (customer_email, created_at desc);

-- Composite: status + paid_at — admin overview: filter paid orders by date range
create index if not exists shop_orders_status_paid_at_idx
  on public.shop_orders (status, paid_at desc)
  where paid_at is not null;


-- ============================================================
-- 6. SHOP ORDER EVENTS
-- shop_order_events_order_id_idx already exists (order_id, created_at desc).
-- Add event_type for the idempotency-check used before each email send.
-- ============================================================

create index if not exists shop_order_events_order_event_type_idx
  on public.shop_order_events (order_id, event_type);


-- ============================================================
-- 7. SHOP ORDER ITEMS
-- shop_order_items_order_id_idx already exists.
-- Add nobb_number — used for product lookups and unit resolution.
-- ============================================================

create index if not exists shop_order_items_nobb_number_idx
  on public.shop_order_items (nobb_number);


-- ============================================================
-- 8. NOBB IMAGES
-- nobb_images_null_until_idx already exists.
-- Primary key on nobb_number already covers the main lookup.
-- Nothing extra needed — table is a simple key-value cache.
-- ============================================================


-- ============================================================
-- 9. RLS POLICY OPTIMIZATION — shop_order_items subquery
--
-- Current policy uses a correlated subquery:
--   order_id in (select id from shop_orders where customer_email = auth.email())
-- This forces a nested loop scan on every shop_order_items read.
-- Replace with a security-definer function that Postgres can cache per session.
-- ============================================================

create or replace function public.current_user_email()
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select auth.email()
$$;

-- Drop and recreate the shop_order_items RLS policy to use the cached helper
drop policy if exists "Users can view own shop order items" on public.shop_order_items;
create policy "Users can view own shop order items"
  on public.shop_order_items
  for select
  to authenticated
  using (
    order_id in (
      select id from public.shop_orders
      where customer_email = public.current_user_email()
    )
  );

-- Same optimization for shop_order_events and shop_order_messages
drop policy if exists "Users can view own shop order events" on public.shop_order_events;
create policy "Users can view own shop order events"
  on public.shop_order_events
  for select
  to authenticated
  using (
    order_id in (
      select id from public.shop_orders
      where customer_email = public.current_user_email()
    )
    and is_customer_visible = true
  );

drop policy if exists "Users can view own shop order messages" on public.shop_order_messages;
create policy "Users can view own shop order messages"
  on public.shop_order_messages
  for select
  to authenticated
  using (
    order_id in (
      select id from public.shop_orders
      where customer_email = public.current_user_email()
    )
  );


-- ============================================================
-- 10. SUPPLIER MARKUPS — cache-friendly partial index
-- Table is tiny but read on every checkout. Ensure lookup by name is instant.
-- ============================================================

create index if not exists supplier_markups_name_lower_idx
  on public.supplier_markups (lower(supplier_name));
