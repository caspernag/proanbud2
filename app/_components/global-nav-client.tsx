"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SignOutButton } from "@/app/_components/sign-out-button";

type GlobalNavClientProps = {
  isLoggedIn: boolean;
  userEmail: string | null;
};

export function GlobalNavClient({ isLoggedIn, userEmail }: GlobalNavClientProps) {
  const pathname = usePathname();

  if (pathname === "/" || pathname.startsWith("/min-side") || pathname === "/login") {
    return null;
  }

  const isDashboardRoute = pathname === "/min-side" || pathname.startsWith("/min-side/");
  const isLoginRoute = pathname === "/login";

  return (
    <header className="border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center justify-between gap-2 px-3 py-2.5 sm:px-6 lg:px-8">
        <Link href="/" className="inline-flex items-center">
          <Image src="/logo/light/logo-primary.svg" alt="proanbud" width={146} height={32} className="h-6 w-auto sm:h-7" />
        </Link>
        <nav className="flex w-full items-center justify-end gap-1.5 sm:w-auto sm:gap-2">
          <Link
            href="/min-side"
            className={`rounded-full px-2.5 py-1.5 text-xs font-medium transition sm:px-3 sm:text-sm ${
              isDashboardRoute
                ? "bg-stone-900 text-white"
                : "text-stone-700 hover:bg-stone-100 hover:text-stone-900"
            }`}
          >
            Min side
          </Link>

          {isLoggedIn ? (
            <>
              <span className="max-w-[42vw] truncate rounded-full bg-[var(--accent-soft)] px-2.5 py-1.5 text-xs text-stone-700 sm:max-w-[240px] sm:px-3 sm:text-sm">
                {userEmail ?? "Innlogget bruker"}
              </span>
              <SignOutButton />
            </>
          ) : (
            <Link
              href="/login?next=/min-side"
              className={`rounded-full px-2.5 py-1.5 text-xs font-medium transition sm:px-3 sm:text-sm ${
                isLoginRoute
                  ? "bg-stone-900 text-white"
                  : "text-stone-700 hover:bg-stone-100 hover:text-stone-900"
              }`}
            >
              Logg inn
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
