create extension if not exists pgcrypto;

create table if not exists public.material_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (
    status in ('draft', 'pending_payment', 'paid', 'submitted', 'cancelled', 'failed')
  ),
  currency text not null default 'NOK',
  delivery_mode text not null default 'delivery' check (delivery_mode in ('delivery', 'pickup')),
  desired_delivery_date date,
  earliest_delivery_date date,
  latest_delivery_date date,
  customer_note text not null default '',
  subtotal_nok integer not null default 0,
  delivery_fee_nok integer not null default 0,
  vat_nok integer not null default 0,
  total_nok integer not null default 0,
  checkout_session_id text,
  payment_intent_id text,
  paid_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists material_orders_user_id_idx on public.material_orders(user_id);
create index if not exists material_orders_project_id_idx on public.material_orders(project_id);
create index if not exists material_orders_status_idx on public.material_orders(status);

create table if not exists public.material_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.material_orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  section_title text not null,
  product_name text not null,
  quantity_value numeric(12, 3) not null default 1,
  quantity_unit text not null default 'stk',
  unit_price_nok integer not null default 0,
  line_total_nok integer not null default 0,
  supplier_key text not null check (supplier_key in ('byggmakker', 'monter_optimera', 'byggmax', 'xl_bygg')),
  supplier_label text not null,
  supplier_sku text,
  estimated_delivery_days integer not null default 5,
  estimated_delivery_date date,
  note text not null default '',
  is_included boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists material_order_items_order_id_idx on public.material_order_items(order_id);
create index if not exists material_order_items_user_id_idx on public.material_order_items(user_id);

create table if not exists public.material_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.material_orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists material_order_events_order_id_idx on public.material_order_events(order_id);
create index if not exists material_order_events_user_id_idx on public.material_order_events(user_id);

alter table public.material_orders enable row level security;
alter table public.material_order_items enable row level security;
alter table public.material_order_events enable row level security;

drop policy if exists "Users can read own material orders" on public.material_orders;
create policy "Users can read own material orders"
on public.material_orders
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own material orders" on public.material_orders;
create policy "Users can insert own material orders"
on public.material_orders
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own material orders" on public.material_orders;
create policy "Users can update own material orders"
on public.material_orders
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own material orders" on public.material_orders;
create policy "Users can delete own material orders"
on public.material_orders
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read own material order items" on public.material_order_items;
create policy "Users can read own material order items"
on public.material_order_items
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own material order items" on public.material_order_items;
create policy "Users can insert own material order items"
on public.material_order_items
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own material order items" on public.material_order_items;
create policy "Users can update own material order items"
on public.material_order_items
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own material order items" on public.material_order_items;
create policy "Users can delete own material order items"
on public.material_order_items
for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read own material order events" on public.material_order_events;
create policy "Users can read own material order events"
on public.material_order_events
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own material order events" on public.material_order_events;
create policy "Users can insert own material order events"
on public.material_order_events
for insert
with check (auth.uid() = user_id);

create or replace function public.set_material_order_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists material_orders_set_updated_at on public.material_orders;
create trigger material_orders_set_updated_at
before update on public.material_orders
for each row
execute procedure public.set_material_order_updated_at();

drop trigger if exists material_order_items_set_updated_at on public.material_order_items;
create trigger material_order_items_set_updated_at
before update on public.material_order_items
for each row
execute procedure public.set_material_order_updated_at();
