import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { env, hasNobbExportEnv, hasStorefrontImageWarmupSecret } from "@/lib/env";
import { STORE_IMAGE_FALLBACK_URL } from "@/lib/storefront-image";

// ---------------------------------------------------------------------------
// Cache configuration
// ---------------------------------------------------------------------------

const BUCKET = "material-images";

/** Browser cache for image bytes (CDN cache is configured separately). */
const HIT_BROWSER_CACHE_SECONDS = 60 * 60 * 24; // 1 day
/** CDN cache for image bytes. */
const HIT_CDN_CACHE_SECONDS = 60 * 60 * 24 * 30; // 30 days
/** Stale revalidation window for image bytes at CDN. */
const HIT_STALE_WHILE_REVALIDATE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/** Browser cache for fallback redirects. */
const MISS_BROWSER_CACHE_SECONDS = 60; // 1 min
/** CDN cache for fallback redirects. */
const MISS_CDN_CACHE_SECONDS = 60 * 5; // 5 min
/** Stale revalidation window for fallback redirects at CDN. */
const MISS_STALE_WHILE_REVALIDATE_SECONDS = 60 * 60; // 1 hour

/** After this many days we will retry fetching a product that previously had no image. */
const NULL_RETRY_DAYS = 1;

/** Per-source network timeout. */
const SOURCE_TIMEOUT_MS = 2_000;
/** Global budget for external source resolution. */
const SOURCE_BUDGET_MS = 3_500;
/** Max time to spend persisting the result after we already have a response candidate. */
const PERSIST_BUDGET_MS = 500;

/** Cooldown for best-effort miss-triggered warmups from user traffic. */
const MISS_WARMUP_TRIGGER_COOLDOWN_MS = 10 * 60 * 1_000; // 10 min

/** In-memory pointer cache TTLs (per instance, best-effort). */
const IMAGE_POINTER_TTL_MS = 10 * 60 * 1_000; // 10 min
const NULL_POINTER_TTL_MS = 5 * 60 * 1_000; // 5 min

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

const CONTENT_TYPE_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function extForContentType(contentType: string): string {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  return CONTENT_TYPE_EXT[ct] ?? ".jpg";
}

function contentTypeForFileName(fileName: string): string {
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".webp")) return "image/webp";
  if (fileName.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function buildHitCacheControl() {
  return `public, max-age=${HIT_BROWSER_CACHE_SECONDS}, s-maxage=${HIT_CDN_CACHE_SECONDS}, stale-while-revalidate=${HIT_STALE_WHILE_REVALIDATE_SECONDS}, immutable`;
}

function buildMissCacheControl() {
  return `public, max-age=${MISS_BROWSER_CACHE_SECONDS}, s-maxage=${MISS_CDN_CACHE_SECONDS}, stale-while-revalidate=${MISS_STALE_WHILE_REVALIDATE_SECONDS}`;
}

type SourceName = "supabase" | "nobb-export" | "optimera" | "byggmakker" | "fallback";
type CacheStatus = "hit-storage" | "miss-resolved" | "null-marker" | "miss-fallback" | "miss-deferred";

type ResolveOutput =
  | {
      kind: "image";
      bytes: ArrayBuffer;
      contentType: string;
      source: SourceName;
      cacheStatus: CacheStatus;
    }
  | {
      kind: "redirect";
      location: string;
      source: SourceName;
      cacheStatus: CacheStatus;
    };

type StoragePointerEntry = {
  expiresAt: number;
  objectPath: string | null;
};

const storagePointerCache = new Map<string, StoragePointerEntry>();
const inflightResolutions = new Map<string, Promise<ResolveOutput>>();
const warmupMissTriggerTimes = new Map<string, number>();

// ---------------------------------------------------------------------------
// Supabase storage helpers
// ---------------------------------------------------------------------------

type SupabaseClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

function getStoragePointer(nobb: string): string | null | undefined {
  const cached = storagePointerCache.get(nobb);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    storagePointerCache.delete(nobb);
    return undefined;
  }
  return cached.objectPath;
}

function setStoragePointer(nobb: string, objectPath: string | null, ttlMs: number): void {
  storagePointerCache.set(nobb, {
    expiresAt: Date.now() + ttlMs,
    objectPath,
  });
}

