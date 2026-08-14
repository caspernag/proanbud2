-- Regnskapsfundament på butikkordre: salgsdokumentnummer og faktisk Stripe-gebyr.
--
-- 1) ORDRENUMMER
-- `id` er en uuid og `slug` er tilfeldig — ingen av dem duger som nummer på et
-- salgsdokument, som skal tildeles maskinelt i ubrutt rekkefølge.
--
-- Nummeret tildeles når ordren blir BETALT, ikke når raden opprettes. En rad
-- opprettes allerede når kunden starter checkout, og de aller fleste av dem blir
-- aldri betalt (forlatt handlekurv). Tildeling ved opprettelse ville brent
-- mesteparten av nummerserien på salg som aldri fant sted, og etterlatt en serie
-- full av hull. Tildeling ved betaling gir én nummer per faktisk salg.
--
-- Trigger framfor default-verdi fordi tildelingen må skje på en
-- statusovergang, og fordi den må være idempotent: Stripe-webhooken kan kjøre
-- flere ganger for samme ordre, og en ordre som allerede har fått nummer skal
-- beholde det.

create sequence if not exists public.shop_order_number_seq as bigint start with 1000;

alter table public.shop_orders
  add column if not exists order_number bigint;

comment on column public.shop_orders.order_number is
  'Salgsdokumentnummer. Tildeles maskinelt ved betaling, aldri ved opprettelse. NULL = ikke betalt ennå.';

-- Backfill av allerede betalte ordre, i betalingsrekkefølge slik at serien
-- følger kronologien.
with numbered as (
  select
    id,
    row_number() over (order by coalesce(paid_at, created_at), created_at, id) as rn
  from public.shop_orders
  where order_number is null
    and status in ('paid', 'fulfilled')
)
update public.shop_orders o
set order_number = 999 + numbered.rn
from numbered
where numbered.id = o.id;

select setval(
  'public.shop_order_number_seq',
  greatest(coalesce((select max(order_number) from public.shop_orders), 999), 999)
);

create unique index if not exists shop_orders_order_number_key
  on public.shop_orders(order_number)
  where order_number is not null;

create or replace function public.assign_shop_order_number()
returns trigger
language plpgsql
as $$
begin
  if new.order_number is null and new.status in ('paid', 'fulfilled') then
    new.order_number := nextval('public.shop_order_number_seq');
  end if;

  return new;
end;
$$;

drop trigger if exists shop_orders_assign_order_number on public.shop_orders;

create trigger shop_orders_assign_order_number
  before insert or update on public.shop_orders
  for each row
  execute function public.assign_shop_order_number();

-- 2) FAKTISK STRIPE-GEBYR
-- Dekningsbidraget bruker et estimert gebyr (STRIPE_PERCENT_FEE i
-- lib/order-economics.ts). Det er godt nok til marginvisning, men ubrukelig i
-- regnskapet: gebyret skal bokføres med sitt faktiske beløp, og Stripe-kontoen
-- skal avstemmes til øret. Beløpene lagres i ØRE, som er Stripes egen enhet —
-- resten av tabellen er i hele kroner, derfor `_ore`-suffikset.
alter table public.shop_orders
  add column if not exists stripe_fee_ore integer,
  add column if not exists stripe_net_ore integer,
  add column if not exists stripe_gross_ore integer,
  add column if not exists stripe_balance_txn_id text,
  add column if not exists stripe_payout_id text;

comment on column public.shop_orders.stripe_fee_ore is
  'Faktisk Stripe-gebyr i øre, fra balance transaction. NULL = ikke hentet ennå.';
comment on column public.shop_orders.stripe_net_ore is
  'Netto beløp Stripe krediterer oss, i øre (brutto minus gebyr).';
comment on column public.shop_orders.stripe_gross_ore is
  'Brutto beløp Stripe belastet kunden, i øre. Fasit ved avvik mot total_nok.';
comment on column public.shop_orders.stripe_payout_id is
  'Utbetalingen dette salget inngår i. Kobler salgsbilaget til bankbilaget.';

create index if not exists shop_orders_stripe_payout_id_idx
  on public.shop_orders(stripe_payout_id)
  where stripe_payout_id is not null;

-- Dagsoppgjøret henter ordre på betalingstidspunkt; uten denne blir det
-- full table scan hver natt.
create index if not exists shop_orders_paid_at_idx
  on public.shop_orders(paid_at)
  where paid_at is not null;
