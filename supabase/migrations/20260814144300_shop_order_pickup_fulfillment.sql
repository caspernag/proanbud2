-- Pickup/leveringsvalg for butikkordre.
--
-- App-koden lagrer henteordre uten leveringsadresse og med valgt byggevarehus.
-- Disse feltene må derfor finnes på shop_orders før /sjefen og checkout kan
-- lese/skrive butikkordre som bruker henting.

alter table public.shop_orders
  add column if not exists delivery_mode text not null default 'delivery',
  add column if not exists pickup_store_id text,
  add column if not exists pickup_store_name text,
  alter column shipping_address_line1 drop not null,
  alter column shipping_postal_code drop not null,
  alter column shipping_city drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shop_orders_delivery_mode_check'
      and conrelid = 'public.shop_orders'::regclass
  ) then
    alter table public.shop_orders
      add constraint shop_orders_delivery_mode_check
      check (delivery_mode in ('delivery', 'pickup'));
  end if;
end $$;

comment on column public.shop_orders.delivery_mode is
  'Fulfillment type for storefront orders: delivery or pickup.';
comment on column public.shop_orders.pickup_store_id is
  'External/storefront identifier for the selected pickup store.';
comment on column public.shop_orders.pickup_store_name is
  'Display name for the selected pickup store.';
