create extension if not exists pgcrypto;

create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  public_token uuid not null default gen_random_uuid() unique,
  status text not null default 'draft' check (
    status in ('draft', 'pending_payment', 'paid', 'fulfilled', 'cancelled', 'failed')
  ),
  currency text not null default 'NOK',
  customer_email text not null,
  customer_name text not null,
  customer_phone text,
  shipping_address_line1 text not null,
  shipping_postal_code text not null,
  shipping_city text not null,
  customer_note text not null default '',
  subtotal_nok integer not null default 0,
  shipping_nok integer not null default 0,
  vat_nok integer not null default 0,
  total_nok integer not null default 0,
  checkout_flow text not null default 'pay_now' check (
    checkout_flow in ('pay_now', 'klarna')
  ),
  checkout_session_id text,
  payment_intent_id text,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists shop_orders_status_idx on public.shop_orders(status);
create index if not exists shop_orders_created_at_idx on public.shop_orders(created_at desc);

create table if not exists public.shop_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shop_orders(id) on delete cascade,
  product_id text not null,
  product_slug text not null,
  nobb_number text not null,
  product_name text not null,
  supplier_name text not null,
  category text not null,
  unit text not null default 'STK',
  quantity integer not null default 1,
  unit_price_nok integer not null default 0,
  line_total_nok integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists shop_order_items_order_id_idx on public.shop_order_items(order_id);

alter table public.shop_orders enable row level security;
alter table public.shop_order_items enable row level security;

create or replace function public.set_shop_order_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists shop_orders_set_updated_at on public.shop_orders;
create trigger shop_orders_set_updated_at
before update on public.shop_orders
for each row
execute procedure public.set_shop_order_updated_at();
