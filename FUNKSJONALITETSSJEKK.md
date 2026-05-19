# Funksjonalitetssjekk 19. mai 2026

## Resultat

Ingen funksjonelle feil ble funnet i lokal verifisering.

## Kontrollert

- `pnpm lint`: besto med 0 feil og 22 advarsler.
- `pnpm test`: besto med 66 tester, 1 smoke-test hoppet over.
- `pnpm build`: besto, inkludert TypeScript-sjekk og generering av 48 statiske sider.
- Runtime-smoke mot lokal produksjonsserver på `http://localhost:3020`.

## Smoke-testede flater

- Nettbutikk: `/`, `/?q=gips`, `/checkout`.
- Offentlige sider: `/login`, `/landing`, `/sjefen`.
- Beskyttede sider: `/min-side`, `/min-side/materiallister`, `/prosjekter`, `/admin` redirectet korrekt til `/login`.
- API-er: `/api/store/products?page=1&pageSize=1`, `/api/store/products?page=1&pageSize=1&stock=0`, `/api/brreg/search?q=test`, `/api/addresses/search?q=Oslo`.

## Ikke-blokkerende advarsler

- 15 ESLint-advarsler om ubrukte variabler/parametere i tester, mocks og komponenter.
- 7 ESLint-advarsler om bruk av `<img>` der Next anbefaler `<Image />`, hovedsakelig i dokument-/ordrevisninger.

## Avgrensning

Eksterne produksjonsflyter som faktisk Stripe-betaling, Supabase-skriving, OpenAI-kall og leverandørintegrasjoner ble ikke fullført ende til ende med live credentials. Disse ble dekket så langt lokalt miljø og eksisterende tester tillater.