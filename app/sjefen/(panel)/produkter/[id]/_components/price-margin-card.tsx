"use client";

import { useState } from "react";

import {
  calculateProductMargin,
  marginTone,
  nokExact,
  pctNo,
  priceInclVatFromMarginPct,
  priceInclVatFromMarkupPct,
} from "@/lib/product-margin";

/**
 * Prisfeltene med levende marginregning.
 *
 * Toveis: skriver du dekningsgrad eller påslag, regnes utsalgsprisen ut; skriver
 * du utsalgspris eller innkjøpspris, regnes de to prosentene ut. Alt skjer i
 * nettleseren — først når du lagrer går tallene til serveren.
 *
 * `unit_price_nok` er en integer-kolonne, så prisen rundes til hele kroner. Den
 * faktiske dekningsgraden avviker derfor litt fra det du taster; feltet snapper
 * til det virkelige tallet når du forlater det, og panelet under viser alltid
 * fasit for prisen som faktisk blir lagret.
 */

const INPUT_CLASS =
  "mt-1 block h-9 w-full border border-stone-300 bg-white px-2.5 text-xs font-normal text-stone-900 outline-none focus:border-[#163f2a]";
const LABEL_CLASS = "block text-[9px] font-semibold uppercase tracking-[0.14em] text-stone-500";

const MARGIN_TONE: Record<ReturnType<typeof marginTone>, string> = {
  unknown: "text-stone-400",
  loss: "text-red-700",
  thin: "text-amber-700",
  ok: "text-stone-900",
};

type DerivedField = "margin" | "markup";

