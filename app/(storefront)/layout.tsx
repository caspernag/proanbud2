import { Suspense, type ReactNode } from "react";

import { StorefrontHeader } from "@/app/_components/storefront/storefront-header";
import { StorefrontProvider } from "@/app/_components/storefront/storefront-provider";

export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <StorefrontProvider>
      <div className="min-h-screen bg-[#f5f4f1] text-stone-900">
        <Suspense fallback={<StorefrontHeaderFallback />}>
          <StorefrontHeader />
        </Suspense>
        <main className="mx-auto w-full max-w-[1500px] px-3 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pt-5 lg:px-8">
          <Suspense fallback={null}>
            {children}
          </Suspense>
        </main>
      </div>
    </StorefrontProvider>
  );
}

function StorefrontHeaderFallback() {
  return (
    <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 shadow-[0_2px_12px_rgba(15,23,42,0.05)] backdrop-blur">
      <div className="hidden bg-[#123321] text-white lg:block">
        <div className="mx-auto flex w-full max-w-[1500px] items-center justify-between gap-4 px-8 py-1.5 text-[11px] font-medium tracking-wide">
          <div className="flex items-center gap-4 text-emerald-50/90">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex h-4 items-center rounded-sm bg-[#d9ff7a] px-1.5 text-[10px] font-bold text-[#0f321f]">PARTNERPRIS</span>
              Byggevarer til <strong className="text-[#d9ff7a]">proffpris</strong>
            </span>
            <span>Gratis frakt over 15 000 kr</span>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-2 px-3 py-2.5 sm:px-6 md:py-3 lg:flex-row lg:items-center lg:gap-6 lg:px-8">
        <div className="flex items-center gap-2 lg:contents">
          <div className="h-8 w-8 rounded-md bg-[#15452d] sm:h-8 sm:w-32" />
          <span className="hidden rounded-md bg-[#d9ff7a] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#0f321f] sm:inline-flex">
            Partnerpris
          </span>
          <div className="ml-auto flex items-center gap-1.5 lg:hidden">
            <div className="h-10 w-10 rounded-lg border border-stone-200 bg-white shadow-sm" />
          </div>
        </div>

        <div className="flex h-11 min-w-0 flex-1 items-center rounded-lg border border-stone-200 bg-stone-50 px-4 text-sm text-stone-400 shadow-sm lg:rounded-md lg:bg-white">
          Søk byggevarer
        </div>
      </div>

      <nav className="hidden border-t border-stone-200 bg-white md:block">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-2 overflow-hidden px-3 py-1.5 sm:px-6 lg:px-8">
          {Array.from({ length: 8 }, (_, index) => (
            <span key={index} className="h-9 w-24 shrink-0 rounded-md bg-stone-100" />
          ))}
        </div>
      </nav>
    </header>
  );
}
