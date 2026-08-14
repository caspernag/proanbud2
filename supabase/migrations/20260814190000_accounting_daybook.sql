-- Regnskapsbilag: dagsoppgjør for salg, og bilag for Stripe-utbetalinger.
--
-- HVORFOR DAGSOPPGJØR OG IKKE ETT BILAG PER ORDRE
-- Med 20–30 ordre om dagen blir det ~650 salgsbilag i måneden. Bokføringen
-- trenger ikke den granulariteten: den trenger summen per dag, så lenge hvert
-- enkelt salg kan spesifiseres bak summen. Spesifikasjonen ligger i
-- shop_orders + shop_order_items, og `order_ids` her peker på nøyaktig hvilke
-- ordre som utgjør bilaget.
--
-- ALLE BELØP I ØRE. Fiken regner i øre, og et dagsoppgjør som avrunder til
-- kroner vil aldri stemme mot Stripe-utbetalingen.

create table if not exists public.accounting_daybook (
  id uuid primary key default gen_random_uuid(),

  -- Idempotensnøkkelen. Ett bilag per dag, punktum. Cron-jobben kan kjøre
  -- flere ganger uten å dobbeltbokføre.
  booking_date date not null unique,

  gross_ore bigint not null default 0,
  goods_net_ore bigint not null default 0,
  shipping_net_ore bigint not null default 0,
  outgoing_vat_ore bigint not null default 0,

  order_count integer not null default 0,
  -- Bilagsspesifikasjonen: hvilke ordre summen består av.
  order_ids uuid[] not null default '{}',

  status text not null default 'pending' check (status in ('pending', 'posted', 'failed')),

  -- Settes ved suksess og skal ALDRI overskrives. Fiken-bilag kan ikke slettes,
  -- bare tilbakeføres — er denne satt, har vi allerede postet og skal aldri
  -- poste igjen.
  fiken_journal_entry_id text,
  posted_at timestamptz,
  attempts integer not null default 0,
  error_message text,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.accounting_daybook is
  'Ett salgsbilag per dag. order_ids er bilagsspesifikasjonen.';
comment on column public.accounting_daybook.booking_date is
  'Bokføringsdato i NORSK tid. Ordre plasseres etter paid_at omregnet til Europe/Oslo.';
comment on column public.accounting_daybook.fiken_journal_entry_id is
  'Bilagsnummer i Fiken. Satt = allerede postet, aldri post på nytt.';

create index if not exists accounting_daybook_status_idx
  on public.accounting_daybook(status)
  where status <> 'posted';

-- Stripe-utbetalinger. Uten disse henger Stripe-mellomkontoen (1930) i luften:
-- salgsbilaget debiterer den, og bare utbetalingsbilaget krediterer den.
create table if not exists public.accounting_payouts (
  id uuid primary key default gen_random_uuid(),

  stripe_payout_id text not null unique,
  payout_date date not null,

  gross_ore bigint not null default 0,
  fee_ore bigint not null default 0,
  net_ore bigint not null default 0,

  status text not null default 'pending' check (status in ('pending', 'posted', 'failed')),
  fiken_journal_entry_id text,
  posted_at timestamptz,
  attempts integer not null default 0,
  error_message text,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on column public.accounting_payouts.stripe_payout_id is
  'Idempotensnøkkelen. Stripe kan sende samme payout-webhook flere ganger.';

create index if not exists accounting_payouts_status_idx
  on public.accounting_payouts(status)
  where status <> 'posted';

-- Regnskapstabellene leses og skrives kun av service role (cron og /sjefen).
-- RLS på uten policies = ingen tilgang via anon/authenticated.
alter table public.accounting_daybook enable row level security;
alter table public.accounting_payouts enable row level security;

create or replace function public.set_accounting_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists accounting_daybook_updated_at on public.accounting_daybook;
create trigger accounting_daybook_updated_at
  before update on public.accounting_daybook
  for each row execute function public.set_accounting_updated_at();

drop trigger if exists accounting_payouts_updated_at on public.accounting_payouts;
create trigger accounting_payouts_updated_at
  before update on public.accounting_payouts
  for each row execute function public.set_accounting_updated_at();
