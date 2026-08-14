-- Lås skrivetilgang til leverandørpåslag.
--
-- Påslagene bestemmer utsalgsprisen i butikken. Policyene tillot enhver
-- INNLOGGET bruker å endre dem (`auth.role() = 'authenticated'`), og den gamle
-- /admin-siden var kun innloggingsbeskyttet. En registrert kunde kunne dermed
-- sette påslaget til -100 % og handle under innkjøpspris.
--
-- Adminpanelet skriver nå via service-role, som går utenom RLS, så ingen
-- skrivepolicy for vanlige brukere er nødvendig. Lesetilgang beholdes fordi
-- prisberegningen i lib/price-markup.ts leser tabellen på request-stien.

drop policy if exists "Authenticated can insert supplier markups" on public.supplier_markups;
drop policy if exists "Authenticated can update supplier markups" on public.supplier_markups;
drop policy if exists "Authenticated can delete supplier markups" on public.supplier_markups;

-- Lesetilgang beholdes bevisst: påslagsprosenten er ikke hemmelig, og
-- storefronten leser den med anon-nøkkelen for å regne ut viste priser.
-- (Policyen "Allow read access to all users" står urørt.)
