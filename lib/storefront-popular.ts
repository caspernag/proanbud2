import "server-only";

import { cacheLife } from "next/cache";

import { calculateProductMargin } from "@/lib/product-margin";
import { getStorefrontProductsByNobb } from "@/lib/storefront";
import { STOREFRONT_PRODUCTS_TABLE } from "@/lib/storefront-catalog-db";
import type { StorefrontProduct } from "@/lib/storefront-types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Kandidatlista til «Mest populære byggevarer» på forsiden.
 *
 * Rekkefølgen er den faktiske populariteten blant privatkunder — den kan ikke
 * hentes fra `popularity_score`, som er en grov kategoriscore (all
 * konstruksjonsvirke har 105) og derfor ikke skiller en 48x198 bjelke fra en
 * trekantlekt. Lista er bevisst større enn stripa: varer uten margin filtreres
 * bort av `rankPopularStorefrontProducts`, og da må det finnes populære
 * alternativer igjen å fylle plassene med.
 */
export const POPULAR_STOREFRONT_NOBB = [
  // Plater
  "10397701", // GIPSPLATE STD 1200X2400X12,5
  "10397735", // GIPSPLATE STD 1200X2700X12,5
  "27133248", // GIPSPLATE GU-X 1200X2700X9,5 (vindtett)
  "48052442", // GIPSPLATE 900X2500X6,5 REHAB
  "60638110", // OSB 3 ZERO 12X2400X1220 TG2
  "60638111", // OSB 3 ZERO 15X2400X1220 TG2
  "60638112", // OSB 3 ZERO 18X2400X1220 TG2
  "10910990", // SPONPL GULV 22X620X2420 XTRA
  "54498356", // KRYSSFPL FURU 12X2440X1220 BB/X
  // Tetting
  "60137368", // VINDSPERRE BASIC 1,30X25M
  "50978597", // VINDSPERRE SOFT XTRA 1,30X25M
  "25894114", // SVILLEMEMBRAN 0,200X17M ISOLA
  // Isolasjon
  "56831354", // ISOLASJON EPS 100X600X1200MM
  "50673624", // GLAVA PROFF 34 PLATE 10X5 7X120
  "60127235", // FLEXI A-PLATE 34 148X575X1200
  "60127237", // FLEXI A-PLATE 34 198X575X1200
  // Terrasse og kledning
  "25410978", // FURU 28X120 CUIMP TERRASSE KL1
  "23304215", // FURU 28X120 TERR ROYAL BRUN
  "57741195", // FURU 28X145 TER CONCISE BRUN ROYAL
  "47258536", // FURU 28X145 TER UNO GRÅ ROYAL
  "21728803", // G-F 18X120 UNDERPANEL
  "25386400", // FURU 19X098 REKTKLED IMP KL1
  // Festemidler
  "60743886", // KONSTRUKSJONSKRUE WAF 6X40
  "60679794", // TERRASSESKRUE 5X70 A2 A100 T25
    // Konstruksjonsvirke — det folk kjøper mest av, i mengde
  "11303666", // GRAN 48X148 K-VIRKE C24
  "11303641", // GRAN 48X098 K-VIRKE C24
  "11303682", // GRAN 48X198 K-VIRKE C24
  "11303617", // GRAN 36X148 K-VIRKE C24
  "11303633", // GRAN 36X198 K-VIRKE C24
  "11303591", // GRAN 36X098 K-VIRKE C24
  "42807217", // FURU 98X098 CUIMP K-VIRKE C24 (terrassestolpe)
  "25414301", // FURU 73X073 CUIMP LEKT/REKKE KL1
  "25411299", // FURU 36X048 CUIMP LEKT KL1
  "11302643", // G-F 36X048 LEKT/REKKE KL1
];

/**
 * Dekningsgraden en vare må ha for å få stå i stripa. Grensa er den samme som
 * `marginTone` kaller «thin»: under 5 % spiser frakt og betalingsgebyr hele
 * dekningsbidraget, og da er det ingenting å tjene på å vise varen først.
 * Nullmargin-varer ligger fortsatt i katalogen og i søket — de skal bare ikke
 * være det første kunden ser.
 */
export const MIN_FEATURED_MARGIN_PCT = 8;

/** Dekningsgraden vi normalt priser mot. Margin over dette gir ikke mer løft. */
const TARGET_MARGIN_PCT = 20;

/**
 * Hvor mye margin får lov til å flytte på rekkefølgen. Populariteten veier
 * tyngst med vilje: stripa heter «mest populære», og skal ikke bli en liste
 * over varene vi tjener mest på.
 */
const MARGIN_WEIGHT = 0.3;

const MIN_FEATURED_PRODUCTS = 4;

/**
 * Maks antall varer fra samme kategori i stripa. Konstruksjonsvirke er både det
 * mest kjøpte og det med flest varianter, så uten et tak fylles hele stripa av
 * bjelker i synkende dimensjon. Taket gjelder bare rekkefølgen på forsiden —
 * det er en visningsregel, ikke en påstand om hva som selger.
 */
const MAX_PER_CATEGORY = 3;

export type PopularProductMargin = {
  /** Dekningsgrad i prosent. null = innkjøpsprisen er ukjent. */
  marginPct: number | null;
};

/**
 * Sorterer kandidatene etter en blanding av popularitet (posisjonen i
 * `POPULAR_STOREFRONT_NOBB`) og dekningsgrad, og luker ut varene som ikke tåler
 * å bli solgt: ukjent innkjøpspris eller margin under `MIN_FEATURED_MARGIN_PCT`.
 *
 * Ren funksjon — all databaselesing skjer i `getMostPopularStorefrontProducts`.
 */
