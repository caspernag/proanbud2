-- ============================================================
-- Dimensjonssøk: «48x98» skal finne «GRAN 48X098 K-VIRKE C24»
-- Opprettet: 2026-08-17
--
-- Prislisten skriver dimensjoner nullpolstret (48X098, 36X048, 19X098), mens
-- folk søker slik de sier det (48x98, 36x48). Ingen av dem matchet hverandre —
-- verken i SQL-kandidatutvelgelsen eller i JS-scoreren. «48x98» ligger til og
-- med som forslag i POPULAR_SEARCHES, så butikken foreslo et søk som ga null
-- treff.
--
-- Fiksen er å kanonisere BEGGE sider til samme form: fjern ledende nuller i
-- tall. Da blir både «48x98» og «48x098» til «48x98», uansett hvilken form
-- brukeren skriver eller prislisten bruker.
--
-- Samme uttrykk finnes som stripLeadingZerosInNumbers() i lib/storefront.ts, og
-- MÅ holdes i synk med dette — ellers slipper kandidater gjennom SQL som
-- JS-scoreren forkaster, eller motsatt.
--
-- Desimaler er trygge: 0+ etterfulgt av et siffer er kravet, så «12,5» og «0.5»
-- røres ikke.
-- ============================================================

alter table public.storefront_products
  add column if not exists search_dims text
  generated always as (
    regexp_replace(
      lower(coalesce(product_name, '') || ' ' || coalesce(description, '')),
      '(^|[^0-9])0+([0-9])',
      '\1\2',
      'g'
    )
  ) stored;

-- Trigram, fordi oppslaget er delstreng ('%48x98%') midt inne i produktnavnet.
create index if not exists storefront_products_search_dims_trgm_idx
  on public.storefront_products using gin (search_dims gin_trgm_ops);

-- Kolonne-grants: storefront_products bruker eksplisitt kolonneliste for
-- anon/authenticated. Uten dette feiler HELE søket med «permission denied»,
-- fordi RPC-en er security invoker — samme felle som search_tsv i
-- 20260817122147.
grant select (search_dims) on public.storefront_products to anon, authenticated;


-- ============================================================
-- Kandidatutvelgelsen tar inn den kanoniserte formen.
-- ============================================================

create or replace function public.search_storefront_product_candidates(
  q               text,
  category_filter text[] default null,
  supplier_filter text default null,
  max_candidates  integer default 600
)
  returns table (
    id                  text,
    slug                text,
    nobb_number         text,
    product_name        text,
    supplier_name       text,
    brand               text,
    unit                text,
    price_unit          text,
    sales_unit          text,
    sales_unit_quantity numeric,
    package_area_sqm    numeric,
    unit_price_nok      integer,
    list_price_nok      integer,
    section_title       text,
    category            text,
    description         text,
    ean                 text,
    datasheet_url       text,
    image_path          text,
    image_url           text,
    technical_details   text[],
    quantity_suggestion text,
    quantity_reason     text,
    last_updated        date,
    source              text,
    popularity_score    integer
  )
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  with input as (
    select
      lower(btrim(q))                                as needle,
      regexp_replace(coalesce(q, ''), '\D', '', 'g') as digits,
      websearch_to_tsquery('norwegian', btrim(q))    as tsq,
      -- Samme kanonisering som search_dims, pluss «48 x 98» → «48x98» slik
      -- JS-normaliseringen gjør, så mellomromsvarianten også treffer.
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(q, ''))), '(\d)\s*[xX×]\s*(\d)', '\1x\2', 'g'),
        '(^|[^0-9])0+([0-9])', '\1\2', 'g'
      )                                              as needle_dims
  )
  select
    sp.id, sp.slug, sp.nobb_number, sp.product_name, sp.supplier_name, sp.brand,
    sp.unit, sp.price_unit, sp.sales_unit, sp.sales_unit_quantity, sp.package_area_sqm,
    sp.unit_price_nok, sp.list_price_nok, sp.section_title, sp.category, sp.description,
    sp.ean, sp.datasheet_url, sp.image_path, sp.image_url, sp.technical_details,
    sp.quantity_suggestion, sp.quantity_reason, sp.last_updated, sp.source, sp.popularity_score
  from public.storefront_products sp, input i
  where
    (category_filter is null or sp.category = any(category_filter))
    and (supplier_filter is null or sp.supplier_name = supplier_filter)
    and (
      -- Eksakt NOBB/EAN — strekkodesøk og direkte varenummer
      (length(i.digits) >= 4 and sp.nobb_number like i.digits || '%')
      or (length(i.digits) >= 6 and sp.ean = i.digits)
      -- Fulltekst
      or (i.tsq is not null and sp.search_tsv @@ i.tsq)
      -- Delstreng, trigram-akselerert: fanger «gips» → «gipsplate», som
      -- stemming alene ikke gjør
      or (length(i.needle) >= 2 and lower(sp.product_name) like '%' || i.needle || '%')
      or (length(i.needle) >= 3 and sp.search_text like '%' || i.needle || '%')
      -- Dimensjoner på kanonisk form: «48x98» finner «48X098»
      or (length(i.needle_dims) >= 3 and sp.search_dims like '%' || i.needle_dims || '%')
    )
  order by
    -- Eksakt varenummer først, så fulltekstrangering, så popularitet
    (length(i.digits) >= 6 and (sp.nobb_number = i.digits or sp.ean = i.digits)) desc,
    case when i.tsq is not null then ts_rank(sp.search_tsv, i.tsq) else 0 end desc,
    sp.popularity_score desc,
    sp.product_name asc
  limit greatest(1, least(max_candidates, 2000));
$$;

grant execute on function public.search_storefront_product_candidates(text, text[], text, integer)
  to anon, authenticated;