function clearStoragePointer(nobb: string): void {
  storagePointerCache.delete(nobb);
}

async function downloadImageFromSupabase(
  supabase: SupabaseClient,
  objectPath: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(objectPath);
  if (error || !data) return null;

  return {
    bytes: await data.arrayBuffer(),
    contentType: contentTypeForFileName(objectPath),
  };
}

async function findImageInSupabase(
  supabase: SupabaseClient,
  nobb: string,
): Promise<{ bytes: ArrayBuffer; contentType: string; objectPath: string } | null> {
  const pointer = getStoragePointer(nobb);

  if (typeof pointer === "string") {
    const direct = await downloadImageFromSupabase(supabase, pointer);
    if (direct) {
      return {
        ...direct,
        objectPath: pointer,
      };
    }

    // Pointer is stale or object disappeared.
    clearStoragePointer(nobb);
  }

  const { data: files } = await supabase.storage.from(BUCKET).list("", {
    search: nobb + ".",
    limit: 10,
  });
  if (!files) return null;

  const imageFile = files.find(
    (f) => f.name.startsWith(nobb + ".") && /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name),
  );
  if (!imageFile) return null;

  const downloaded = await downloadImageFromSupabase(supabase, imageFile.name);
  if (!downloaded) return null;

  setStoragePointer(nobb, imageFile.name, IMAGE_POINTER_TTL_MS);

  return {
    ...downloaded,
    objectPath: imageFile.name,
  };
}

async function checkNullMarker(supabase: SupabaseClient, nobb: string): Promise<boolean> {
  const pointer = getStoragePointer(nobb);
  if (pointer === null) {
    return true;
  }

  const { data } = await supabase.storage.from(BUCKET).download(`${nobb}.null`);
  if (!data) return false;

  const text = await data.text();
  const ts = parseInt(text.trim(), 10);
  if (isNaN(ts)) {
    // old-style empty marker -> treat as fresh
    setStoragePointer(nobb, null, NULL_POINTER_TTL_MS);
    return true;
  }

  const ageMs = Date.now() - ts;
  const isFresh = ageMs < NULL_RETRY_DAYS * 24 * 60 * 60 * 1000;

  if (isFresh) {
    setStoragePointer(nobb, null, NULL_POINTER_TTL_MS);
  }

  return isFresh;
}

