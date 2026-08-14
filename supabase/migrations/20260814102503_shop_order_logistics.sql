-- Logistikk-felter for butikkordre.
--
-- Bakgrunn: shop_orders hadde allerede transport_status/carrier/tracking_number,
-- men manglet (a) interne notater som ikke skal vises kunden, (b) tidsstempler
-- for de tidlige transportstegene slik at vi kan måle hvor lenge en ordre har
-- stått i kø, og (c) en maskinlesbar transportør-kode slik at sporingslenker
-- kan bygges automatisk.

alter table public.shop_orders
  add column if not exists internal_note text not null default '',
  add column if not exists carrier_code text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists packed_at timestamptz,
  add column if not exists customer_notified_at timestamptz;

-- Arbeidskøen filtrerer på (status, transport_status) og sorterer på paid_at.
create index if not exists shop_orders_logistics_queue_idx
  on public.shop_orders (status, transport_status, paid_at desc);

-- Avviksoppslaget henter siste byggmakker_order_email_*-hendelse per ordre.
create index if not exists shop_order_events_type_idx
  on public.shop_order_events (event_type, created_at desc);

-- Backfill: ordre som allerede har passert et steg får et best-effort tidsstempel
-- slik at køalderen ikke ser kunstig gammel ut for eksisterende ordre.
update public.shop_orders
set confirmed_at = coalesce(confirmed_at, paid_at)
where confirmed_at is null
  and transport_status in ('confirmed', 'packing', 'shipped', 'out_for_delivery', 'delivered');

update public.shop_orders
set packed_at = coalesce(packed_at, shipped_at, paid_at)
where packed_at is null
  and transport_status in ('packing', 'shipped', 'out_for_delivery', 'delivered');
