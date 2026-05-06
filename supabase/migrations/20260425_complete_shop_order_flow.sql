alter table public.shop_orders
add column if not exists slug text,
add column if not exists transport_status text not null default 'pending' check (
  transport_status in ('pending', 'confirmed', 'packing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled')
),
add column if not exists carrier text,
add column if not exists tracking_number text,
add column if not exists tracking_url text,
add column if not exists estimated_delivery_date date,
add column if not exists shipped_at timestamptz,
add column if not exists delivered_at timestamptz,
add column if not exists last_status_note text not null default '';

update public.shop_orders
set slug = 'ordre-' || to_char(created_at, 'YYYYMMDD') || '-' || left(replace(id::text, '-', ''), 8)
where slug is null;

create unique index if not exists shop_orders_slug_key on public.shop_orders(slug) where slug is not null;
create index if not exists shop_orders_transport_status_idx on public.shop_orders(transport_status);

create table if not exists public.shop_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shop_orders(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system' check (actor_type in ('system', 'admin', 'customer')),
  actor_label text,
  message text not null default '',
  payload jsonb not null default '{}'::jsonb,
  is_customer_visible boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists shop_order_events_order_id_idx on public.shop_order_events(order_id, created_at desc);

create table if not exists public.shop_order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shop_orders(id) on delete cascade,
  author_type text not null check (author_type in ('customer', 'admin')),
  author_name text not null,
  author_email text,
  body text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists shop_order_messages_order_id_idx on public.shop_order_messages(order_id, created_at asc);

alter table public.shop_order_events enable row level security;
alter table public.shop_order_messages enable row level security;

drop policy if exists "Users can view own shop order events" on public.shop_order_events;
create policy "Users can view own shop order events"
  on public.shop_order_events
  for select
  to authenticated
  using (
    order_id in (
      select id from public.shop_orders
      where customer_email = auth.email()
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
      where customer_email = auth.email()
    )
  );