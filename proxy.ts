import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env, hasSupabaseEnv } from "@/lib/env";

const PUBLIC_PATHS = new Set(["/login", "/auth/callback"]);

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

function isPublicPath(pathname: string, hostname: string) {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }

  // Keep the marketing home page public on the main hostname only.
  return pathname === "/" && !isAdminHostname(hostname);
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
  const shouldRewriteToAdmin = isAdminHostname(hostname);

  if (isBlockedPath(pathname)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  if (isPublicPath(pathname, hostname)) {
    return NextResponse.next();
  }

  if (!hasSupabaseEnv()) {
    return toLoginRedirect(request);
  }

  const response = shouldRewriteToAdmin
    ? NextResponse.rewrite(
        new URL(
          `${getAdminRewrittenPath(pathname)}${request.nextUrl.search}`,
          request.url,
        ),
      )
    : NextResponse.next({
        request,
      });

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
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
