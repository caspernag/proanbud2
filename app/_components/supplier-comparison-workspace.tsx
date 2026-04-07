"use client";

import Image from "next/image";
import { useMemo } from "react";
import { useFormStatus } from "react-dom";

import type { SupplierQuote } from "@/lib/price-check";
import { formatCurrency } from "@/lib/utils";

type SupplierComparisonWorkspaceProps = {
  projectSlug: string;
  projectTitle: string;
  quotes: SupplierQuote[];
  potentialSavingsNok: number;
  action: (formData: FormData) => Promise<void>;
};

export function SupplierComparisonWorkspace({
  projectSlug,
  projectTitle,
  quotes,
  potentialSavingsNok,
  action,
}: SupplierComparisonWorkspaceProps) {
  const cheapest = quotes[0] ?? null;
  const mostExpensive = quotes[quotes.length - 1] ?? null;

  const scoreBySupplierId = useMemo(() => {
    if (!cheapest || !mostExpensive || cheapest.totalNok === mostExpensive.totalNok) {
      return new Map(quotes.map((quote) => [quote.supplierId, 100]));
    }

    const spread = mostExpensive.totalNok - cheapest.totalNok;

    return new Map(
      quotes.map((quote) => {
        const score = 100 - Math.round(((quote.totalNok - cheapest.totalNok) / spread) * 100);
        return [quote.supplierId, Math.max(8, score)];
      }),
    );
  }, [cheapest, mostExpensive, quotes]);

  return (
    <section className="space-y-4">
      <div className="panel rounded-[1.2rem] p-4 sm:rounded-[1.4rem] sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Sammenlign priser</p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-900 sm:text-3xl">Velg leverandør for {projectTitle}</h2>
            <p className="mt-2 text-sm text-stone-600">
              {quotes.length > 1
                ? "Sammenligningen er basert på varelinjer med funn i aktive prislister hos alle leverandørene nedenfor. Når du velger leverandør, opprettes bestilling med valgt prisgrunnlag."
                : "Tilgjengelig leverandør er hentet direkte fra aktive prislister. Når du velger leverandør, opprettes bestilling og du sendes videre til bestilling."}
            </p>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
            Mulig besparelse: <span className="font-semibold text-stone-900">{formatCurrency(potentialSavingsNok)}</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-stone-500">Alle priser vises inkl. 25% mva.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {quotes.map((quote, index) => {
          const score = scoreBySupplierId.get(quote.supplierId) ?? 80;
          const delta = cheapest ? quote.totalNok - cheapest.totalNok : 0;
          const supplierLogoSrc = getSupplierLogoSrc(quote.supplierName);

          return (
            <article
              key={quote.supplierId}
              className="panel rounded-[1.1rem] p-4 sm:rounded-[1.2rem]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-md bg-white">
                    {supplierLogoSrc ? (
                      <Image
                        src={supplierLogoSrc}
                        alt={`${quote.supplierName} logo`}
                        width={100}
                        height={100}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-stone-500">Logo</span>
                    )}
                  </span>
                  <div>
                    <p className="text-lg font-semibold text-stone-900">{quote.supplierName}</p>
                    <p className="text-sm text-stone-600">Estimert levering: {quote.deliveryDays} dager</p>
                  </div>
                </div>
                {index === 0 ? (
                  <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-stone-700">
                    Anbefalt
                  </span>
                ) : null}
              </div>

              <div className="mt-3 flex items-end gap-2">
                <p className="text-2xl font-semibold text-stone-900">{formatCurrency(quote.totalNok)}</p>
                <p className="pb-1 text-sm text-stone-500 line-through">{formatCurrency(quote.listTotalNok)}</p>
              </div>

              <p className="mt-1 text-xs text-stone-500">
                {delta <= 0 ? "Laveste pris" : `${formatCurrency(delta)} over laveste pris`}
              </p>

              <div className="mt-3 h-2 w-full rounded bg-stone-100">
                <div className="h-full rounded bg-[var(--accent)]" style={{ width: `${score}%` }} />
              </div>

              <form action={action} className="mt-4">
                <input type="hidden" name="slug" value={projectSlug} />
                <input type="hidden" name="supplierKey" value={quote.supplierId} />
                <SelectSupplierButton supplierName={quote.supplierName} recommended={index === 0} />
              </form>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function getSupplierLogoSrc(supplierName: string) {
  const normalized = supplierName.toLowerCase();
  let logoName: string;

  if (normalized.includes("byggmakker")) {
    logoName = "byggmakker";
  } else if (normalized.includes("monter") || normalized.includes("optimera")) {
    logoName = "monter-optimera";
  } else if (normalized.includes("byggmax")) {
    logoName = "byggmax";
  } else if (normalized.includes("xl")) {
    logoName = "xl-bygg";
  } else {
    logoName = supplierName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[\s/]+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  if (!logoName) {
    return null;
  }

  return `/byggevarehus-logo/${logoName}.png`;
}

function SelectSupplierButton({ supplierName, recommended }: { supplierName: string; recommended: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex h-10 w-full items-center justify-center rounded-sm px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
        recommended
          ? "bg-stone-900 text-white hover:bg-stone-800"
          : "border border-stone-300 bg-white text-stone-700 hover:border-stone-900 hover:text-stone-900"
      }`}
    >
      {pending ? "Setter opp bestilling..." : `Bestill fra ${supplierName}`}
    </button>
  );
}
