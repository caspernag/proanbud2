import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env, hasSupabaseEnv } from "@/lib/env";

const PUBLIC_PATHS = new Set(["/login", "/auth/callback"]);

const PROTECTED_PREFIXES = ["/min-side", "/prosjekter", "/betaling", "/admin"];

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
