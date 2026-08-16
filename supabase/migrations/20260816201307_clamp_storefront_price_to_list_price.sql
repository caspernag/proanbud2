-- Påslaget skal aldri overgå innkjøpsrabatten: utsalgsprisen kan ikke ende over
-- leverandørens veiledende pris. Sperren manglet i beregningen av butikkprisen
-- (lib/storefront.ts), så katalogen har fått rader der vi er dyrere enn
-- Byggmakker selv. Koden er rettet — denne migrasjonen rydder opp i snapshotet
-- som allerede ligger i basen.
--
-- unit_price_nok er lagret ferdig påslagt og inkl. mva. Vi regner oss tilbake til
-- innkjøpspris inkl. mva slik at varer uten reell rabatt (veiledende pris under
-- vår egen innkjøpspris) havner på null margin i stedet for med tap.

with netto as (
  select
    p.id,
    p.list_price_nok::numeric as listepris,
    ((p.unit_price_nok::numeric / 1.25) - m.markup_fixed::numeric)
      / (1 + m.markup_percentage::numeric / 100)
      * 1.25 as innkjop_inkl_mva
  from public.storefront_products p
  join public.supplier_markups m
    on lower(m.supplier_name) = lower(p.supplier_name)
  where p.list_price_nok > 0
    and p.unit_price_nok > p.list_price_nok
    and m.markup_percentage::numeric > -100
)
update public.storefront_products p
set
  unit_price_nok = greatest(1, round(greatest(n.listepris, n.innkjop_inkl_mva))::integer),
  updated_at = now()
from netto n
where n.id = p.id;
