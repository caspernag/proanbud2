"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { useStorefront } from "@/app/_components/storefront/storefront-provider";

// Ekte kategorier fra prislistens Varekategori-felt. Bruker /?category=... (filter),
// ikke /?q=... (søk). Filteret gjør case-insensitive includes-match, så korte navn
// som "Verktøy" og "Tak" treffer flere nærliggende kategorier (Elverktøy, Håndverktøy;
// Takbeslag, Taktekking) uten å miste presisjon.
const TOP_CATEGORIES: Array<{ label: string; href: string; highlight?: boolean }> = [
  { label: "Konstruksjonsvirke", href: "/?category=Konstruksjonsvirke" },
  { label: "Isolasjon", href: "/?category=Isolasjon" },
  { label: "Gips og plater", href: "/?category=Gips%20og%20plater" },
  { label: "Festemidler", href: "/?category=Festemidler" },
  { label: "Maling", href: "/?category=Maling" },
  { label: "Verktøy", href: "/?category=verkt%C3%B8y" },
  { label: "Tak", href: "/?category=tak" },
  { label: "Kledning", href: "/?category=Kledning" },
];

export function StorefrontHeader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { totalQuantity } = useStorefront();
  const currentQuery = searchParams.get("q") ?? "";
  const onCheckout = pathname.startsWith("/checkout");

  return (
    <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 shadow-[0_2px_10px_rgba(18,36,25,0.05)] backdrop-blur">
      {/* Top info strip */}
      <div className="bg-[#0f321f] text-white">
        <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-4 px-4 py-1.5 text-[11px] font-medium tracking-wide sm:px-6 lg:px-8">
          <div className="flex items-center gap-4 text-emerald-50/90">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex h-4 items-center rounded-sm bg-[#d9ff7a] px-1.5 text-[10px] font-bold text-[#0f321f]">PARTNERPRIS</span>
              Byggevarer under <strong className="text-[#d9ff7a]">veil. pris</strong>
            </span>
            <span className="hidden items-center gap-1.5 md:inline-flex">
              <Dot /> Gratis frakt over 5 000 kr
            </span>
            <span className="hidden items-center gap-1.5 lg:inline-flex">
              <Dot /> Lag materialliste med KI
            </span>
          </div>
          <div className="flex items-center gap-4 text-emerald-50/80">
            <Link href="/min-side" className="hover:text-white">Min side</Link>
            <span className="hidden h-3 w-px bg-emerald-50/30 sm:inline" />
            <Link href="/min-side/materiallister" className="hidden hover:text-white sm:inline">Materiallister</Link>
          </div>
        </div>
      </div>

      {/* Main bar */}
      <div className="mx-auto flex w-full max-w-[1500px] items-center gap-4 px-4 py-3 sm:px-6 lg:gap-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <Image
            src="/logo/light/logo-primary.svg"
            alt="Proanbud"
            width={160}
            height={34}
            className="h-7 w-auto sm:h-8"
            priority
          />
          <span className="hidden rounded-md bg-[#d9ff7a] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#0f321f] sm:inline-flex">
            Partnerpris
          </span>
        </Link>

        <form
          action="/"
          className="flex flex-1 items-stretch overflow-hidden rounded-full border border-stone-300 bg-white shadow-sm focus-within:border-[#15452d] focus-within:ring-2 focus-within:ring-[#15452d]/20"
        >
          <div className="flex items-center pl-4 text-stone-400">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <circle cx="9" cy="9" r="6" />
              <path d="M14 14l4 4" strokeLinecap="round" />
            </svg>
          </div>
          <input
            type="search"
            name="q"
            defaultValue={currentQuery}
            placeholder="Søk etter byggevarer, varenummer eller merke"
            className="h-11 flex-1 bg-transparent px-3 text-sm text-stone-900 outline-none placeholder:text-stone-400"
          />
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center bg-[#15452d] px-5 text-sm font-semibold text-white transition hover:bg-[#0f321f]"
          >
            Søk
          </button>
        </form>

        <Link
          href="/checkout"
          className={`relative inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition sm:px-4 ${
            onCheckout
              ? "border-[#15452d] bg-[#15452d] text-white!"
              : "border-stone-300 bg-white text-stone-800 hover:border-[#15452d] hover:text-[#15452d]"
          }`}
        >
          <CartIcon />
          <span className="hidden sm:inline">Handlekurv</span>
          <span
            className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
              onCheckout ? "bg-white/20 text-white" : "bg-[#c03a2b] text-white"
            }`}
          >
            {totalQuantity}
          </span>
        </Link>
      </div>

      {/* Category rail */}
      <nav className="border-t border-stone-200 bg-white">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-1 overflow-x-auto px-4 py-1.5 text-sm scrollbar-none sm:px-6 lg:px-8">
          {TOP_CATEGORIES.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition ${
                item.highlight
                  ? "bg-[#c03a2b] text-white hover:bg-[#a32d22]"
                  : "text-stone-700 hover:bg-stone-100 hover:text-stone-900"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
      <path d="M2 3h2l2 11a1.8 1.8 0 001.8 1.5h6.7a1.8 1.8 0 001.8-1.4L18 7H5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="18" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-[#d9ff7a]" />;
}
