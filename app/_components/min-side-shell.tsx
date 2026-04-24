"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { SignOutButton } from "@/app/_components/sign-out-button";

type MinSideShellProps = {
  children: ReactNode;
  userEmail: string | null;
};

type NavItem = {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Nettbutikk",
    isActive: (pathname) => pathname === "/" || pathname.startsWith("/checkout") || pathname.startsWith("/ordre/"),
  },
  {
    href: "/min-side",
    label: "Min side",
    isActive: (pathname) => pathname === "/min-side",
  },
  {
    href: "/min-side/materiallister",
    label: "Materiallister",
    isActive: (pathname) => pathname.startsWith("/min-side/materiallister"),
  },
  {
    href: "/min-side/bestillinger",
    label: "Bestillinger",
    isActive: (pathname) => pathname.startsWith("/min-side/bestillinger"),
  },
  {
    href: "/min-side/innstillinger",
    label: "Innstillinger",
    isActive: (pathname) => pathname.startsWith("/min-side/innstillinger"),
  },
];

export function MinSideShell({ children, userEmail }: MinSideShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-side-scope min-h-screen bg-[#e6e9e4] text-[#162019]">
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Lukk meny"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-[#0d1f16]/50 backdrop-blur-[1px] lg:hidden"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-[#15452d]/60 bg-[#0f271b] px-3 pb-3 pt-4 text-emerald-50 shadow-[14px_0_38px_rgba(6,18,12,0.34)] transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-center justify-between gap-2 px-1">
          <Link
            href="/min-side"
            className="inline-flex items-center"
            onClick={() => setMobileOpen(false)}
          >
            <Image
              src="/logo/dark/logo-primary.svg"
              alt="proanbud"
              width={162}
              height={36}
              className="h-6 w-auto"
              priority
            />
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[3px] border border-white/35 text-white lg:hidden"
          >
            <CloseIcon />
          </button>
        </div>

        <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-100/70">Navigasjon</p>

        <nav className="mt-2 space-y-0.5" aria-label="Hovedmeny">
          {NAV_ITEMS.map((item) => {
            const active = item.isActive(pathname);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex min-h-9 items-center rounded-[3px] border-l-2 px-2.5 text-[13px] font-medium transition ${
                  active
                    ? "border-l-emerald-200 bg-[#27a866] text-[#082014] shadow-[inset_0_0_0_1px_rgba(8,32,20,0.25)]"
                    : "border-l-transparent text-emerald-100/85 hover:bg-white/10 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-emerald-900/70 px-1 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-100/70">Bruker</p>
          <p className="mt-1 truncate text-xs font-medium text-white">{userEmail ?? "Ikke innlogget"}</p>
          <div className="mt-2.5">
            {userEmail ? (
              <SignOutButton tone="dark" />
            ) : (
              <Link
                href="/login?next=/min-side"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-8 items-center justify-center rounded-[3px] border border-white/40 px-3 text-xs font-semibold text-white transition hover:bg-white/10"
              >
                Logg inn
              </Link>
            )}
          </div>
        </div>
      </aside>

      <div className="relative flex min-h-screen flex-col lg:pl-64">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_8%_6%,rgba(34,172,106,0.18),transparent_42%),radial-gradient(circle_at_86%_7%,rgba(10,56,37,0.16),transparent_45%)]" />
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.35] [background-image:radial-gradient(rgba(16,92,58,0.26)_0.8px,transparent_0.8px)] [background-size:20px_20px]" />

        <header className="sticky top-0 z-20 border-b border-emerald-900/25 bg-[#0f271b] px-4 py-2.5 text-white lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              aria-label="Apne meny"
              onClick={() => setMobileOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[3px] border border-white/35 text-white"
            >
              <MenuIcon />
            </button>
            <p className="truncate text-xs font-semibold tracking-[0.12em] text-emerald-100">MIN SIDE</p>
            <Link
              href="/min-side"
              onClick={() => setMobileOpen(false)}
              className="inline-flex h-8 items-center justify-center rounded-[3px] border border-white/35 px-2 text-[11px] font-semibold text-white"
            >
              Hjem
            </Link>
          </div>
        </header>

        <main className="relative flex-1 px-3 pb-7 pt-3 sm:px-5 lg:px-6 lg:pt-5">
          <div className="mx-auto w-full max-w-[1500px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 12H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 17H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6L18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
