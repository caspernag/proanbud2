import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { env, hasNobbExportEnv } from "@/lib/env";
import { STORE_IMAGE_FALLBACK_URL } from "@/lib/storefront-image";

// ---------------------------------------------------------------------------
// Cache configuration
// ---------------------------------------------------------------------------

const BUCKET = "material-images";

/** Number of seconds browsers / CDNs should cache a real image response. */
const HIT_CACHE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Number of seconds to cache the placeholder response (short, so retries happen). */
const MISS_CACHE_SECONDS = 60 * 5; // 5 min

/** After this many days we will retry fetching a product that previously had no image. */
const NULL_RETRY_DAYS = 1;

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

// ---------------------------------------------------------------------------
// Supabase storage helpers
// ---------------------------------------------------------------------------

type SupabaseClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

async function findImageInSupabase(
  supabase: SupabaseClient,
  nobb: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const { data: files } = await supabase.storage.from(BUCKET).list("", {
    search: nobb + ".",
    limit: 10,
  });
  if (!files) return null;

  const imageFile = files.find(
    (f) => f.name.startsWith(nobb + ".") && /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name),
  );
  if (!imageFile) return null;

  const { data, error } = await supabase.storage.from(BUCKET).download(imageFile.name);
  if (error || !data) return null;

  const ct = imageFile.name.endsWith(".png")
    ? "image/png"
    : imageFile.name.endsWith(".webp")
      ? "image/webp"
      : imageFile.name.endsWith(".gif")
        ? "image/gif"
        : "image/jpeg";

  return { bytes: await data.arrayBuffer(), contentType: ct };
}

async function checkNullMarker(supabase: SupabaseClient, nobb: string): Promise<boolean> {
  const { data } = await supabase.storage.from(BUCKET).download(`${nobb}.null`);
  if (!data) return false;

  const text = await data.text();
  const ts = parseInt(text.trim(), 10);
  if (isNaN(ts)) return true; // old-style empty marker → treat as fresh

  const ageMs = Date.now() - ts;
  return ageMs < NULL_RETRY_DAYS * 24 * 60 * 60 * 1000;
}

async function saveImageToSupabase(
  supabase: SupabaseClient,
  nobb: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<void> {
  const ext = extForContentType(contentType);
  await supabase.storage.from(BUCKET).upload(`${nobb}${ext}`, bytes, {
    contentType,
    upsert: true,
  });
}

async function saveNullMarker(supabase: SupabaseClient, nobb: string): Promise<void> {
  const ts = String(Date.now());
  await supabase.storage
    .from(BUCKET)
    .upload(`${nobb}.null`, new TextEncoder().encode(ts), { contentType: "text/plain", upsert: true });
}

// ---------------------------------------------------------------------------
// External image sources
// ---------------------------------------------------------------------------

interface ImageResult {
  bytes: ArrayBuffer;
  contentType: string;
}

async function fetchNobbExport(nobb: string): Promise<ImageResult | null> {
  const authHeader = hasNobbExportEnv()
    ? "Basic " + btoa(`${env.nobbExportUsername}:${env.nobbExportPassword}`)
    : null;

  const endpoints = [
    `https://export.byggtjeneste.no/api/v1/media/images/items/${encodeURIComponent(nobb)}/SQUARE`,
    `https://export.byggtjeneste.no/api/v2/media/images/items/${encodeURIComponent(nobb)}/Mb?imagesize=SQUARE`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
      });
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.toLowerCase().startsWith("image/")) continue;
      return { bytes: await res.arrayBuffer(), contentType: ct };
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchOptimera(nobb: string): Promise<ImageResult | null> {
  try {
    const searchUrl = `https://www.optimera.no/sok?q=${encodeURIComponent(nobb)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
    });
    if (!res.ok) return null;

    const html = await res.text();
    // Strict NOBB match required to prevent cross-product contamination.
    if (!new RegExp(`"nobbNumber"\\s*:\\s*"${nobb}"`).test(html)) return null;

    const imgMatch = html.match(
      /https:\/\/media\.optimera\.no\/[^"'\s?]+\.(?:jpg|jpeg|png|webp)/i,
    );
    if (!imgMatch) return null;

    const imgRes = await fetch(imgMatch[0], { headers: { "User-Agent": USER_AGENT } });
    if (!imgRes.ok) return null;
    const ct = imgRes.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().startsWith("image/")) return null;
    return { bytes: await imgRes.arrayBuffer(), contentType: ct };
  } catch {
    return null;
  }
}

async function fetchByggmakker(nobb: string): Promise<ImageResult | null> {
  const candidates = [
    `https://bilder.byggmakker.no/img/${nobb}-1-800x800.jpg`,
    `https://bilder.byggmakker.no/img/${nobb}-800x800.jpg`,
    `https://bilder.byggmakker.no/img/${nobb}.jpg`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.toLowerCase().startsWith("image/")) continue;
      return { bytes: await res.arrayBuffer(), contentType: ct };
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

type RouteContext = {
  params: Promise<{
    nobb: string;
  }>;
};

export async function GET(_req: Request, { params }: RouteContext) {
  const { nobb } = await params;

  if (!/^\d+$/.test(nobb)) {
    return new Response("Bad Request", { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  // 1. Check Supabase cache
  if (supabase) {
    const cached = await findImageInSupabase(supabase, nobb);
    if (cached) {
      return new Response(cached.bytes, {
        headers: {
          "Content-Type": cached.contentType,
          "Cache-Control": `public, max-age=${HIT_CACHE_SECONDS}, immutable`,
        },
      });
    }

    // 2. Check null marker (no image found previously)
    const isNull = await checkNullMarker(supabase, nobb);
    if (isNull) {
      return Response.redirect(STORE_IMAGE_FALLBACK_URL, 302);
    }
  }

  // 3. Fetch from external sources
  const result =
    (await fetchNobbExport(nobb)) ??
    (await fetchOptimera(nobb)) ??
    (await fetchByggmakker(nobb));

  // 4. Persist result to Supabase
  if (supabase) {
    if (result) {
      await saveImageToSupabase(supabase, nobb, result.bytes, result.contentType);
    } else {
      await saveNullMarker(supabase, nobb);
    }
  }

  if (result) {
    return new Response(result.bytes, {
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": `public, max-age=${HIT_CACHE_SECONDS}, immutable`,
      },
    });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: STORE_IMAGE_FALLBACK_URL,
      "Cache-Control": `public, max-age=${MISS_CACHE_SECONDS}`,
    },
  });
}
