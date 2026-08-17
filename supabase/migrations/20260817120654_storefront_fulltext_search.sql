-- ============================================================
-- Fulltekstsøk i Postgres for storefront_products
-- Opprettet: 2026-08-17
--
-- Bakgrunn: ethvert søk kalte getStorefrontProducts(), som paginerte ned hele
-- katalogen (3 864 rader) og scoret den i JS. `use cache` lagrer in-memory og
-- persisterer normalt ikke mellom requests på serverless, så dette skjedde i
-- praksis på de fleste søk — og på hvert tastetrykk i autocomplete.
--
-- Løsningen er TO-TRINNS, ikke å flytte hele scoringen til SQL:
--   1) SQL velger ut kandidater (indeksert: FTS + trigram + NOBB/EAN)
--   2) JS scorer og rangerer de få hundre kandidatene med den eksisterende,
--      nøye tunede scoreStorefrontProduct()
--
-- Slik forsvinner fullkatalog-lastingen uten at søkekvaliteten endres.
-- ============================================================

-- Vektet tsvector. Produktnavn veier tyngst (A), merke/kategori (B),
-- beskrivelse lettest (C) — samme rangering som JS-scoreren.
--
-- technical_details er bevisst utelatt: array_to_string() er STABLE, ikke
-- IMMUTABLE, og kan derfor ikke stå i et generated-uttrykk. Feltet er uansett
-- det lavest vektede i scoreStorefrontProduct(), og dekkes fortsatt av
-- trigram-indeksen på search_text (som inneholder det).
alter table public.storefront_products
  add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('norwegian', coalesce(product_name, '')), 'A') ||
    setweight(to_tsvector('norwegian', coalesce(brand, '') || ' ' || coalesce(category, '')), 'B') ||
    setweight(to_tsvector('norwegian', coalesce(description, '')), 'C')
  ) stored;

create index if not exists storefront_products_search_tsv_idx
  on public.storefront_products using gin (search_tsv);

-- Trigram på produktnavn. Den eksisterende gin-indeksen ligger på search_text
-- (hele høystakken); et eget navn-indeks gjør prefikssøk som «gips» →
-- «GIPSPLATE STD ...» billig, som er den vanligste søkeformen i butikken.
create index if not exists storefront_products_name_trgm_idx
  on public.storefront_products using gin (lower(product_name) gin_trgm_ops);

-- EAN slås opp direkte ved strekkodesøk.
create index if not exists storefront_products_ean_idx
  on public.storefront_products (ean)
  where ean is not null;


-- ============================================================
-- Kandidatutvelgelse.
--
-- Returnerer et lite, indeksert utvalg som JS-scoreren rangerer videre.
-- Rekkefølgen her styrer bare HVILKE kandidater som kommer med når treffene
-- er flere enn max_candidates — den endelige rangeringen skjer i JS.
-- ============================================================

-- Returtypen er en EKSPLISITT kolonneliste, ikke `setof storefront_products`.
-- Katalogtabellen inneholder innkjøpspris og veiledende pris eks. mva, som
-- anon ikke har grant på — `select sp.*` ville enten lekket dem eller feilet
-- på kolonnerettigheter. Listen speiler STOREFRONT_PRODUCT_COLUMNS i
-- lib/storefront-catalog-db.ts.
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
      websearch_to_tsquery('norwegian', btrim(q))    as tsq
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


-- ============================================================
-- Kategoritellinger for autocomplete.
--
-- /api/store/suggestions lastet hele katalogen bare for å telle kategorier,
-- også for tomme søk. Dette gjør det til én indeksert aggregering.
-- ============================================================

create or replace function public.storefront_category_counts()
  returns table (category text, product_count bigint)
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select sp.category, count(*) as product_count
  from public.storefront_products sp
  group by sp.category
  order by count(*) desc, sp.category asc;
$$;

grant execute on function public.storefront_category_counts() to anon, authenticated;
