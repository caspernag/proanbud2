"use client";

import { useState } from "react";

import type { ByggmakkerStoreStock } from "@/lib/byggmakker-availability";

type StorePickupDropdownProps = {
  stores: ByggmakkerStoreStock[];
};

export function StorePickupDropdown({ stores }: StorePickupDropdownProps) {
  const [open, setOpen] = useState(false);

  if (stores.length === 0) return null;

  return (
    <div className="rounded-md border border-stone-200 bg-white text-xs font-medium">
      {/* Status row */}
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="space-y-0.5">
          <span className="flex items-center gap-1.5 text-amber-700">
            <span className="inline-flex h-2 w-2 rounded-full bg-amber-500" />
            På lager i {stores.length} byggevarehus
          </span>
          <p className="text-stone-500">Levering bekreftes fra byggevarehus</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100"
          aria-expanded={open}
        >
          {open ? "Skjul" : "Vis butikker"}
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
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

      {/* Expandable store list */}
      {open ? (
        <ul className="space-y-1.5 border-t border-stone-100 px-3 pb-3 pt-2">
          {stores.map((store) => (
            <li
              key={`${store.id}-${store.name}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm"
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
        </ul>
      ) : null}
    </div>
  );
}
