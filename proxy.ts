import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env, hasSupabaseEnv } from "@/lib/env";

const PUBLIC_PATHS = new Set(["/login", "/auth/callback"]);

function isAdminHostname(hostname: string) {
  return hostname.startsWith("admin.");
}

function isAppHostname(hostname: string) {
  return hostname.startsWith("app.");
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

function getLandingRewrittenPath(pathname: string) {
  if (pathname === "/landing" || pathname.startsWith("/landing/")) {
    return pathname;
  }
  return `/landing${pathname}`;
}

function isPublicPath(pathname: string, hostname: string) {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }
  if (!isAdminHostname(hostname) && !isAppHostname(hostname)) {
    return true; 
  }
  return false;
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
  
  if (isBlockedPath(pathname)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const isBase = !isAdminHostname(hostname) && !isAppHostname(hostname);

  let response: NextResponse;

  // Offentlige stier som /login og /auth/callback skal håndteres rot-nivå, uten rewrite
  if (PUBLIC_PATHS.has(pathname)) {
    response = NextResponse.next({ request });
  } else if (isAdminHostname(hostname)) {
    response = NextResponse.rewrite(
      new URL(`${getAdminRewrittenPath(pathname)}${request.nextUrl.search}`, request.url)
    );
  } else if (isBase) {
    response = NextResponse.rewrite(
      new URL(`${getLandingRewrittenPath(pathname)}${request.nextUrl.search}`, request.url)
    );
  } else {
    response = NextResponse.next({ request });
  }

  if (isPublicPath(pathname, hostname) || isBase) {
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
