/**
 * Delt, klientsikker modell for web-trafikk.
 *
 * Ligger adskilt fra `lib/admin-web-traffic` fordi fanene i dashboardet er en
 * klientkomponent: dro den inn hentemodulen, fulgte `server-only` og
 * service-role-oppsettet med inn i nettleserbunten og bygget stoppet.
 * Her er det bare typer og ren logikk — ingen nøkler, ingen nettverk.
 */

export type VercelTrafficDay = {
  /** ISO-dato (YYYY-MM-DD) for døgnet. */
  date: string;
  pageviews: number;
  visitors: number;
};

export type VercelPathVisits = {
  requestPath: string;
  pageviews: number;
  visitors: number;
};

export type VercelVisitTotals = {
  pageviews: number;
  visitors: number;
};

/** Vinduene kortene tilbyr, i dager. */
export const TRAFFIC_WINDOWS = [1, 7, 30] as const;
export type TrafficWindowDays = (typeof TRAFFIC_WINDOWS)[number];

/** Antall døgn trafikkgrafen dekker. */
export const TRAFFIC_CHART_DAYS = 30;

/** Hvor mange produkter hvert vindu viser. */
const POPULAR_PRODUCT_LIMIT = 5;

export type PopularProduct = {
  slug: string;
  /** `null` når URL-en ligner et produkt, men ikke finnes i katalogen lenger. */
  productId: string | null;
  productName: string;
  pageviews: number;
  visitors: number;
};

export type PopularProductsWindow = {
  days: TrafficWindowDays;
  products: PopularProduct[];
};

export type TrafficSummary = {
  days: TrafficWindowDays;
  /** `null` betyr «vet ikke» — spørringen feilet — ikke «null besøkende». */
  totals: VercelVisitTotals | null;
};

export type AdminWebTraffic = {
  /** Falsk når token/prosjekt-ID mangler; da er tomme tall forventet. */
  configured: boolean;
  /** Navnene på miljøvariablene som mangler, når `configured` er falsk. */
  missingEnv: string[];
  errors: string[];
  /** Ferdig utfylt serie for grafen — ett innslag per døgn i vinduet. */
  daily: VercelTrafficDay[];
  summaries: TrafficSummary[];
  popular: PopularProductsWindow[];
};

/* ── Rene hjelpere ──────────────────────────────────────────────────────── */

/**
 * Slug-en en URL peker på, eller `null` hvis URL-en umulig kan være en
 * produktside. Query og fragment kuttes, fordi `/gipsplate?utm_source=x` og
 * `/gipsplate/` er visninger av samme side og skal telles sammen.
 */
export function slugFromRequestPath(requestPath: string): string | null {
  const pathname = requestPath.split("#")[0].split("?")[0];
  if (!pathname.startsWith("/")) return null;

  const trimmed = pathname.replace(/\/+$/, "");
  const segment = trimmed.slice(1);
  if (segment.length === 0 || segment.includes("/")) return null;

  try {
    return decodeURIComponent(segment);
  } catch {
    // Ugyldig prosentkoding — bruk segmentet som det står i stedet for å kaste.
    return segment;
  }
}

/** Menneskelig navn på et vindu. Ett døgn heter «24 timer», ikke «1 dag». */
export function trafficWindowLabel(days: TrafficWindowDays): string {
  return days === 1 ? "24 timer" : `${days} dager`;
}

/**
 * Fyller ut døgn uten trafikk, fram til og med `until`.
 *
 * Vercel returnerer bare døgn som har visninger. Uten utfylling ville grafen
 * skjøvet stolpene sammen og fått en stille uke til å se ut som jevn trafikk.
 *
 * Sluttdatoen sendes inn i stedet for å leses av klokka her, av to grunner:
 * grafen skal dekke nøyaktig det vinduet tallene ble hentet for, og et
 * `new Date()` under render er ikke lov i en servekomponent uten at noe
 * request-nært er lest først.
 */
export function fillTrafficDays(
  daily: VercelTrafficDay[],
  until: Date,
  days = TRAFFIC_CHART_DAYS,
): VercelTrafficDay[] {
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const filled: VercelTrafficDay[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate() - offset))
      .toISOString()
      .slice(0, 10);
    filled.push(byDate.get(date) ?? { date, pageviews: 0, visitors: 0 });
  }

  return filled;
}

/** Summerer visninger per slug på tvers av URL-varianter av samme side. */
export function aggregatePathsBySlug(paths: VercelPathVisits[]): Map<string, VercelVisitTotals> {
  const bySlug = new Map<string, VercelVisitTotals>();

  for (const entry of paths) {
    const slug = slugFromRequestPath(entry.requestPath);
    if (!slug) continue;

    const current = bySlug.get(slug);
    if (current) {
      current.pageviews += entry.pageviews;
      // Unike besøkende kan ikke summeres eksakt på tvers av URL-varianter.
      // Den største varianten er et nærmere anslag enn summen, som ville
      // telt samme person to ganger for `/x` og `/x?utm=y`.
      current.visitors = Math.max(current.visitors, entry.visitors);
    } else {
      bySlug.set(slug, { pageviews: entry.pageviews, visitors: entry.visitors });
    }
  }

  return bySlug;
}

/**
 * Rangerer de sluggene som faktisk finnes i katalogen.
 *
 * Sorterer på besøkende, ikke sidevisninger: én person som laster samme
 * produktside ti ganger er ikke ti ganger så sterkt signal som ti personer som
 * så den én gang. Visninger bryter likt, slik at rekkefølgen er stabil.
 */
export function buildPopularProducts(
  paths: VercelPathVisits[],
  productsBySlug: Map<string, { id: string; productName: string }>,
  limit = POPULAR_PRODUCT_LIMIT,
): PopularProduct[] {
  const bySlug = aggregatePathsBySlug(paths);

  return [...bySlug.entries()]
    .filter(([slug]) => productsBySlug.has(slug))
    .map(([slug, totals]) => {
      const product = productsBySlug.get(slug)!;
      return {
        slug,
        productId: product.id,
        productName: product.productName,
        pageviews: totals.pageviews,
        visitors: totals.visitors,
      };
    })
    .sort(
      (left, right) =>
        right.visitors - left.visitors ||
        right.pageviews - left.pageviews ||
        left.slug.localeCompare(right.slug),
    )
    .slice(0, limit);
}