export function rankPopularStorefrontProducts(
  products: StorefrontProduct[],
  marginByNobb: Map<string, PopularProductMargin>,
  limit: number,
): StorefrontProduct[] {
  const popularityRank = new Map(POPULAR_STOREFRONT_NOBB.map((nobb, index) => [nobb, index]));
  const poolSize = Math.max(POPULAR_STOREFRONT_NOBB.length, 1);

  const scored = products
    .map((product) => {
      const marginPct = marginByNobb.get(product.nobbNumber)?.marginPct ?? null;
      const rank = popularityRank.get(product.nobbNumber) ?? poolSize;
      // 1 for den mest populære varen, fallende mot 0 nedover lista.
      const popularityWeight = Math.max(0, 1 - rank / poolSize);
      const marginWeight = marginPct === null ? 0 : clamp01(marginPct / TARGET_MARGIN_PCT);

      return {
        product,
        marginPct,
        score: (1 - MARGIN_WEIGHT) * popularityWeight + MARGIN_WEIGHT * marginWeight,
      };
    })
    .filter((entry) => entry.marginPct !== null && entry.marginPct >= MIN_FEATURED_MARGIN_PCT)
    .sort((left, right) => right.score - left.score);

  const perCategory = new Map<string, number>();
  const picked: StorefrontProduct[] = [];
  const overflow: StorefrontProduct[] = [];

  for (const entry of scored) {
    const category = entry.product.category;
    const taken = perCategory.get(category) ?? 0;
    if (taken >= MAX_PER_CATEGORY) {
      overflow.push(entry.product);
      continue;
    }
    perCategory.set(category, taken + 1);
    picked.push(entry.product);
    if (picked.length === limit) {
      return picked;
    }
  }

  // For få kategorier til å fylle stripa — da er en fjerde bjelke bedre enn en
  // tom plass.
  return [...picked, ...overflow].slice(0, limit);
}

/**
 * Forsidens «Mest populære byggevarer».
 *
 * Kuratert utvalg, men marginen leses live fra katalogen: prisfilen endrer
 * innkjøpsprisene ved hver import, og en vare som gikk fra 20 % til 0 % skal
 * falle ut av stripa av seg selv i stedet for å bli stående til noen oppdager
 * det.
 */
export async function getMostPopularStorefrontProducts(limit = 16): Promise<StorefrontProduct[]> {
  "use cache";
  cacheLife("hours");

  const products = await getStorefrontProductsByNobb(POPULAR_STOREFRONT_NOBB);
  if (products.length === 0) {
    return [];
  }

  const marginByNobb = await loadPopularProductMargins(POPULAR_STOREFRONT_NOBB);
  if (!marginByNobb) {
    // Uten service-role-nøkkel får vi ikke lest innkjøpsprisen, og da er det
    // bedre å vise den kuraterte rekkefølgen enn ingenting.
    return products.slice(0, limit);
  }

  const ranked = rankPopularStorefrontProducts(products, marginByNobb, limit);
  if (ranked.length >= MIN_FEATURED_PRODUCTS) {
    return ranked;
  }

  // Nesten hele kandidatlista mangler margin — det er et datavarsel, ikke et
  // signal om å tømme forsiden.
  console.warn(
    `[storefront] bare ${ranked.length} av ${products.length} populære varer har margin over ${MIN_FEATURED_MARGIN_PCT} %`,
  );
  return products.slice(0, limit);
}

/**
 * Innkjøpspris og margin per NOBB-nummer.
 *
 * Leses med service-role-klienten fordi `cost_price_ex_vat_nok` ikke er blant
 * kolonnene anon har tilgang til — innkjøpsprisen skal ikke ut i nettleseren.
 * Kallet skjer bare i denne cachede serverfunksjonen, og bare tallene som
 * trengs for rangeringen forlater den.
 *
 * `null` betyr «vet ikke» (ingen service-role-nøkkel eller feilet spørring), og
 * er noe annet enn et tomt kart, som betyr «ingen av varene har innkjøpspris».
 */
async function loadPopularProductMargins(
  nobbNumbers: string[],
): Promise<Map<string, PopularProductMargin> | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return null;
  }

  const { data, error } = await admin
    .from(STOREFRONT_PRODUCTS_TABLE)
    .select("nobb_number, unit_price_nok, cost_price_ex_vat_nok, list_price_ex_vat_nok")
    .in("nobb_number", nobbNumbers);

  if (error || !data) {
    console.error("[storefront] kunne ikke lese margin for populære varer:", error?.message);
    return null;
  }

  const margins = new Map<string, PopularProductMargin>();
  for (const row of data as PopularMarginRow[]) {
    const { marginPct } = calculateProductMargin({
      unitPriceNok: toNumber(row.unit_price_nok),
      costPriceExVatNok: row.cost_price_ex_vat_nok,
      listPriceExVatNok: row.list_price_ex_vat_nok,
    });
    margins.set(String(row.nobb_number), { marginPct });
  }

  return margins;
}

type PopularMarginRow = {
  nobb_number: string;
  unit_price_nok: number | string | null;
  cost_price_ex_vat_nok: number | string | null;
  list_price_ex_vat_nok: number | string | null;
};

function toNumber(value: number | string | null): number {
  if (value === null) return 0;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
