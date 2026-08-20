"use client";

import Link from "next/link";
import { useState } from "react";

import { trafficWindowLabel, type PopularProductsWindow, type TrafficWindowDays } from "@/lib/web-traffic";

import { num } from "../../../_components/ui";

/**
 * Topplista over produktsider, med 24 timer / 7 dager / 30 dager i faner.
 *
 * Alle tre vinduene hentes på serveren og sendes med — bytte av fane skal ikke
 * koste et nytt kall til Vercel, og hoppingen mellom dem er hele poenget med
 * kortet: en vare som er stor i dag, men fraværende over 30 dager, er en helt
 * annen historie enn en som ligger høyt begge steder.
 */
export function PopularProductsTabs({ windows }: { windows: PopularProductsWindow[] }) {
  const [selected, setSelected] = useState<TrafficWindowDays>(windows[0]?.days ?? 1);
  const active = windows.find((window) => window.days === selected) ?? windows[0];

  return (
    <div>
      <div className="flex gap-1 border-b border-stone-200">
        {windows.map((window) => {
          const isActive = window.days === selected;
          return (
            <button
              key={window.days}
              type="button"
              onClick={() => setSelected(window.days)}
              aria-pressed={isActive}
              className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold transition ${
                isActive
                  ? "border-[#163f2a] text-[#163f2a]"
                  : "border-transparent text-stone-500 hover:text-stone-800"
              }`}
            >
              {trafficWindowLabel(window.days)}
            </button>
          );
        })}
      </div>

      {active && active.products.length > 0 ? (
        <ol className="mt-1 divide-y divide-stone-100">
          {active.products.map((product, index) => (
            <li key={product.slug} className="flex items-center gap-3 py-2.5">
              <span className="w-4 shrink-0 text-right text-xs font-semibold tabular-nums text-stone-400">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                {product.productId ? (
                  <Link
                    href={`/sjefen/produkter/${encodeURIComponent(product.productId)}`}
                    className="block truncate text-xs font-semibold text-stone-900 hover:text-[#163f2a] hover:underline"
                  >
                    {product.productName}
                  </Link>
                ) : (
                  <p className="truncate text-xs font-semibold text-stone-900">{product.productName}</p>
                )}
                <p className="truncate font-mono text-[11px] text-stone-400">/{product.slug}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums text-stone-900">{num(product.visitors)}</p>
                <p className="text-[11px] text-stone-500">{num(product.pageviews)} visninger</p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 border border-dashed border-stone-200 px-4 py-10 text-center text-sm text-stone-400">
          Ingen produktvisninger registrert siste {active ? trafficWindowLabel(active.days).toLowerCase() : "periode"}.
        </p>
      )}
    </div>
  );
}
