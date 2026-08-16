-- ============================================================
-- Innkjøpspris og veiledende pris på katalogproduktene
-- Created: 2026-08-16
--
-- /sjefen skal kunne regne dekningsbidrag per produkt. Katalogen har til nå bare
-- båret utsalgsprisen (påslag + mva) og en visnings-listepris inkl. mva som er
-- klemt opp til vår egen pris når varen mangler rabatt — ingen av dem kan man
-- regne margin av. Prisfilen har begge råtallene, så vi lagrer dem som de er.
--
-- BEGGE KOLONNENE ER EKS. MVA, i motsetning til unit_price_nok/list_price_nok
-- som er inkl. mva. Se lib/product-margin.ts.
-- ============================================================

alter table public.storefront_products
  add column if not exists cost_price_ex_vat_nok numeric,
  add column if not exists list_price_ex_vat_nok numeric;

comment on column public.storefront_products.cost_price_ex_vat_nok is
  'Innkjøpspris (nettopris) eks. mva fra prisfilen, per salgsenhet. NULL = ukjent.';
comment on column public.storefront_products.list_price_ex_vat_nok is
  'Leverandørens veiledende pris eks. mva fra prisfilen, per salgsenhet. NULL = ukjent.';

-- ---------- Innkjøpsprisen skal aldri ut i butikken ----------
-- storefront_products leses med anon-nøkkelen, og RLS-policyen «Public read»
-- gir tilgang til ALLE kolonner i tabellen. Kolonnerettigheter er den eneste
-- sperren som holder innkjøpspris og margin utenfor det offentlige API-et.
--
-- Konsekvens: nye kolonner må legges til i denne grant-lista for å bli lesbare
-- i butikken. Det er med vilje — da må man ta stilling til om kolonnen er
-- offentlig, og butikken feiler høylytt i stedet for å lekke stille.
revoke select on public.storefront_products from anon, authenticated;
grant select (
  id,
  slug,
  nobb_number,
  product_name,
  supplier_name,
  brand,
  unit,
  price_unit,
  sales_unit,
  sales_unit_quantity,
  package_area_sqm,
  unit_price_nok,
  list_price_nok,
  section_title,
  category,
  description,
  ean,
  datasheet_url,
  image_path,
  image_url,
  technical_details,
  quantity_suggestion,
  quantity_reason,
  last_updated,
  source,
  popularity_score,
  search_text,
  last_import_id,
  updated_at
) on public.storefront_products to anon, authenticated;

-- ---------- Tilbakefylling for katalogen som allerede ligger inne ----------
-- unit_price_nok = round((innkjøp × (1 + påslag%) + fastpåslag) × 1,25), klemt
-- ned til veiledende pris. Der klemmen IKKE slo inn kan regnestykket snus og gi
-- innkjøpsprisen eksakt tilbake.
--
-- Slo klemmen inn er unit_price_nok = list_price_nok, og da vet vi ingenting om
-- innkjøpsprisen utover at den ligger et sted under — de radene står som NULL
-- («ukjent») til neste prisimport, i stedet for å få et oppdiktet tall.
with inverted as (
  select
    p.id,
    ((p.unit_price_nok::numeric / 1.25) - m.markup_fixed::numeric)
      / (1 + m.markup_percentage::numeric / 100) as cost_ex_vat
  from public.storefront_products p
  join public.supplier_markups m
    on lower(m.supplier_name) = lower(p.supplier_name)
  where p.cost_price_ex_vat_nok is null
    and p.unit_price_nok > 0
    and m.markup_percentage::numeric > -100
    -- Klemmen mot veiledende pris band ikke: prisen er ren påslagsregning.
    and (p.list_price_nok = 0 or p.unit_price_nok < p.list_price_nok)
)
update public.storefront_products p
set
  cost_price_ex_vat_nok = round(i.cost_ex_vat, 2),
  -- list_price_nok er lagret inkl. mva; veiledende pris eks. mva er den delt på 1,25.
  list_price_ex_vat_nok = case
    when p.list_price_nok > 0 then round(p.list_price_nok::numeric / 1.25, 2)
    else null
  end
from inverted i
where i.id = p.id
  and i.cost_ex_vat > 0;
