"use client";

import { useEffect, useRef, useState } from "react";

import type { ByggmakkerStoreStock } from "@/lib/byggmakker-availability";

type StorePickupDropdownProps = {
  stores: ByggmakkerStoreStock[];
};

export function StorePickupDropdown({ stores }: StorePickupDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (stores.length === 0) return null;

  const filtered = query.trim().length > 0
    ? stores.filter((store) => store.name.toLowerCase().includes(query.trim().toLowerCase()))
    : stores;

  const totalQuantity = stores.reduce((sum, store) => sum + store.quantity, 0);

  return (
    <div ref={containerRef} className="relative rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-800">
            Hent i butikk
          </p>
          <p className="mt-1 text-sm font-semibold text-stone-900">
            På lager i {stores.length} butikk{stores.length === 1 ? "" : "er"}
          </p>
          <p className="text-xs text-stone-500">Totalt {totalQuantity} stk tilgjengelig</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 shadow-sm transition hover:border-amber-400 hover:bg-amber-50"
          aria-expanded={open}
        >
          {open ? "Skjul butikker" : "Vis butikker"}
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 011.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {open ? (
        <div className="mt-3 space-y-3">
          {stores.length > 5 ? (
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Søk etter butikk…"
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
            />
          ) : null}

          <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {filtered.map((store) => (
              <li
                key={`${store.id}-${store.name}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-amber-600" aria-hidden>
                    <path
                      fillRule="evenodd"
                      d="M10 2a6 6 0 00-6 6c0 4.5 6 10 6 10s6-5.5 6-10a6 6 0 00-6-6zm0 8a2 2 0 110-4 2 2 0 010 4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="truncate font-medium text-stone-900">{store.name}</span>
                </span>
                <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  {store.quantity} på lager
                </span>
              </li>
            ))}

            {filtered.length === 0 ? (
              <li className="rounded-lg border border-dashed border-stone-200 bg-white px-3 py-2 text-center text-xs text-stone-500">
                Ingen butikker matcher søket.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
