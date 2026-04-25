"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import type { StorefrontSortOption } from "@/lib/storefront-types";

export function StorefrontViewControls({
  initialSort,
  initialCols,
}: {
  initialSort: StorefrontSortOption;
  initialCols: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const sort = normalizeSortOption(searchParams.get("sort") ?? initialSort);
  const cols = normalizeGridColumns(searchParams.get("cols") ?? String(initialCols));

  function updateViewParam(key: "sort" | "cols", value: string) {
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
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <label htmlFor="sort" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
          Sorter
        </label>
        <select
          id="sort"
          name="sort"
          value={sort}
          disabled={isPending}
          onChange={(event) => updateViewParam("sort", event.target.value)}
          className="h-9 rounded-full border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none transition focus:border-[#15452d] disabled:cursor-wait disabled:bg-stone-50"
        >
          <option value="relevance">Mest relevant</option>
          <option value="price_asc">Laveste pris</option>
          <option value="price_desc">Høyeste pris</option>
          <option value="newest">Sist oppdatert</option>
        </select>
      </div>

      <div className="hidden items-center gap-1 rounded-full border border-stone-300 bg-white p-0.5 lg:flex" role="group" aria-label="Kolonner">
        {[4, 5, 6].map((value) => {
          const active = cols === value;
          return (
            <button
              key={value}
              type="button"
              disabled={isPending}
              onClick={() => updateViewParam("cols", String(value))}
              className={`inline-flex h-7 min-w-[32px] items-center justify-center rounded-full px-2 text-xs font-semibold transition ${
                active ? "bg-[#15452d] text-white!" : "text-stone-600 hover:text-stone-900"
              }`}
              aria-pressed={active}
              aria-label={`${value} kolonner`}
            >
              {value}
            </button>
          );
        })}
      </div>

      {isPending ? (
        <span className="text-[11px] text-stone-400" aria-live="polite">
          Oppdaterer…
        </span>
      ) : null}
    </div>
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

function normalizeGridColumns(value: string) {
  if (value === "5") {
    return 5;
  }

  if (value === "6") {
    return 6;
  }

  return 4;
}
