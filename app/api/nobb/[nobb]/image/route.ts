import { NextResponse } from "next/server";

const NOBB_ITEM_TIMEOUT_MS = 8_000;
const NOBB_ITEM_IMAGE_CACHE_TTL_MS = 30 * 60 * 1_000;
const NOBB_ITEM_IMAGE_NULL_CACHE_TTL_MS = 2 * 60 * 1_000;

const nobbItemImageCache = new Map<
  string,
  {
    expiresAt: number;
    imageUrl: string | null;
  }
>();

type RouteContext = {
  params: Promise<{
    nobb: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { nobb } = await context.params;
  const nobbNumber = nobb.trim();

  if (!nobbNumber) {
    return NextResponse.json({ error: "Ugyldig NOBB-nummer." }, { status: 400 });
  }

  const cachedImageUrl = getCachedNobbItemImage(nobbNumber);

  if (cachedImageUrl !== undefined) {
    return NextResponse.json({ imageUrl: cachedImageUrl });
  }

  const imageUrl = await fetchNobbItemImageUrl(nobbNumber);
  setCachedNobbItemImage(nobbNumber, imageUrl);

  return NextResponse.json({ imageUrl });
}

async function fetchNobbItemImageUrl(nobbNumber: string) {
  const itemUrls = [
    `https://nobb.no/item/${encodeURIComponent(nobbNumber)}`,
    `https://www.nobb.no/item/${encodeURIComponent(nobbNumber)}`,
  ];

  for (const itemUrl of itemUrls) {
    const imageUrl = await fetchNobbItemImageUrlFromPage(itemUrl);

    if (imageUrl) {
      return imageUrl;
    }
  }

  return null;
}

async function fetchNobbItemImageUrlFromPage(itemUrl: string) {
  try {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), NOBB_ITEM_TIMEOUT_MS);

    let response: Response;

    try {
      response = await fetch(itemUrl, {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "nb-NO,nb;q=0.9,en;q=0.8",
          Referer: "https://nobb.no/",
          "User-Agent": "Mozilla/5.0 (compatible; ProAnbudBot/1.0)",
        },
        cache: "no-store",
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // NOBB may return a verification/splash page for automated requests.
    if (isVerificationPage(html)) {
      return null;
    }

    return extractImageUrlFromNobbItemHtml(html);
  } catch {
    return null;
  }
}

function extractImageUrlFromNobbItemHtml(html: string) {
  const imageTagMatches = html.match(/<img\b[^>]*>/gi) ?? [];

  for (const tag of imageTagMatches) {
    if (!/mud-image/i.test(tag)) {
      continue;
    }

    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    const src = srcMatch?.[1]?.trim();

    if (!src || !/cdn\.byggtjeneste\.no\/nobb\//i.test(src)) {
      continue;
    }

    return normalizeImageUrl(src);
  }

  const fallbackSrcMatch = html.match(/\bsrc=["'](https?:\/\/cdn\.byggtjeneste\.no\/nobb\/[^"']+)["']/i);
  return fallbackSrcMatch ? normalizeImageUrl(fallbackSrcMatch[1]) : null;
}

function normalizeImageUrl(url: string) {
  if (url.startsWith("//")) {
    return `https:${url}`;
  }

  return url.replace(/&amp;/g, "&");
}

function isVerificationPage(html: string) {
  return /verifiser bruker|recaptcha|truendo/i.test(html);
}

function getCachedNobbItemImage(nobbNumber: string) {
  const cached = nobbItemImageCache.get(nobbNumber);

  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    nobbItemImageCache.delete(nobbNumber);
    return undefined;
  }

  return cached.imageUrl;
}

function setCachedNobbItemImage(nobbNumber: string, imageUrl: string | null) {
  nobbItemImageCache.set(nobbNumber, {
    expiresAt: Date.now() + (imageUrl ? NOBB_ITEM_IMAGE_CACHE_TTL_MS : NOBB_ITEM_IMAGE_NULL_CACHE_TTL_MS),
    imageUrl,
  });
}