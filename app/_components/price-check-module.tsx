"use client";

import type { PriceCheckResult } from "@/lib/price-check";
import { formatCurrency } from "@/lib/utils";

type PriceCheckModuleProps = {
  priceCheck: PriceCheckResult;
  id?: string;
};

export function PriceCheckModule({ priceCheck, id }: PriceCheckModuleProps) {
  return (
    <section id={id} className="panel rounded-[1.2rem] p-3.5 sm:rounded-[1.5rem] sm:p-4">
      <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-start sm:gap-3">
        <div>
          <p className="text-sm font-semibold text-stone-900">Prisduell mellom leverandører</p>
          <p className="mt-1 text-xs text-stone-500">Samme materialliste hos flere byggevarehus.</p>
        </div>
        <div className="inline-flex items-center rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-stone-700">
          Oppdatert
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
          Dekning: {priceCheck.comparedLineCount}/{priceCheck.totalLineCount} linjer ({Math.round(priceCheck.coverageRatio * 100)}%)
        </div>
        {priceCheck.quotes.map((quote, index) => (
          <div key={quote.supplierId} className="rounded-xl border border-stone-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-stone-900">{quote.supplierName}</p>
              {index === 0 ? (
                <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-stone-700">
                  Lavest
                </span>
              ) : null}
            </div>
            <p className="text-sm text-stone-600">
              {formatCurrency(quote.totalNok)} · {quote.deliveryDays} dager
            </p>
          </div>
        ))}
        <div className="rounded-xl border border-stone-200 bg-[var(--card-strong)] px-3 py-2 text-sm text-stone-700">
          Mulig å spare:
          <span className="ml-1 font-semibold text-stone-900">
            {formatCurrency(priceCheck.potentialSavingsNok)}
          </span>
        </div>
      </div>
    </section>
  );
}
