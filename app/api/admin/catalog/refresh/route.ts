import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { refreshStorefrontCatalog } from "@/lib/storefront-catalog-refresh";

// The refresh parses the entire OpenAI vector store, so it can run for a while.
// NOTE: `runtime` and `dynamic` route-segment configs are incompatible with
// cacheComponents (next.config.ts) — route handlers are dynamic by default here.
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secrets = [env.cronSecret, env.storefrontImageWarmupSecret].filter(Boolean);
  if (secrets.length === 0) {
    return false;
  }

  const bearer = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  const headerSecret = request.headers.get("x-cron-secret")?.trim();

  return secrets.some((secret) => secret === bearer || secret === headerSecret);
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await refreshStorefrontCatalog();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

// Vercel Cron triggers via GET (with Authorization: Bearer $CRON_SECRET);
// POST is supported for manual/admin invocation.
export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
