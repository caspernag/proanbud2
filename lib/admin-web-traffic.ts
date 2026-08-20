import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { missingVercelAnalyticsEnv } from "@/lib/env";
import { STOREFRONT_PRODUCTS_TABLE } from "@/lib/storefront-catalog-db";
import {
  aggregatePathsBySlug,
  buildPopularProducts,
  fillTrafficDays,
  TRAFFIC_CHART_DAYS,
  TRAFFIC_WINDOWS,
  type AdminWebTraffic,
} from "@/lib/web-traffic";
import {
  analyticsWindow,
  fetchVercelTopPaths,
  fetchVercelTrafficByDay,
  fetchVercelVisitTotals,
} from "@/lib/vercel-analytics";

/**
 * Web-trafikk for /sjefen-dashboardet.
 *
 * Vercel kjenner bare URL-er. Butikkens produktsider ligger på rot
 * (`/<slug>`), akkurat som `/checkout` og `/min-side`, så «mest populære
 * produkter» finnes ikke som en ferdig dimensjon i Vercel — den må bygges her:
 * hent topplista over URL-er, plukk ut de som har nøyaktig ett segment, og
 * kryss dem mot faktiske slugger i katalogen. Det som ikke er et produkt faller
 * ut av seg selv, uten en hardkodet liste over unntak som må vedlikeholdes.
 *
 * Typene og den rene logikken ligger i `lib/web-traffic`, som fanene i
 * dashboardet kan importere uten å dra service-role-oppsettet med seg.
 */

/** Hvor mange URL-er som hentes fra topplista før de krysses mot katalogen. */
const TOP_PATH_SAMPLE = 100;

type ProductRow = { id: string; slug: string; product_name: string };

/**
 * Slår opp produktnavn for kandidatsluggene.
 *
 * Leses med adminklienten (service role) som resten av /sjefen — ikke
 * anon-klienten i storefront-katalogen, som er bundet til en eksplisitt
 * kolonneliste og kan miste tilgang uten at det synes her.
 */
async function fetchProductsBySlug(
  db: SupabaseClient,
  slugs: string[],
): Promise<{ products: Map<string, { id: string; productName: string }>; error: string | null }> {
  const products = new Map<string, { id: string; productName: string }>();
  if (slugs.length === 0) {
    return { products, error: null };
  }

  const { data, error } = await db
    .from(STOREFRONT_PRODUCTS_TABLE)
    .select("id, slug, product_name")
    .in("slug", slugs);

  if (error) {
    console.error("[sjefen] oppslag av populære produkter feilet:", error.message);
    return { products, error: `Populære produkter: ${error.message}` };
  }

  for (const row of (data ?? []) as ProductRow[]) {
    products.set(row.slug, { id: row.id, productName: row.product_name });
  }

  return { products, error: null };
}

/**
 * Henter alt trafikkortene trenger i én runde.
 *
 * Alle Vercel-kallene går parallelt og er cachet i `lib/vercel-analytics`, så
 * dashboardet betaler ett API-kall per vindu per 5. minutt — ikke ett per
 * sidevisning.
 */
export async function fetchAdminWebTraffic(db: SupabaseClient): Promise<AdminWebTraffic> {
  const missingEnv = missingVercelAnalyticsEnv();
  const configured = missingEnv.length === 0;

  const chartWindow = analyticsWindow(TRAFFIC_CHART_DAYS);
  const windows = TRAFFIC_WINDOWS.map((days) => ({ days, ...analyticsWindow(days) }));

  const [dailyResult, totalResults, pathResults] = await Promise.all([
    fetchVercelTrafficByDay(chartWindow.since, chartWindow.until),
    Promise.all(windows.map((w) => fetchVercelVisitTotals(w.since, w.until))),
    Promise.all(windows.map((w) => fetchVercelTopPaths(w.since, w.until, TOP_PATH_SAMPLE))),
  ]);

  // Ett oppslag mot katalogen for alle vinduene under ett. Vinduene overlapper
  // kraftig, så tre separate spørringer ville lest de samme radene tre ganger.
  const candidateSlugs = [
    ...new Set(pathResults.flatMap((result) => [...aggregatePathsBySlug(result.data).keys()])),
  ];
  const { products, error: productError } = await fetchProductsBySlug(db, candidateSlugs);

  const errors = [
    dailyResult.error,
    ...totalResults.map((result) => result.error),
    ...pathResults.map((result) => result.error),
    productError,
  ].filter((error): error is string => error !== null);

  return {
    configured,
    missingEnv,
    // Samme feil kommer tilbake fra alle sju kallene når API-et er nede eller
    // ukonfigurert. Kortet skal si det én gang, ikke sju.
    errors: configured ? [...new Set(errors)] : [],
    // Fylles ut her, mot samme sluttdato som spørringen brukte, slik at
    // kortet slipper å lese klokka på nytt under render.
    daily: fillTrafficDays(dailyResult.data, new Date(chartWindow.until)),
    summaries: windows.map((w, index) => ({ days: w.days, totals: totalResults[index].data })),
    popular: windows.map((w, index) => ({
      days: w.days,
      products: buildPopularProducts(pathResults[index].data, products),
    })),
  };
}
