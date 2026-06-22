-- ============================================================
-- Database hygiene (Supabase performance advisors)
-- Created: 2026-06-23
--
-- 1. auth_rls_initplan: wrap auth.<fn>() in (select auth.<fn>()) so Postgres
--    evaluates it once per query instead of once per row.
-- 2. Add the two missing foreign-key covering indexes.
-- 3. Resolve duplicate permissive SELECT policies on supplier_markups.
--
-- NOTE: the "unused index" advisories are intentionally NOT actioned here.
-- Those indexes were added in 20260603_performance_indexes.sql for known
-- dashboard/order query patterns and only read as "unused" because the tables
-- are tiny and traffic is low; write/storage cost is negligible at this scale.
-- ============================================================

-- ---------- projects ----------
drop policy if exists "Users can read own projects" on public.projects;
create policy "Users can read own projects" on public.projects
  for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own projects" on public.projects;
create policy "Users can insert own projects" on public.projects
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own projects" on public.projects;
create policy "Users can update own projects" on public.projects
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- material_orders ----------
drop policy if exists "Users can read own material orders" on public.material_orders;
create policy "Users can read own material orders" on public.material_orders
  for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own material orders" on public.material_orders;
create policy "Users can insert own material orders" on public.material_orders
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own material orders" on public.material_orders;
create policy "Users can update own material orders" on public.material_orders
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own material orders" on public.material_orders;
create policy "Users can delete own material orders" on public.material_orders
  for delete using ((select auth.uid()) = user_id);

-- ---------- material_order_items ----------
drop policy if exists "Users can read own material order items" on public.material_order_items;
create policy "Users can read own material order items" on public.material_order_items
  for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own material order items" on public.material_order_items;
create policy "Users can insert own material order items" on public.material_order_items
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own material order items" on public.material_order_items;
create policy "Users can update own material order items" on public.material_order_items
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own material order items" on public.material_order_items;
create policy "Users can delete own material order items" on public.material_order_items
  for delete using ((select auth.uid()) = user_id);

-- ---------- material_order_events ----------
drop policy if exists "Users can read own material order events" on public.material_order_events;
create policy "Users can read own material order events" on public.material_order_events
  for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own material order events" on public.material_order_events;
create policy "Users can insert own material order events" on public.material_order_events
  for insert with check ((select auth.uid()) = user_id);

-- ---------- material_order_returns ----------
drop policy if exists "Users can read own material order returns" on public.material_order_returns;
create policy "Users can read own material order returns" on public.material_order_returns
  for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own material order returns" on public.material_order_returns;
create policy "Users can insert own material order returns" on public.material_order_returns
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own material order returns" on public.material_order_returns;
create policy "Users can update own material order returns" on public.material_order_returns
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- material_order_return_items ----------
drop policy if exists "Users can read own material order return items" on public.material_order_return_items;
create policy "Users can read own material order return items" on public.material_order_return_items
  for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own material order return items" on public.material_order_return_items;
create policy "Users can insert own material order return items" on public.material_order_return_items
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own material order return items" on public.material_order_return_items;
create policy "Users can update own material order return items" on public.material_order_return_items
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------- material_order_return_attachments ----------
drop policy if exists "Users can read own material order return attachments" on public.material_order_return_attachments;
create policy "Users can read own material order return attachments" on public.material_order_return_attachments
  for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own material order return attachments" on public.material_order_return_attachments;
create policy "Users can insert own material order return attachments" on public.material_order_return_attachments
  for insert with check ((select auth.uid()) = user_id);

-- ---------- material_order_return_events ----------
drop policy if exists "Users can read own material order return events" on public.material_order_return_events;
create policy "Users can read own material order return events" on public.material_order_return_events
  for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own material order return events" on public.material_order_return_events;
create policy "Users can insert own material order return events" on public.material_order_return_events
  for insert with check ((select auth.uid()) = user_id);

-- ---------- shop_orders ----------
drop policy if exists "Users can view own shop orders" on public.shop_orders;
create policy "Users can view own shop orders" on public.shop_orders
  for select to authenticated using (customer_email = (select auth.email()));

-- ---------- supplier_markups ----------
-- Replace the catch-all ALL policy (which overlapped the public read policy on
-- SELECT → multiple_permissive) with scoped write policies. Reads stay covered
-- by "Allow read access to all users".
drop policy if exists "Allow all access to authenticated admins" on public.supplier_markups;

create policy "Authenticated can insert supplier markups" on public.supplier_markups
  for insert to authenticated with check ((select auth.role()) = 'authenticated');

create policy "Authenticated can update supplier markups" on public.supplier_markups
  for update to authenticated
  using ((select auth.role()) = 'authenticated')
  with check ((select auth.role()) = 'authenticated');

create policy "Authenticated can delete supplier markups" on public.supplier_markups
  for delete to authenticated using ((select auth.role()) = 'authenticated');

-- ---------- Missing foreign-key covering indexes ----------
create index if not exists material_order_return_items_order_item_id_idx
  on public.material_order_return_items (order_item_id);

create index if not exists material_order_returns_replacement_order_id_idx
  on public.material_order_returns (replacement_order_id);
