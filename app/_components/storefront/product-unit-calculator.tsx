"use client";

import { useEffect, useMemo, useState } from "react";

import { formatCurrency } from "@/lib/utils";

type ProductUnitCalculatorProps = {
  unitPriceNok: number;
  priceUnit?: string;
  salesUnit?: string;
  packageAreaSqm?: number;
  onPackagesChange?: (packages: number) => void;
};

export function ProductUnitCalculator({
  unitPriceNok,
  priceUnit,
  salesUnit,
  packageAreaSqm,
  onPackagesChange,
}: ProductUnitCalculatorProps) {
  const areaPerSalesUnit = Number(packageAreaSqm ?? 0);
  const normalizedPriceUnit = normalizeUnit(priceUnit);
  const normalizedSalesUnit = normalizeUnit(salesUnit);
  const salesUnitLabel = formatUnitLabel(normalizedSalesUnit || "STK");
  const [areaInput, setAreaInput] = useState(() => formatNumberInput(areaPerSalesUnit || 1));

  const calculation = useMemo(() => {
    const requestedArea = parseNumberInput(areaInput);
    const quantity = areaPerSalesUnit > 0 ? Math.max(1, Math.ceil(requestedArea / areaPerSalesUnit)) : 1;
    const coveredArea = quantity * areaPerSalesUnit;
    const pricePerArea = areaPerSalesUnit > 0 ? unitPriceNok / areaPerSalesUnit : 0;
    const total = quantity * unitPriceNok;

    return {
      quantity,
      coveredArea,
      pricePerArea,
      total,
    };
  }, [areaInput, areaPerSalesUnit, unitPriceNok]);
  const salesUnitQuantityLabel = formatQuantityUnitLabel(normalizedSalesUnit || "STK", calculation.quantity);

  useEffect(() => {
    onPackagesChange?.(calculation.quantity);
  }, [calculation.quantity, onPackagesChange]);

  if (areaPerSalesUnit <= 0 || normalizedPriceUnit !== "M2" || normalizedSalesUnit === "M2") {
    return null;
  }

  function updateQuantity(nextQuantity: number) {
    const safeQuantity = Math.max(1, Math.min(999, Math.round(nextQuantity || 1)));
    onPackagesChange?.(safeQuantity);
    setAreaInput(formatNumberInput(safeQuantity * areaPerSalesUnit));
  }

  function updateAreaInput(nextArea: string) {
    const requestedArea = parseNumberInput(nextArea);
    const quantity = areaPerSalesUnit > 0 ? Math.max(1, Math.ceil(requestedArea / areaPerSalesUnit)) : 1;
    onPackagesChange?.(quantity);
    setAreaInput(nextArea);
  }

  return (
    <div className="mt-4 rounded-md border border-stone-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Metric label="Per m²" value={formatCurrency(calculation.pricePerArea)} />
        <Metric label={`Per ${salesUnitLabel}`} value={formatCurrency(unitPriceNok)} />
        <Metric label="Innhold" value={`${formatDecimal(areaPerSalesUnit)} m² / ${salesUnitLabel}`} />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">M² du trenger</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={areaInput}
            onChange={(event) => updateAreaInput(event.target.value)}
            className="mt-1 h-10 w-full rounded-sm border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900 outline-none focus:border-[#15452d]"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Antall {salesUnitLabel}</span>
          <input
            type="number"
            min="1"
            step="1"
            value={calculation.quantity}
            onChange={(event) => updateQuantity(Number(event.target.value))}
            className="mt-1 h-10 w-full rounded-sm border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900 outline-none focus:border-[#15452d]"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 pt-3 text-sm">
        <span className="font-medium text-stone-700">
          {calculation.quantity} {salesUnitQuantityLabel} dekker {formatDecimal(calculation.coveredArea)} m²
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

function formatUnitLabel(unit: string) {
  switch (normalizeUnit(unit)) {
    case "M2":
      return "m²";
    case "STK":
      return "stk";
    case "PAK":
      return "pakke";
    case "POS":
      return "pose";
    default:
      return unit.toLowerCase();
  }
}

function formatQuantityUnitLabel(unit: string, quantity: number) {
  switch (normalizeUnit(unit)) {
    case "PAK":
      return quantity === 1 ? "pakke" : "pakker";
    case "POS":
      return quantity === 1 ? "pose" : "poser";
    default:
      return formatUnitLabel(unit);
  }
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