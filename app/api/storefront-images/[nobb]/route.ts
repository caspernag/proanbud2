import { promises as fs } from "node:fs";
import path from "node:path";

import { env, hasNobbExportEnv } from "@/lib/env";
import { STORE_IMAGE_FALLBACK_URL } from "@/lib/storefront-image";

// ---------------------------------------------------------------------------
// Cache configuration
// ---------------------------------------------------------------------------

/** Directory where downloaded images are persisted keyed by NOBB number. */
const CACHE_DIR = path.join(process.cwd(), ".private", "nobb-images");

/** Number of seconds browsers / CDNs should cache a real image response. */
const HIT_CACHE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Number of seconds to cache the placeholder response (short, so retries happen). */
const MISS_CACHE_SECONDS = 60 * 5; // 5 min

/** After this many days we will retry fetching a product that previously had no image. */
const NULL_RETRY_DAYS = 1;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

type RouteContext = {
  params: Promise<{
    nobb: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { nobb } = await context.params;
  // Sanitise: only digits (NOBB numbers are numeric)
  const nobbNumber = nobb.trim().replace(/[^\d]/g, "");

  if (!nobbNumber) {
    return Response.redirect(STORE_IMAGE_FALLBACK_URL, 307);
  }

  // 1. Serve from local disk cache if available --------------------------------
  const cached = await readCachedImage(nobbNumber);
  if (cached) {
    return new Response(cached.buffer, {
      status: 200,
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": `public, max-age=${HIT_CACHE_SECONDS}, s-maxage=${HIT_CACHE_SECONDS}, immutable`,
        "X-Image-Source": "disk-cache",
      },
    });
  }

  // 2. Skip re-fetch if we tried recently and found nothing --------------------
  if (await isRecentlyNull(nobbNumber)) {
    return buildPlaceholderResponse();
  }

  // 3. Upstream resolution — deduplicated per NOBB to prevent thundering herd -
  const resolved = await resolveUpstreamImage(nobbNumber);

  if (resolved.kind === "image") {
    return new Response(resolved.buffer, {
      status: 200,
      headers: {
        "Content-Type": resolved.contentType,
        "Cache-Control": `public, max-age=${HIT_CACHE_SECONDS}, s-maxage=${HIT_CACHE_SECONDS}${resolved.source === "nobb-export" ? ", immutable" : ""}`,
        "X-Image-Source": resolved.source,
      },
    });
  }

  return buildPlaceholderResponse();
}

// ---------------------------------------------------------------------------
// Upstream resolver (with in-flight deduplication)
// ---------------------------------------------------------------------------

type UpstreamResolution =
  | {
      kind: "image";
      buffer: ArrayBuffer;
      contentType: string;
      source: "nobb-export" | "optimera-scrape" | "byggmakker-scrape";
    }
  | { kind: "none" };

/**
 * Per-process in-flight map. When 100 concurrent requests ask for the same
 * uncached NOBB, we only fire ONE upstream chain and share its result with
 * all waiters. This prevents hammering upstream services (and getting rate
 * limited) during cold-cache bursts.
 */
const inFlightUpstream = new Map<string, Promise<UpstreamResolution>>();

async function resolveUpstreamImage(nobb: string): Promise<UpstreamResolution> {
  const existing = inFlightUpstream.get(nobb);
  if (existing) return existing;

  const promise = (async (): Promise<UpstreamResolution> => {
    // Try NOBB Export (priority 1) — requires Basic auth
    const exportImage = await fetchNobbExportImage(nobb);
    if (exportImage) {
      await persistImage(nobb, exportImage.buffer, exportImage.contentType);
      return { kind: "image", source: "nobb-export", ...exportImage };
    }

    // Fallback 1: Optimera SSR search scrape (no creds needed)
    const optimeraImage = await fetchOptimeraImage(nobb);
    if (optimeraImage) {
      await persistImage(nobb, optimeraImage.buffer, optimeraImage.contentType);
      return { kind: "image", source: "optimera-scrape", ...optimeraImage };
    }

    // Fallback 2: Byggmakker CDN/scrape
    const bmImage = await fetchByggmakkerImage(nobb);
    if (bmImage) {
      await persistImage(nobb, bmImage.buffer, bmImage.contentType);
      return { kind: "image", source: "byggmakker-scrape", ...bmImage };
    }

    // Nothing worked — mark as null so we skip retry for NULL_RETRY_DAYS
    await writeNullMarker(nobb);
    return { kind: "none" };
  })();

  inFlightUpstream.set(nobb, promise);
  try {
    return await promise;
  } finally {
    inFlightUpstream.delete(nobb);
  }
}

