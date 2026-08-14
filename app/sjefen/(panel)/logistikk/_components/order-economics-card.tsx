import {
  STRIPE_FIXED_FEE_NOK,
  STRIPE_PERCENT_FEE,
  type OrderEconomics,
} from "@/lib/order-economics";

import { ActionForm, SubmitButton } from "@/app/sjefen/_components/action-form";

import { saveOrderCostsAction } from "../actions";

function kr(value: number) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function pct(value: number | null) {
  return value == null ? "—" : `${value.toFixed(1)} %`;
}

/**
 * Dekningsbidrag for én ordre. Alt regnes eks. mva: kundeprisene er lagret
 * inkl. mva, prislisten fra Byggmakker er eks. mva, og mva er gjennomstrømning
 * begge veier.
 */
export function OrderEconomicsCard({
  orderId,
  economics,
  goodsCostNok,
  freightCostNok,
  otherCostNok,
  costNote,
}: {
  orderId: string;
  economics: OrderEconomics;
  goodsCostNok: number | null;
  freightCostNok: number | null;
  otherCostNok: number | null;
  costNote: string;
}) {
  const positive = economics.contributionNok >= 0;

  return (
    <section className="border border-stone-200 bg-white shadow-[0_8px_24px_rgba(32,25,15,0.06)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-stone-900">Lønnsomhet</h2>
          <p className="mt-0.5 text-xs text-stone-500">Dekningsbidrag eks. mva</p>
        </div>
        <span
          className={`px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
            positive
              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
              : "bg-red-50 text-red-800 ring-red-200"
          }`}
        >
          {kr(economics.contributionNok)} · {pct(economics.contributionPct)}
        </span>
      </header>

      {!economics.complete ? (
        <p className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-900">
          Ufullstendig grunnlag:{" "}
          {economics.linesWithKnownCost < economics.totalLines
            ? `${economics.totalLines - economics.linesWithKnownCost} av ${economics.totalLines} varelinjer mangler innkjøpspris. `
            : ""}
          {!economics.freightCostRegistered ? "Faktisk fraktkostnad er ikke registrert. " : ""}
          {!economics.goodsCostFromInvoice ? "Varekosten er hentet fra prislisten, ikke fra leverandørfaktura. " : ""}
          Tallet er derfor et estimat.
        </p>
      ) : null}

      <div className="px-5 py-4">
        <dl className="space-y-1.5 text-sm">
          <Row label="Fakturert kunde (inkl. mva)" value={kr(economics.grossRevenueNok)} muted />
          <Row label="− Utgående mva" value={`−${kr(economics.outgoingVatNok)}`} muted />
          <Row label="Netto salgsinntekt" value={kr(economics.netRevenueNok)} strong />

          <div className="pt-2" />

          <Row
            label={
              economics.goodsCostFromInvoice
                ? "− Varekost (fra leverandørfaktura)"
                : `− Varekost (prisliste, ${economics.linesWithKnownCost}/${economics.totalLines} linjer)`
            }
            value={`−${kr(economics.goodsCostNok)}`}
          />
          <Row
            label="− Frakt, faktisk kostnad"
            value={economics.freightCostRegistered ? `−${kr(economics.freightCostNok)}` : "ikke registrert"}
            warn={!economics.freightCostRegistered}
          />
          {economics.otherCostNok > 0 ? (
            <Row label="− Andre kostnader" value={`−${kr(economics.otherCostNok)}`} />
          ) : null}
          <Row
            label={`− Betalingsgebyr (${(STRIPE_PERCENT_FEE * 100).toFixed(1)} % + ${STRIPE_FIXED_FEE_NOK} kr)`}
            value={`−${kr(economics.paymentFeeNok)}`}
          />

          <div className="mt-2 flex items-baseline justify-between border-t border-stone-200 pt-2.5">
            <dt className="text-sm font-semibold text-stone-900">Dekningsbidrag</dt>
            <dd
              className={`text-lg font-semibold tabular-nums ${positive ? "text-emerald-800" : "text-red-800"}`}
            >
              {kr(economics.contributionNok)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-xs text-stone-500">Dekningsgrad av netto salgsinntekt</dt>
            <dd className="text-xs font-semibold tabular-nums text-stone-700">
              {pct(economics.contributionPct)}
            </dd>
          </div>
        </dl>

        {/* Per varelinje */}
        {economics.lines.length > 0 ? (
          <div className="mt-4 border-t border-stone-100 pt-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              Per varelinje
            </p>
            <div className="space-y-1.5">
              {economics.lines.map((line) => (
                <div key={line.id} className="flex flex-wrap items-baseline gap-x-3 text-xs">
                  <span className="min-w-0 flex-1 truncate text-stone-700">{line.productName}</span>
                  <span className="tabular-nums text-stone-500">
                    {line.quantity} {line.unit}
                  </span>
                  {line.costKnown ? (
                    <>
                      <span className="tabular-nums text-stone-500">{kr(line.netRevenueNok)} netto</span>
                      <span
                        className={`w-20 text-right font-semibold tabular-nums ${
                          line.contributionNok >= 0 ? "text-emerald-700" : "text-red-700"
                        }`}
                      >
                        {kr(line.contributionNok)}
                      </span>
                      <span className="w-14 text-right tabular-nums text-stone-500">{pct(line.marginPct)}</span>
                    </>
                  ) : (
                    <span className="text-amber-700">innkjøpspris ukjent</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Registrering av faktiske kostnader */}
        <ActionForm action={saveOrderCostsAction} className="mt-4 border-t border-stone-100 pt-4">
          <input type="hidden" name="orderId" value={orderId} />
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
            Registrer faktiske kostnader (eks. mva)
          </p>
          <p className="mb-2 text-[11px] leading-relaxed text-stone-500">
            Varekost overstyrer prislisten. Bruk den når leverandørfakturaen foreligger, så
            dekningsbidraget bygger på det du faktisk betalte og ikke på et prisliste-øyeblikksbilde.
          </p>

          <div className="flex flex-wrap gap-3">
            <label className="text-xs font-semibold text-stone-600">
              Varekost
              <input
                name="goodsCostNok"
                inputMode="decimal"
                placeholder="fra prisliste"
                defaultValue={goodsCostNok ?? ""}
                className="mt-1 block h-9 w-32 border border-stone-300 px-2.5 text-sm font-normal tabular-nums outline-none focus:border-[#163f2a]"
              />
            </label>
            <label className="text-xs font-semibold text-stone-600">
              Fraktkostnad
              <input
                name="freightCostNok"
                inputMode="decimal"
                placeholder="ikke registrert"
                defaultValue={freightCostNok ?? ""}
                className="mt-1 block h-9 w-32 border border-stone-300 px-2.5 text-sm font-normal tabular-nums outline-none focus:border-[#163f2a]"
              />
            </label>
            <label className="text-xs font-semibold text-stone-600">
              Andre kostnader
              <input
                name="otherCostNok"
                inputMode="decimal"
                placeholder="0"
                defaultValue={otherCostNok ?? ""}
                className="mt-1 block h-9 w-32 border border-stone-300 px-2.5 text-sm font-normal tabular-nums outline-none focus:border-[#163f2a]"
              />
            </label>
          </div>

          <textarea
            name="costNote"
            rows={2}
            defaultValue={costNote}
            placeholder="Notat om kostnadene, f.eks. fakturanummer fra transportør"
            className="mt-2 w-full border border-stone-300 px-3 py-2 text-sm outline-none focus:border-[#163f2a]"
          />

          <SubmitButton
            pendingLabel="Lagrer …"
            className="mt-2 inline-flex h-9 items-center border border-stone-300 px-4 text-xs font-semibold text-stone-800 transition hover:border-stone-900"
          >
            Lagre kostnader
          </SubmitButton>
        </ActionForm>
      </div>
    </section>
  );
}

function Row({
  label,
  value,
  strong = false,
  muted = false,
  warn = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={`text-xs ${muted ? "text-stone-500" : strong ? "font-semibold text-stone-900" : "text-stone-600"}`}>
        {label}
      </dt>
      <dd
        className={`tabular-nums ${
          warn
            ? "text-xs text-amber-700"
            : strong
              ? "text-sm font-semibold text-stone-900"
              : "text-xs text-stone-700"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
