"use client";

import { ArrowUpDown, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import type { StorefrontSortOption } from "@/lib/storefront-types";

type StorefrontMobileControlsProps = {
  children: ReactNode;
  activeFiltersCount: number;
  initialSort: StorefrontSortOption;
  initialInStockOnly?: boolean;
};

export function StorefrontMobileControls({
  children,
  activeFiltersCount,
  initialSort,
  initialInStockOnly = false,
}: StorefrontMobileControlsProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const sort = normalizeSortOption(searchParams.get("sort") ?? initialSort);
  const inStockParam = searchParams.get("inStock");
  const inStockOnly = inStockParam === null ? initialInStockOnly : inStockParam === "1";

  function updateViewParam(key: "sort" | "inStock", value: string) {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (value.trim().length > 0) {
      nextParams.set(key, value);
    } else {
      nextParams.delete(key);
    }

    nextParams.delete("page");

    const query = nextParams.toString();
    const href = query.length > 0 ? `${pathname}?${query}` : pathname;

    startTransition(() => {
      router.replace(href, { scroll: false });
    });
  }

  return (
    <>
      <div className="rounded-xl border border-stone-200 bg-white p-2 shadow-[0_6px_18px_rgba(32,25,15,0.05)] lg:hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 text-sm font-semibold text-stone-800 transition hover:border-[#15452d] hover:text-[#15452d]"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            <span>Filtrer</span>
            {activeFiltersCount > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#15452d] px-1.5 text-[11px] font-semibold text-white">
                {activeFiltersCount}
              </span>
            ) : null}
          </button>

          <label className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition has-disabled:cursor-wait ${
            inStockOnly
              ? "border-[#15452d] bg-[#15452d] text-white"
              : "border-stone-200 bg-stone-50 text-stone-800 hover:border-[#15452d] hover:text-[#15452d]"
          }`}>
            <input
              type="checkbox"
              checked={inStockOnly}
              disabled={isPending}
              onChange={(event) => updateViewParam("inStock", event.currentTarget.checked ? "1" : "")}
              className="peer sr-only"
            />
            <span className={`relative h-4 w-7 rounded-full transition after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:shadow after:transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 ${
              inStockOnly
                ? "bg-white/30 after:translate-x-3 peer-focus-visible:outline-white"
                : "bg-stone-300 peer-focus-visible:outline-[#15452d]"
            }`} />
            <span>På lager</span>
          </label>
        </div>

        <label className="mt-2 grid h-10 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
            <ArrowUpDown className="h-3.5 w-3.5" aria-hidden />
            Sorter
          </span>
          <select
            name="sort"
            value={sort}
            disabled={isPending}
            onChange={(event) => updateViewParam("sort", event.target.value)}
            className="min-w-0 bg-transparent text-right text-sm font-semibold text-stone-900 outline-none disabled:cursor-wait"
          >
            <option value="relevance">Mest relevant</option>
            <option value="price_asc">Laveste pris</option>
            <option value="price_desc">Høyeste pris</option>
            <option value="newest">Sist oppdatert</option>
          </select>
        </label>

        {isPending ? (
          <p className="px-1 pt-2 text-[11px] font-medium text-stone-400" aria-live="polite">
            Oppdaterer...
          </p>
        ) : null}
      </div>

      {open ? (
        <button
          type="button"
          aria-label="Lukk filterpanel"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[1px] lg:hidden"
        />
      ) : null}

      <div
        className={`fixed inset-x-0 bottom-0 z-50 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_40px_rgba(0,0,0,0.18)] transition-transform duration-300 ease-in-out lg:hidden ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-100 bg-white px-4 py-3">
          <p className="font-semibold text-stone-900">Filtrer varer</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 text-stone-500 transition hover:bg-stone-50"
            aria-label="Lukk"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </>
  );
}

function normalizeSortOption(value: string): StorefrontSortOption {
  switch (value) {
    case "price_asc":
    case "price_desc":
    case "name_asc":
    case "newest":
      return value;
    default:
      return "relevance";
  }
}