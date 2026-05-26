import { NextResponse } from "next/server";

import { env, hasStorefrontImageWarmupSecret } from "@/lib/env";
import { getStorefrontProducts } from "@/lib/storefront";
import { isAllowedStorefrontImageUrl } from "@/lib/storefront-image";

export const maxDuration = 300;

const DEFAULT_LIMIT = 150;
const MAX_LIMIT = 800;
const DEFAULT_CONCURRENCY = 6;
const MAX_CONCURRENCY = 20;

type WarmupRequestBody = {
  limit?: number;
  concurrency?: number;
  nobbs?: string[];
};

type WarmupStats = {
  total: number;
  processed: number;
  resolved: number;
  hitStorage: number;
  nullMarker: number;
  fallback: number;
  deferred: number;
  unauthorizedResolve: number;
  unknown: number;
  failed: number;
};

function normalizePositiveInt(raw: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(raw)) {
    return fallback;
  }

  const rounded = Math.round(raw ?? fallback);

  if (rounded < 1) {
    return fallback;
  }

  return Math.min(rounded, max);
}

function extractWarmupToken(request: Request): string {
  const headerToken = request.headers.get("x-storefront-image-warmup-secret")?.trim() ?? "";
  if (headerToken) return headerToken;

  const bearerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  return bearerToken;
}

function isAuthorizedWarmupRequest(request: Request): boolean {
  if (!hasStorefrontImageWarmupSecret()) {
    return false;
  }

  const token = extractWarmupToken(request);
  return token.length > 0 && token === env.storefrontImageWarmupSecret;
}

function normalizeNobbList(values: string[]): string[] {
  const deduped = new Set<string>();

  for (const value of values) {
    const nobb = value.replace(/\D/g, "");
    if (nobb.length > 0) {
      deduped.add(nobb);
    }
  }

  return Array.from(deduped);
}

async function parseBody(request: Request): Promise<WarmupRequestBody> {
  if (request.method !== "POST") {
    return {};
  }

  try {
    const json = (await request.json()) as unknown;
    if (!json || typeof json !== "object") {
      return {};
    }

    const body = json as WarmupRequestBody;
    return {
      limit: typeof body.limit === "number" ? body.limit : undefined,
      concurrency: typeof body.concurrency === "number" ? body.concurrency : undefined,
      nobbs: Array.isArray(body.nobbs) ? body.nobbs.filter((n): n is string => typeof n === "string") : undefined,
    };
  } catch {
    return {};
  }
}

async function buildWarmupNobbList(body: WarmupRequestBody, limit: number): Promise<string[]> {
  if (body.nobbs && body.nobbs.length > 0) {
    return normalizeNobbList(body.nobbs).slice(0, limit);
  }

  const { products } = await getStorefrontProducts();
  const needsResolution = products
    .filter((product) => product.nobbNumber && !isAllowedStorefrontImageUrl(product.imageUrl))
    .map((product) => product.nobbNumber);

  return normalizeNobbList(needsResolution).slice(0, limit);
}

async function runWarmupBatch(args: {
  origin: string;
  nobbs: string[];
  concurrency: number;
}): Promise<WarmupStats> {
  const stats: WarmupStats = {
    total: args.nobbs.length,
    processed: 0,
    resolved: 0,
    hitStorage: 0,
    nullMarker: 0,
    fallback: 0,
    deferred: 0,
    unauthorizedResolve: 0,
    unknown: 0,
    failed: 0,
  };

  if (args.nobbs.length === 0) {
    return stats;
  }

  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= args.nobbs.length) {
        return;
      }

      const nobb = args.nobbs[index];
      const endpoint = `${args.origin}/api/storefront-images/${encodeURIComponent(nobb)}?resolve=1`;

      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${env.storefrontImageWarmupSecret}`,
            "x-storefront-image-warmup-secret": env.storefrontImageWarmupSecret,
          },
          redirect: "manual",
          cache: "no-store",
        });

        stats.processed += 1;

        const cacheStatus = (response.headers.get("x-storefront-image-cache") ?? "").toLowerCase();

        if (cacheStatus === "miss-resolved") {
          stats.resolved += 1;
          continue;
        }
        if (cacheStatus === "hit-storage") {
          stats.hitStorage += 1;
          continue;
        }
        if (cacheStatus === "null-marker") {
          stats.nullMarker += 1;
          continue;
        }
        if (cacheStatus === "miss-fallback") {
          stats.fallback += 1;
          continue;
        }
        if (cacheStatus === "miss-deferred") {
          stats.deferred += 1;
          continue;
        }

        if (response.status === 401 || response.status === 403) {
          stats.unauthorizedResolve += 1;
          continue;
        }

        if (!response.ok && response.status !== 302) {
          stats.failed += 1;
          continue;
        }

        stats.unknown += 1;
      } catch {
        stats.failed += 1;
      }
    }
  }

  const workerCount = Math.min(args.concurrency, args.nobbs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return stats;
}

async function handleWarmupRequest(request: Request) {
  if (!hasStorefrontImageWarmupSecret()) {
    return NextResponse.json(
      {
        ok: false,
        error: "STOREFRONT_IMAGE_WARMUP_SECRET or CRON_SECRET is not configured.",
      },
      { status: 503 },
    );
  }

  if (!isAuthorizedWarmupRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = performance.now();
  const body = await parseBody(request);
  const limit = normalizePositiveInt(body.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const concurrency = normalizePositiveInt(body.concurrency, DEFAULT_CONCURRENCY, MAX_CONCURRENCY);
  const origin = new URL(request.url).origin;

  const nobbs = await buildWarmupNobbList(body, limit);
  const stats = await runWarmupBatch({ origin, nobbs, concurrency });

  return NextResponse.json({
    ok: true,
    durationMs: Number((performance.now() - startedAt).toFixed(1)),
    limit,
    concurrency,
    ...stats,
  });
}

export async function GET(request: Request) {
  return handleWarmupRequest(request);
}

export async function POST(request: Request) {
  return handleWarmupRequest(request);
}
