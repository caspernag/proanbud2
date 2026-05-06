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
    <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 shadow-[0_2px_12px_rgba(15,23,42,0.05)] backdrop-blur">
      <div className="hidden bg-[#123321] text-white lg:block">
        <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-4 px-8 py-1.5 text-[11px] font-medium tracking-wide">
          <div className="flex items-center gap-4 text-emerald-50/90">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex h-4 items-center rounded-sm bg-[#d9ff7a] px-1.5 text-[10px] font-bold text-[#0f321f]">PARTNERPRIS</span>
              Byggevarer til <strong className="text-[#d9ff7a]">proffpris</strong>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Dot /> Gratis frakt over 15 000 kr
            </span>
            <span className="inline-flex items-center gap-1.5">
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

      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-2 px-3 py-2.5 sm:px-6 md:py-3 lg:flex-row lg:items-center lg:gap-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2 lg:contents">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <Image
              src="/logo/light/icon-primary.svg"
              alt="Proanbud"
              width={32}
              height={32}
              className="h-8 w-8 sm:hidden"
              priority
            />
            <Image
              src="/logo/light/logo-primary.svg"
              alt="Proanbud"
              width={160}
              height={34}
              className="hidden h-8 w-auto sm:block lg:h-9"
              priority
            />
            <span className="hidden rounded-sm bg-[#d9ff7a] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#0f321f] lg:inline-flex">
              Partnerpris
            </span>
          </Link>

          <div className="ml-auto flex min-w-0 items-center gap-1.5 lg:hidden">
            <CartLink onCheckout={onCheckout} totalQuantity={totalQuantity} compact />
          </div>
        </div>

        <form
          action="/"
          className="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-lg border border-stone-200 bg-stone-50 shadow-sm focus-within:border-[#15452d] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#15452d]/15 lg:rounded-md lg:bg-white"
        >
          <div className="flex items-center pl-3.5 text-stone-400 sm:pl-4">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <circle cx="9" cy="9" r="6" />
              <path d="M14 14l4 4" strokeLinecap="round" />
            </svg>
          </div>
          <input
            type="search"
            name="q"
            defaultValue={currentQuery}
            placeholder="Søk byggevarer"
            className="h-11 min-w-0 flex-1 bg-transparent px-2.5 text-[16px] text-stone-900 outline-none placeholder:text-stone-400 sm:px-3 sm:text-sm"
          />
          <button
            type="submit"
            className="inline-flex h-11 min-w-11 items-center justify-center bg-[#15452d] px-3 text-sm font-semibold text-white transition hover:bg-[#0f321f] sm:px-5"
            aria-label="Søk"
          >
            <span className="hidden sm:inline">Søk</span>
            <SearchIcon />
          </button>
        </form>

        <div className="hidden shrink-0 lg:block">
          <CartLink onCheckout={onCheckout} totalQuantity={totalQuantity} />
        </div>
      </div>

      <nav className="hidden border-t border-stone-200 bg-white md:block">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-2 px-3 py-1.5 text-sm sm:px-6 lg:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
            {TOP_CATEGORIES.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-[13px] font-semibold transition ${
                  item.highlight
                    ? "bg-[#c03a2b] text-white hover:bg-[#a32d22]"
                    : "text-stone-700 hover:bg-stone-100 hover:text-stone-950"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
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

function CartLink({
  onCheckout,
  totalQuantity,
  compact = false,
}: {
  onCheckout: boolean;
  totalQuantity: number;
  compact?: boolean;
}) {
  return (
    <Link
      href="/checkout"
      className={`relative inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border text-sm font-semibold transition ${
        compact ? "w-10 px-0" : "px-3"
      } ${
        onCheckout
          ? "border-[#15452d] bg-[#15452d] text-white!"
          : "border-stone-200 bg-white text-stone-800 shadow-sm hover:border-[#15452d] hover:text-[#15452d]"
      }`}
      aria-label="Handlekurv"
    >
      <CartIcon />
      <span className={compact ? "sr-only" : "hidden sm:inline"}>Handlekurv</span>
      {totalQuantity > 0 ? (
        <span
          className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
            compact ? "absolute -right-1 -top-1" : ""
          } ${onCheckout ? "bg-white/20 text-white" : "bg-[#c03a2b] text-white"}`}
        >
          {totalQuantity}
        </span>
      ) : null}
    </Link>
  );
}

function Dot() {
  return <span className="h-1 w-1 rounded-full bg-[#d9ff7a]" />;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 sm:hidden" aria-hidden="true">
      <circle cx="9" cy="9" r="6" />
      <path d="M14 14l4 4" strokeLinecap="round" />
    </svg>
  );
}