export function PriceMarginCard({
  unitPriceNok,
  listPriceNok,
  costPriceExVatNok,
  listPriceExVatNok,
}: {
  unitPriceNok: number;
  listPriceNok: number;
  costPriceExVatNok: number | string | null;
  listPriceExVatNok: number | string | null;
}) {
  const [unitPrice, setUnitPrice] = useState(String(unitPriceNok ?? ""));
  const [listPrice, setListPrice] = useState(String(listPriceNok ?? ""));
  const [cost, setCost] = useState(toInputValue(costPriceExVatNok));
  const [listExVat, setListExVat] = useState(toInputValue(listPriceExVatNok));
  /** Feltet brukeren skriver i nå. Ellers viser prosentfeltene den utregnede fasiten. */
  const [draft, setDraft] = useState<{ field: DerivedField; value: string } | null>(null);

  const costNumber = parseNo(cost);
  const margin = calculateProductMargin({
    unitPriceNok: parseNo(unitPrice) ?? 0,
    costPriceExVatNok: costNumber,
    listPriceExVatNok: parseNo(listExVat),
  });

  const applyPercentage = (field: DerivedField, raw: string) => {
    setDraft({ field, value: raw });

    const parsed = parseNo(raw);
    if (parsed === null || costNumber === null) return;

    const next =
      field === "margin"
        ? priceInclVatFromMarginPct(costNumber, parsed)
        : priceInclVatFromMarkupPct(costNumber, parsed);

    if (next !== null) setUnitPrice(String(next));
  };

  const percentageValue = (field: DerivedField, derived: number | null) =>
    draft?.field === field ? draft.value : formatPercentInput(derived);

  const listExVatNumber = parseNo(listExVat);
  const overListPrice =
    listExVatNumber !== null && listExVatNumber > 0 && margin.netPriceExVatNok > listExVatNumber;

  return (
    <div className="border border-stone-200 bg-white">
      <div className="border-b border-stone-200 px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-900">Pris og margin</h2>
        <p className="mt-1 text-[10px] leading-4 text-stone-500">
          Kundeprisene er inkl. mva, prisfil-tallene eks. mva. Endrer du dekningsgrad eller påslag, regnes
          utsalgsprisen om — og motsatt.
        </p>
      </div>

      <div className="space-y-4 px-5 py-5">
        <div className="grid gap-3 lg:grid-cols-4">
          <NumberField
            label="Innkjøpspris eks. mva"
            name="cost_price_ex_vat_nok"
            value={cost}
            onChange={setCost}
            step="0.01"
          />
          <NumberField
            label="Veil. pris eks. mva"
            name="list_price_ex_vat_nok"
            value={listExVat}
            onChange={setListExVat}
            step="0.01"
          />
          <NumberField
            label="Pris inkl. mva"
            name="unit_price_nok"
            value={unitPrice}
            onChange={(next) => {
              setDraft(null);
              setUnitPrice(next);
            }}
            step="1"
            required
          />
          <NumberField
            label="Listepris inkl. mva"
            name="list_price_nok"
            value={listPrice}
            onChange={setListPrice}
            step="1"
            required
          />
        </div>

        <div className="grid gap-3 border-t border-stone-100 pt-4 lg:grid-cols-4">
          <PercentField
            label="Dekningsgrad %"
            hint="av salgsprisen"
            value={percentageValue("margin", margin.marginPct)}
            onChange={(next) => applyPercentage("margin", next)}
            onBlur={() => setDraft(null)}
            disabled={costNumber === null}
          />
          <PercentField
            label="Påslag %"
            hint="av innkjøpsprisen"
            value={percentageValue("markup", margin.markupPct)}
            onChange={(next) => applyPercentage("markup", next)}
            onBlur={() => setDraft(null)}
            disabled={costNumber === null}
          />
          <Readout label="Salgspris eks. mva" value={nokExact(margin.netPriceExVatNok)} />
          <Readout
            label="Dekningsbidrag"
            value={nokExact(margin.contributionNok)}
            className={MARGIN_TONE[marginTone(margin.marginPct)]}
          />
        </div>

        <dl className="grid gap-3 border-t border-stone-100 pt-4 text-xs lg:grid-cols-3">
          <Readout label="Rabatt fra prisfil" value={pctNo(margin.discountPct)} />
          <Readout
            label="Dekningsgrad"
            value={pctNo(margin.marginPct)}
            className={MARGIN_TONE[marginTone(margin.marginPct)]}
          />
          <Readout label="Påslag" value={pctNo(margin.markupPct)} />
        </dl>

        {costNumber === null ? (
          <p className="text-[10px] leading-4 text-stone-500">
            Uten innkjøpspris kan ingen margin regnes. Den fylles inn ved neste prisimport, eller kan skrives
            inn her.
          </p>
        ) : null}

        {margin.marginPct !== null && margin.marginPct < 0 ? (
          <p className="border border-red-200 bg-red-50 px-3 py-2 text-[10px] leading-4 text-red-800">
            Prisen ligger under innkjøpsprisen — hver enhet selges med tap.
          </p>
        ) : null}

        {overListPrice ? (
          <p className="border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-4 text-amber-900">
            Salgsprisen er høyere enn leverandørens veiledende pris. Prisimporten klemmer prisen ned hit
            automatisk, men en pris du setter manuelt blir stående.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function NumberField({
  label,
  name,
  value,
  onChange,
  step,
  required,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  step: string;
  required?: boolean;
}) {
  return (
    <label className={LABEL_CLASS}>
      {label}
      <input
        name={name}
        type="number"
        min={0}
        step={step}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT_CLASS}
      />
    </label>
  );
}

/**
 * Prosentfeltene sendes ikke til serveren — de er bare en annen måte å skrive
 * utsalgsprisen på, og har derfor ingen `name`.
 */
function PercentField({
  label,
  hint,
  value,
  onChange,
  onBlur,
  disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  disabled?: boolean;
}) {
  return (
    <label className={LABEL_CLASS}>
      {label}
      <input
        type="text"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className={`${INPUT_CLASS} disabled:bg-stone-100 disabled:text-stone-400`}
      />
      <span className="mt-1 block text-[9px] font-normal normal-case tracking-normal text-stone-400">{hint}</span>
    </label>
  );
}

function Readout({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <dt className={LABEL_CLASS}>{label}</dt>
      <dd className={`mt-1 flex h-9 items-center text-xs font-semibold tabular-nums ${className ?? "text-stone-900"}`}>
        {value}
      </dd>
    </div>
  );
}

/** Godtar både «1234,50» og «1234.50» — norsk tastatur gir komma. */
function parseNo(value: string): number | null {
  const trimmed = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInputValue(value: number | string | null) {
  if (value === null || value === "") return "";
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? String(numeric) : "";
}

function formatPercentInput(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "";
  return String(Math.round(value * 10) / 10);
}
