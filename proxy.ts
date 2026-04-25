import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env, hasSupabaseEnv } from "@/lib/env";

const PUBLIC_PATHS = new Set(["/login", "/auth/callback"]);

const PROTECTED_PREFIXES = ["/min-side", "/prosjekter", "/betaling", "/admin"];

// ---------------------------------------------------------------------------
// Per-IP rate limiting for sensitive POST endpoints.
// Uses a sliding-window counter stored in process memory.
// NOTE: This is per-instance — for distributed deployments with many serverless
// instances, replace with an Upstash Redis-backed rate limiter.
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // max 10 POSTs per IP per minute

// Map<ip, timestamps[]>
const rateLimitStore = new Map<string, number[]>();

const RATE_LIMITED_PATTERNS = [
  /^\/api\/checkout$/,
  /^\/api\/material-orders\/[^/]+\/checkout$/,
  /^\/api\/material-list-ai$/,
];

/** Returns true if the given IP has exceeded the rate limit. Mutates rateLimitStore. */
export function checkRateLimit(ip: string, now: number = Date.now()): boolean {
  const existing = rateLimitStore.get(ip) ?? [];
  const recent = existing.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimitStore.set(ip, recent);
    return true; // blocked
  }

  recent.push(now);
  rateLimitStore.set(ip, recent);

  // Evict entries older than 5 minutes to keep the map bounded.
  if (rateLimitStore.size > 5_000) {
    const evictBefore = now - 5 * RATE_LIMIT_WINDOW_MS;
    for (const [key, ts] of rateLimitStore) {
      const live = ts.filter((t) => t > evictBefore);
      if (live.length === 0) {
        rateLimitStore.delete(key);
      } else {
        rateLimitStore.set(key, live);
      }
    }
  }

  return false; // allowed
}

function isAdminHostname(hostname: string) {
  return hostname.startsWith("admin.");
}

function isBlockedPath(pathname: string) {
  return pathname === "/prislister" ||
    pathname.startsWith("/prislister/") ||
    pathname === "/.private" ||
    pathname.startsWith("/.private/");
}

function getAdminRewrittenPath(pathname: string) {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return pathname;
  }
  return `/admin${pathname}`;
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  );
}

function toLoginRedirect(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set("next", nextPath);
  return NextResponse.redirect(loginUrl);
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const hostname = request.headers.get("host") || "";

  // Rate limit sensitive POST endpoints
  if (request.method === "POST" && RATE_LIMITED_PATTERNS.some((re) => re.test(pathname))) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    if (checkRateLimit(ip)) {
      return new NextResponse("Too Many Requests", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    }
  }

  if (
    pathname.startsWith("/min-side/materiallister/") &&
    pathname.endsWith("/bestilling") &&
    (request.nextUrl.searchParams.has("supplier") || request.nextUrl.searchParams.has("selectedSupplier"))
  ) {
    const canonicalUrl = request.nextUrl.clone();
    const hadSupplierParam =
      canonicalUrl.searchParams.has("supplier") || canonicalUrl.searchParams.has("selectedSupplier");

    if (hadSupplierParam) {
      canonicalUrl.searchParams.delete("supplier");
      canonicalUrl.searchParams.delete("selectedSupplier");
      return NextResponse.redirect(canonicalUrl);
    }
  }

  if (isBlockedPath(pathname)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  let response: NextResponse;

  // Offentlige stier som /login og /auth/callback håndteres uten rewrite
  if (PUBLIC_PATHS.has(pathname)) {
    response = NextResponse.next({ request });
  } else if (isAdminHostname(hostname)) {
    // admin.localhost → rewrite to /admin/...
    response = NextResponse.rewrite(
      new URL(`${getAdminRewrittenPath(pathname)}${request.nextUrl.search}`, request.url)
    );
  } else {
    response = NextResponse.next({ request });
  }

  // Only require auth for protected paths
  if (!isProtectedPath(pathname)) {
    return response;
  }

  if (!hasSupabaseEnv()) {
    return toLoginRedirect(request);
  }

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          if (response) {
            response.cookies.set(name, value, options);
          }
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toLoginRedirect(request);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|css|js|map)$).*)",
  ],
};