// ---------------------------------------------------------------------------
// Disk cache helpers
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS: Array<{ ext: string; contentType: string }> = [
  { ext: ".jpg", contentType: "image/jpeg" },
  { ext: ".png", contentType: "image/png" },
  { ext: ".webp", contentType: "image/webp" },
  { ext: ".gif", contentType: "image/gif" },
];

async function readCachedImage(nobb: string): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  for (const { ext, contentType } of IMAGE_EXTENSIONS) {
    const filePath = path.join(CACHE_DIR, `${nobb}${ext}`);
    try {
      const nodeBuffer = await fs.readFile(filePath);
      // Slice out a clean ArrayBuffer (avoids SharedArrayBuffer ambiguity with BodyInit)
      const buffer = nodeBuffer.buffer.slice(
        nodeBuffer.byteOffset,
        nodeBuffer.byteOffset + nodeBuffer.byteLength,
      ) as ArrayBuffer;
      return { buffer, contentType };
    } catch {
      // file not found, try next extension
    }
  }
  return null;
}

async function persistImage(nobb: string, data: ArrayBuffer, contentType: string): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const ext = contentTypeToExt(contentType);
    const filePath = path.join(CACHE_DIR, `${nobb}${ext}`);
    await fs.writeFile(filePath, Buffer.from(data));
    // Remove any stale null marker for this nobb
    await fs.unlink(path.join(CACHE_DIR, `${nobb}.null`)).catch(() => undefined);
  } catch {
    // Non-fatal: if we can't write the cache the image still loads this request
  }
}

async function isRecentlyNull(nobb: string): Promise<boolean> {
  const markerPath = path.join(CACHE_DIR, `${nobb}.null`);
  try {
    const stat = await fs.stat(markerPath);
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs < NULL_RETRY_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

async function writeNullMarker(nobb: string): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, `${nobb}.null`), "");
  } catch {
    // Non-fatal
  }
}

function contentTypeToExt(ct: string): string {
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  return ".jpg";
}

// ---------------------------------------------------------------------------
// Upstream image fetchers
// ---------------------------------------------------------------------------

type ImageData = { buffer: ArrayBuffer; contentType: string };

/**
 * Fetch a product image from the NOBB export CDN (Byggtjeneste).
 *
 * In practice this endpoint serves public images WITHOUT authentication —
 * credentials are only needed for v2 metadata endpoints, not for /media/images.
 * We still send the Authorization header when credentials are configured
 * (harmless — the CDN accepts both authed and unauthed requests).
 *
 * Tries v1 SQUARE first (preferred quality), then v2 Mb as fallback.
 */
