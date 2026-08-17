-- ============================================================
-- Grant på search_tsv
-- Opprettet: 2026-08-17
--
-- storefront_products bruker kolonne-grants, ikke tabell-grants: anon og
-- authenticated har SELECT på en eksplisitt liste, slik at innkjøpspris og
-- veiledende pris eks. mva ikke er lesbare fra butikken.
--
-- Konsekvensen er at HVER nye kolonne må grantes eksplisitt. search_tsv ble
-- lagt til i 20260817120654 uten grant, og siden
-- search_storefront_product_candidates er security invoker, feilet hele søket
-- med «permission denied for table storefront_products» for anonyme besøkende.
--
-- search_tsv er avledet av kolonner som allerede er offentlige (produktnavn,
-- merke, kategori, beskrivelse), så den eksponerer ingenting nytt.
-- ============================================================

grant select (search_tsv) on public.storefront_products to anon, authenticated;
