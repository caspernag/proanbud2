export type ProductUnitPricingInput = {
  priceUnit?: string;
  salesUnit?: string;
  salesUnitQuantity?: number;
};

const UNIT_ALIASES: Record<string, string[]> = {
  PAK: ["PAK", "PK", "PAKKE"],
  POS: ["POS", "POSE"],
  STK: ["STK"],
  M2: ["M2", "M²"],
  M: ["M", "LM"],
};

export function normalizeProductUnit(value: string | undefined, fallback = "STK") {
  const normalized = (value ?? fallback).trim().toUpperCase().replace("M²", "M2");
  return normalized || fallback;
}

export function parseSalesUnitQuantity(
  description: string,
  priceUnit: string,
  salesUnit: string,
  fallbackRaw?: string,
) {
  const normalizedPriceUnit = normalizeProductUnit(priceUnit);
  const normalizedSalesUnit = normalizeProductUnit(salesUnit, normalizedPriceUnit);
  const fromDescription = parseQuantityFromDescription(description, normalizedPriceUnit, normalizedSalesUnit);

  if (fromDescription !== undefined) {
    return fromDescription;
  }

  return parsePositiveNumber(fallbackRaw);
}

export function priceForSalesUnit(priceNok: number, input: ProductUnitPricingInput) {
  if (!Number.isFinite(priceNok) || priceNok <= 0) {
    return 0;
  }

  const priceUnit = normalizeProductUnit(input.priceUnit);
  const salesUnit = normalizeProductUnit(input.salesUnit, priceUnit);
  const quantity = input.salesUnitQuantity;

  if (priceUnit === salesUnit || !quantity || quantity <= 0) {
    return priceNok;
  }

  return priceNok * quantity;
}

export function orderLineUnit(input: ProductUnitPricingInput & { fallbackUnit?: string }) {
  return normalizeProductUnit(input.salesUnit, normalizeProductUnit(input.fallbackUnit ?? input.priceUnit));
}

export function describeSalesUnitQuantity(input: ProductUnitPricingInput) {
  const priceUnit = normalizeProductUnit(input.priceUnit);
  const salesUnit = normalizeProductUnit(input.salesUnit, priceUnit);
  const quantity = input.salesUnitQuantity;

  if (!quantity || quantity <= 0 || priceUnit === salesUnit) {
    return "";
  }

  if (priceUnit === "M2") {
    return `Pakningsinnhold: ${formatDecimalNo(quantity)} m²`;
  }

  return `Innhold: ${formatDecimalNo(quantity)} ${priceUnit} per ${salesUnit}`;
}

function parseQuantityFromDescription(description: string, priceUnit: string, salesUnit: string) {
  const normalized = description.replace(/m²/gi, "M2");
  const priceAliases = unitAliases(priceUnit).join("|");
  const salesAliases = unitAliases(salesUnit).join("|");
  const pattern = new RegExp(
    String.raw`(\d+(?:[,.]\d+)?)\s*(?:${priceAliases})\s*(?:(?:\/|\s+PR\.?|\s+PER)\s*)?(?:${salesAliases})\b`,
    "i",
  );
  const match = normalized.match(pattern);

  return match ? parsePositiveNumber(match[1]) : undefined;
}

function unitAliases(unit: string) {
  const aliases = UNIT_ALIASES[unit] ?? [unit];
  return aliases.map((alias) => escapeRegExp(alias));
}

function parsePositiveNumber(raw: string | undefined) {
  const normalized = (raw ?? "").trim().replace(/\s+/g, "").replace(",", ".");
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDecimalNo(value: number) {
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(value);
}