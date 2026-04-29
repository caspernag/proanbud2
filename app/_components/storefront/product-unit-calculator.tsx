"use client";

import { useMemo, useState } from "react";

import { formatCurrency } from "@/lib/utils";

type ProductUnitCalculatorProps = {
  unitPriceNok: number;
  priceUnit?: string;
  salesUnit?: string;
  packageAreaSqm?: number;
};

export function ProductUnitCalculator({
  unitPriceNok,
  priceUnit,
  salesUnit,
  packageAreaSqm,
}: ProductUnitCalculatorProps) {
  const areaPerPackage = Number(packageAreaSqm ?? 0);
  const normalizedPriceUnit = normalizeUnit(priceUnit);
  const normalizedSalesUnit = normalizeUnit(salesUnit);
  const [areaInput, setAreaInput] = useState(() => formatNumberInput(areaPerPackage || 1));

  const calculation = useMemo(() => {
    const requestedArea = parseNumberInput(areaInput);
    const packages = areaPerPackage > 0 ? Math.max(1, Math.ceil(requestedArea / areaPerPackage)) : 1;
    const coveredArea = packages * areaPerPackage;
    const packagePrice = areaPerPackage * unitPriceNok;
    const total = coveredArea * unitPriceNok;

    return {
      packages,
      coveredArea,
      packagePrice,
      total,
    };
  }, [areaInput, areaPerPackage, unitPriceNok]);

  if (areaPerPackage <= 0 || normalizedPriceUnit !== "M2" || normalizedSalesUnit !== "PAK") {
    return null;
  }

  function updatePackages(nextPackages: number) {
    const safePackages = Math.max(1, Math.min(999, Math.round(nextPackages || 1)));
    setAreaInput(formatNumberInput(safePackages * areaPerPackage));
  }

  return (
    <div className="mt-4 rounded-md border border-stone-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Metric label="Per m²" value={formatCurrency(unitPriceNok)} />
        <Metric label="Per pakke" value={formatCurrency(calculation.packagePrice)} />
        <Metric label="Pakningsinnhold" value={`${formatDecimal(areaPerPackage)} m²`} />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">M² du trenger</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={areaInput}
            onChange={(event) => setAreaInput(event.target.value)}
            className="mt-1 h-10 w-full rounded-sm border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900 outline-none focus:border-[#15452d]"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Pakker</span>
          <input
            type="number"
            min="1"
            step="1"
            value={calculation.packages}
            onChange={(event) => updatePackages(Number(event.target.value))}
            className="mt-1 h-10 w-full rounded-sm border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900 outline-none focus:border-[#15452d]"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 pt-3 text-sm">
        <span className="font-medium text-stone-700">
          {calculation.packages} {calculation.packages === 1 ? "pakke" : "pakker"} dekker {formatDecimal(calculation.coveredArea)} m²
        </span>
        <span className="font-semibold text-stone-900">Ca. {formatCurrency(calculation.total)}</span>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm bg-stone-50 px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-stone-900">{value}</p>
    </div>
  );
}

function normalizeUnit(value: string | undefined) {
  return (value ?? "").trim().toUpperCase().replace("M²", "M2");
}

function parseNumberInput(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatNumberInput(value: number) {
  return value.toFixed(2).replace(/\.00$/, "");
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(value);
}