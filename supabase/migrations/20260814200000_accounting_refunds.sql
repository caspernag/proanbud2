-- Kreditnotaer: refusjoner som må tilbakeføres i regnskapet.
--
-- En refusjon er ikke bare en utbetaling — den reduserer omsetningen OG den
-- utgående mva-en. Bokføres den ikke, betaler vi mva på et salg som ble
-- reversert, og omsetningen i regnskapet er for høy resten av året.
--
-- Egen tabell framfor negative rader i accounting_daybook: en refusjon skjer
-- typisk dager eller uker etter salget, og skal bokføres på refusjonsdatoen —
-- ikke tilbake på en salgsdag som allerede er bokført og avstemt.

create table if not exists public.accounting_refunds (
  id uuid primary key default gen_random_uuid(),

  -- Idempotensnøkkelen. Stripe kan sende samme refusjonshendelse flere ganger.
  stripe_refund_id text not null unique,

  order_id uuid references public.shop_orders(id) on delete set null,
  refund_date date not null,

  -- Beløpene som tilbakeføres, inkl. mva, i øre.
  goods_gross_ore bigint not null default 0,
  shipping_gross_ore bigint not null default 0,
  total_gross_ore bigint not null default 0,

  -- true når refusjonen dekker hele ordren. Delvise refusjoner fordeles ikke
  -- automatisk mellom varer og frakt — se lib/accounting/refunds.ts — og bør
  -- kontrolleres manuelt.
  is_full_refund boolean not null default false,
  needs_review boolean not null default false,

  status text not null default 'pending' check (status in ('pending', 'posted', 'failed')),
  fiken_journal_entry_id text,
  posted_at timestamptz,
  attempts integer not null default 0,
  error_message text,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on column public.accounting_refunds.needs_review is
  'Delvis refusjon der fordelingen mellom varer og frakt er antatt, ikke utledet.';

create index if not exists accounting_refunds_status_idx
  on public.accounting_refunds(status)
  where status <> 'posted';

create index if not exists accounting_refunds_order_id_idx
  on public.accounting_refunds(order_id);

alter table public.accounting_refunds enable row level security;

drop trigger if exists accounting_refunds_updated_at on public.accounting_refunds;
create trigger accounting_refunds_updated_at
  before update on public.accounting_refunds
  for each row execute function public.set_accounting_updated_at();
