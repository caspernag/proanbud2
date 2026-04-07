alter table public.projects
add column if not exists price_duel_cheapest_supplier text,
add column if not exists price_duel_savings_nok integer,
add column if not exists price_duel_compared_at timestamptz;