async function fetchNobbExportImage(nobb: string): Promise<ImageData | null> {
  const authHeader = hasNobbExportEnv()
    ? `Basic ${Buffer.from(`${env.nobbExportUsername}:${env.nobbExportPassword}`).toString("base64")}`
    : null;

  const candidates = [
    `https://export.byggtjeneste.no/api/v1/media/images/items/${encodeURIComponent(nobb)}/SQUARE`,
    `https://export.byggtjeneste.no/api/v2/media/images/items/${encodeURIComponent(nobb)}/Mb?imagesize=SQUARE`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: authHeader ? { Authorization: authHeader } : undefined,
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (!res.ok) continue;
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) continue;
      return { buffer: await res.arrayBuffer(), contentType };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Fetch a product image from Optimera.no.
 *
 * Optimera's search page is server-rendered (Next.js) and embeds product data
 * including `"nobbNumber": "<n>"` and the `media.optimera.no` image URL directly
 * in the HTML response. We only accept the image when we can verify that the
 * exact NOBB number appears in the HTML, so we never return a similar-but-wrong
 * product's picture.
 *
 * No credentials required. Works for most NOBB numbers present in Optimera's
 * catalog (trelast, plater, isolasjon, festemidler, etc.).
 */
async function fetchOptimeraImage(nobb: string): Promise<ImageData | null> {
  try {
    const html = await fetchHtml(
      `https://www.optimera.no/sok?q=${encodeURIComponent(nobb)}`,
    );
    if (!html) return null;

    // Require exact NOBB match somewhere in the server-rendered payload.
    // Pattern: "nobbNumber": "25410978"
    const nobbMatcher = new RegExp(`"nobbNumber"\\s*:\\s*"${nobb}"`);
    if (!nobbMatcher.test(html)) return null;

    // Grab the first media.optimera.no image URL (unqualified — we prefer the
    // original over the transformed webp variants so we can persist full quality).
    const imageMatch = html.match(
      /https:\/\/media\.optimera\.no\/[^"'\s?]+\.(?:jpg|jpeg|png|webp)/i,
    );
    if (!imageMatch?.[0]) return null;

    return await tryFetchImageUrl(imageMatch[0]);
  } catch {
    return null;
  }
}


/**
 * Attempt to scrape a product image from Byggmakker.no.
 *
 * Strategy:
 *  1. Try common Byggmakker CDN URL patterns directly (fast).
 *  2. If that fails, hit their product search page and parse the first product
 *     link, then fetch the product page to extract the primary image from
 *     JSON-LD or open-graph meta tags.
 */
async function fetchByggmakkerImage(nobb: string): Promise<ImageData | null> {
  // --- 1. Direct CDN guesses (no HTML round-trip needed) --------------------
  const cdnCandidates = [
    `https://bilder.byggmakker.no/img/${nobb}-1-800x800.jpg`,
    `https://www.byggmakker.no/globalassets/produktbilder/${nobb}/${nobb}-1.jpg`,
    `https://cdn.byggmakker.no/ProductImages/${nobb}/Main.jpg`,
  ];

  for (const url of cdnCandidates) {
    const result = await tryFetchImageUrl(url);
    if (result) return result;
  }

  // --- 2. Scrape product search page ----------------------------------------
  try {
    const searchHtml = await fetchHtml(
      `https://www.byggmakker.no/sok?q=${encodeURIComponent(nobb)}`,
    );
    if (!searchHtml) return null;

    // Find the first /produkt/ link in the search results
    const productPathMatch = searchHtml.match(/href="(\/produkt\/[^"?#]+)"/i);
    if (!productPathMatch?.[1]) return null;

    const productUrl = `https://www.byggmakker.no${productPathMatch[1]}`;
    const productHtml = await fetchHtml(productUrl);
    if (!productHtml) return null;

    const imageUrl = extractPrimaryImageFromHtml(productHtml);
    if (!imageUrl) return null;

    return await tryFetchImageUrl(imageUrl);
  } catch {
    return null;
  }
}

/** Download a URL and return its bytes only if it looks like an image. */
async function tryFetchImageUrl(url: string): Promise<ImageData | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    return { buffer: await res.arrayBuffer(), contentType };
  } catch {
    return null;
  }
}

/** Fetch a URL as text/html with a browser-like User-Agent. */
async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

/**
 * Extract the primary product image URL from an HTML page.
 * Checks JSON-LD Product schema first, then og:image.
 */
function extractPrimaryImageFromHtml(html: string): string | null {
  // Try JSON-LD blocks
  const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]) as Record<string, unknown>;
      const imageField = data.image;
      if (typeof imageField === "string" && imageField.startsWith("http")) {
        return imageField;
      }
      if (Array.isArray(imageField) && typeof imageField[0] === "string") {
        return imageField[0] as string;
      }
    } catch {
      // malformed JSON-LD, skip
    }
  }

  // Try og:image
  const ogMatches = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  ];
  for (const re of ogMatches) {
    const m = html.match(re);
    if (m?.[1]?.startsWith("http")) {
      const url = m[1];
      // Skip generic site assets
      if (!url.includes("logo") && !url.includes("favicon") && !url.includes("banner")) {
        return url;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Placeholder response
// ---------------------------------------------------------------------------

async function buildPlaceholderResponse(): Promise<Response> {
  try {
    const res = await fetch(STORE_IMAGE_FALLBACK_URL, {
      cache: "force-cache",
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const contentType = res.headers.get("content-type") ?? "image/svg+xml";
      return new Response(await res.arrayBuffer(), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": `public, max-age=${MISS_CACHE_SECONDS}, s-maxage=${MISS_CACHE_SECONDS}`,
        },
      });
    }
  } catch {
    // fall through
  }
  return Response.redirect(STORE_IMAGE_FALLBACK_URL, 307);
}