async function saveImageToSupabase(
  supabase: SupabaseClient,
  nobb: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<void> {
  const ext = extForContentType(contentType);
  const objectPath = `${nobb}${ext}`;

  await supabase.storage.from(BUCKET).upload(objectPath, bytes, {
    contentType,
    upsert: true,
  });

  setStoragePointer(nobb, objectPath, IMAGE_POINTER_TTL_MS);
}

async function saveNullMarker(supabase: SupabaseClient, nobb: string): Promise<void> {
  const ts = String(Date.now());
  await supabase.storage
    .from(BUCKET)
    .upload(`${nobb}.null`, new TextEncoder().encode(ts), { contentType: "text/plain", upsert: true });

  setStoragePointer(nobb, null, NULL_POINTER_TTL_MS);
}

// ---------------------------------------------------------------------------
// External image sources
// ---------------------------------------------------------------------------

interface ImageResult {
  bytes: ArrayBuffer;
  contentType: string;
}

function withTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    const value = await Promise.race([promise, timeoutPromise]);
    return value as T | null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function firstSuccessful<T>(tasks: Array<() => Promise<T | null>>): Promise<T | null> {
  const wrapped = tasks.map((task, index) =>
    task().then((value) => {
      if (!value) {
        throw new Error(`no-result-${index}`);
      }
      return value;
    }),
  );

  try {
    return await Promise.any(wrapped);
  } catch {
    return null;
  }
}

async function fetchImageFromUrl(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<ImageResult | null> {
  const control = withTimeoutSignal(timeoutMs);

  try {
    const res = await fetch(url, {
      headers,
      signal: control.signal,
    });

    if (!res.ok) return null;

    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.startsWith("image/")) return null;

    return {
      bytes: await res.arrayBuffer(),
      contentType: ct,
    };
  } catch {
    return null;
  } finally {
    control.clear();
  }
}

async function fetchNobbExport(nobb: string): Promise<ImageResult | null> {
  const authHeader = hasNobbExportEnv()
    ? "Basic " + btoa(`${env.nobbExportUsername}:${env.nobbExportPassword}`)
    : null;

  const endpoints = [
    `https://export.byggtjeneste.no/api/v1/media/images/items/${encodeURIComponent(nobb)}/SQUARE`,
    `https://export.byggtjeneste.no/api/v2/media/images/items/${encodeURIComponent(nobb)}/Mb?imagesize=SQUARE`,
  ];

  return firstSuccessful(
    endpoints.map((url) =>
      () =>
        fetchImageFromUrl(
          url,
          {
            "User-Agent": USER_AGENT,
            ...(authHeader ? { Authorization: authHeader } : {}),
          },
          SOURCE_TIMEOUT_MS,
        ),
    ),
  );
}

async function fetchOptimera(nobb: string): Promise<ImageResult | null> {
  const control = withTimeoutSignal(SOURCE_TIMEOUT_MS);

  try {
    const searchUrl = `https://www.optimera.no/sok?q=${encodeURIComponent(nobb)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
      signal: control.signal,
    });
    if (!res.ok) return null;

    const html = await res.text();
    // Strict NOBB match required to prevent cross-product contamination.
    if (!new RegExp(`"nobbNumber"\\s*:\\s*"${nobb}"`).test(html)) return null;

    const imgMatch = html.match(
      /https:\/\/media\.optimera\.no\/[^"'\s?]+\.(?:jpg|jpeg|png|webp)/i,
    );
    if (!imgMatch) return null;

    return fetchImageFromUrl(imgMatch[0], { "User-Agent": USER_AGENT }, SOURCE_TIMEOUT_MS);
  } catch {
    return null;
  } finally {
    control.clear();
  }
}

async function fetchByggmakker(nobb: string): Promise<ImageResult | null> {
  const candidates = [
    `https://bilder.byggmakker.no/img/${nobb}-1-800x800.jpg`,
    `https://bilder.byggmakker.no/img/${nobb}-800x800.jpg`,
    `https://bilder.byggmakker.no/img/${nobb}.jpg`,
  ];

  return firstSuccessful(
    candidates.map((url) =>
      () =>
        fetchImageFromUrl(
          url,
          { "User-Agent": USER_AGENT },
          SOURCE_TIMEOUT_MS,
        ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

async function resolveFromExternalSources(nobb: string): Promise<{ source: SourceName; image: ImageResult } | null> {
  const wrapped = [
    fetchNobbExport(nobb).then((image) => {
      if (!image) throw new Error("nobb-export-miss");
      return { source: "nobb-export" as const, image };
    }),
    fetchOptimera(nobb).then((image) => {
      if (!image) throw new Error("optimera-miss");
      return { source: "optimera" as const, image };
    }),
    fetchByggmakker(nobb).then((image) => {
      if (!image) throw new Error("byggmakker-miss");
      return { source: "byggmakker" as const, image };
    }),
  ];

  const first = await runWithTimeout(
    Promise.any(wrapped).catch(() => null),
    SOURCE_BUDGET_MS,
  );

  return first;
}

async function resolveImage(
  nobb: string,
  supabase: SupabaseClient | null,
): Promise<ResolveOutput> {
  const cachedOnly = await resolveImageFromCacheOnly(nobb, supabase);
  if (cachedOnly) {
    return cachedOnly;
  }

  const resolved = await resolveFromExternalSources(nobb);

  if (supabase) {
    if (resolved) {
      await runWithTimeout(
        saveImageToSupabase(supabase, nobb, resolved.image.bytes, resolved.image.contentType),
        PERSIST_BUDGET_MS,
      );
    } else {
      await runWithTimeout(saveNullMarker(supabase, nobb), PERSIST_BUDGET_MS);
    }
  }

  if (resolved) {
    return {
      kind: "image",
      bytes: resolved.image.bytes,
      contentType: resolved.image.contentType,
      source: resolved.source,
      cacheStatus: "miss-resolved",
    };
  }

  return {
    kind: "redirect",
    location: STORE_IMAGE_FALLBACK_URL,
    source: "fallback",
    cacheStatus: "miss-fallback",
  };
}

async function resolveImageWithDedup(
  nobb: string,
  supabase: SupabaseClient | null,
): Promise<ResolveOutput> {
  const existing = inflightResolutions.get(nobb);
  if (existing) {
    return existing;
  }

  const pending = resolveImage(nobb, supabase).finally(() => {
    inflightResolutions.delete(nobb);
  });

  inflightResolutions.set(nobb, pending);
  return pending;
}

async function resolveImageFromCacheOnly(
  nobb: string,
  supabase: SupabaseClient | null,
): Promise<ResolveOutput | null> {
  if (!supabase) {
    return null;
  }

  const cached = await findImageInSupabase(supabase, nobb);
  if (cached) {
    return {
      kind: "image",
      bytes: cached.bytes,
      contentType: cached.contentType,
      source: "supabase",
      cacheStatus: "hit-storage",
    };
  }

  const isNull = await checkNullMarker(supabase, nobb);
  if (isNull) {
    return {
      kind: "redirect",
      location: STORE_IMAGE_FALLBACK_URL,
      source: "fallback",
      cacheStatus: "null-marker",
    };
  }

  return null;
}

function isAuthorizedWarmupRequest(req: Request): boolean {
  if (!hasStorefrontImageWarmupSecret()) {
    return false;
  }

  const expected = env.storefrontImageWarmupSecret;
  const headerToken = req.headers.get("x-storefront-image-warmup-secret")?.trim();
  const bearerToken = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();

  return headerToken === expected || bearerToken === expected;
}

function shouldResolveMissInForeground(req: Request): boolean {
  const requestUrl = new URL(req.url);
  return requestUrl.searchParams.get("resolve") === "1" && isAuthorizedWarmupRequest(req);
}

function shouldTriggerBestEffortWarmup(nobb: string): boolean {
  const now = Date.now();
  const previous = warmupMissTriggerTimes.get(nobb) ?? 0;

  if (now - previous < MISS_WARMUP_TRIGGER_COOLDOWN_MS) {
    return false;
  }

  warmupMissTriggerTimes.set(nobb, now);
  return true;
}

function triggerBestEffortWarmup(nobb: string, supabase: SupabaseClient | null): void {
  if (!shouldTriggerBestEffortWarmup(nobb)) {
    return;
  }

  void resolveImageWithDedup(nobb, supabase).catch(() => {
    // Swallow errors in background warmup path; request already completed.
  });
}

function applyResponseDiagnosticsHeaders(headers: Headers, args: {
  source: SourceName;
  cacheStatus: CacheStatus;
  durationMs: number;
}) {
  headers.set("x-storefront-image-source", args.source);
  headers.set("x-storefront-image-cache", args.cacheStatus);
  headers.set("Server-Timing", `total;dur=${args.durationMs.toFixed(1)}`);
}

type RouteContext = {
  params: Promise<{
    nobb: string;
  }>;
};

export async function GET(req: Request, { params }: RouteContext) {
  const startedAt = performance.now();
  const { nobb } = await params;

  if (!/^\d+$/.test(nobb)) {
    return new Response("Bad Request", { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const cachedOnly = await resolveImageFromCacheOnly(nobb, supabase);
  const output =
    cachedOnly ??
    (shouldResolveMissInForeground(req)
      ? await resolveImageWithDedup(nobb, supabase)
      : {
          kind: "redirect",
          location: STORE_IMAGE_FALLBACK_URL,
          source: "fallback",
          cacheStatus: "miss-deferred",
        } as ResolveOutput);

  if (!cachedOnly && output.kind === "redirect" && output.cacheStatus === "miss-deferred") {
    triggerBestEffortWarmup(nobb, supabase);
  }

  const durationMs = performance.now() - startedAt;

  if (output.kind === "image") {
    const headers = new Headers({
      "Content-Type": output.contentType,
      "Cache-Control": buildHitCacheControl(),
    });
    applyResponseDiagnosticsHeaders(headers, {
      source: output.source,
      cacheStatus: output.cacheStatus,
      durationMs,
    });

    return new Response(output.bytes, { headers });
  }

  const headers = new Headers({
    Location: output.location,
    "Cache-Control": buildMissCacheControl(),
  });
  applyResponseDiagnosticsHeaders(headers, {
    source: output.source,
    cacheStatus: output.cacheStatus,
    durationMs,
  });

  return new Response(null, {
    status: 302,
    headers,
  });
}
