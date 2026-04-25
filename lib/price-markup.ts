import { createClient } from "@supabase/supabase-js";

import { cacheLife } from "next/cache";

import { env, hasSupabaseEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type SupplierKey = "byggmakker" | "monter_optimera" | "byggmax" | "xl_bygg";

export type SupplierMarkup = {
  supplier_name: string;
  markup_percentage: number;
  markup_fixed: number;
};

export async function getSupplierMarkups(): Promise<SupplierMarkup[]> {
  "use cache";
  cacheLife("minutes");

  try {
    const adminClient = createSupabaseAdminClient();
    const supabase =
      adminClient ??
      (hasSupabaseEnv()
        ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
            },
          })
        : null);

    if (!supabase) {
      return [];
    }

    const { data, error } = await supabase.from("supplier_markups").select("supplier_name, markup_percentage, markup_fixed");

    if (error) {
      console.error("Error fetching markups:", error);
      return [];
    }

    return (data ?? []).map((row) => ({
      supplier_name: String(row.supplier_name ?? "").trim(),
      markup_percentage: toFiniteNumber(row.markup_percentage),
      markup_fixed: toFiniteNumber(row.markup_fixed),
    }));
  } catch (error) {
    console.error("Failed to get markups", error);
    return [];
  }
}

export function applyMarkup(
  price: number,
  supplierName: string,
  markups: SupplierMarkup[],
  options?: { maxPrice?: number | null },
): number {
  if (!price || price <= 0) return price;

  const inferredSupplierKey = inferSupplierKeyFromName(supplierName);
  if (inferredSupplierKey) {
    return applyMarkupForSupplierKey(price, inferredSupplierKey, markups, options);
  }

  const normalizedSupplierName = normalizeName(supplierName);
  const markup = markups.find((row) => {
    const rowName = normalizeName(row.supplier_name);
    return normalizedSupplierName.includes(rowName) || rowName.includes(normalizedSupplierName);
  });

  if (!markup) {
    return capToMaxPrice(price, options?.maxPrice);
  }

  return applyMarkupFormula(price, markup, options?.maxPrice);
}

export function applyMarkupForSupplierKey(
  price: number,
  supplierKey: SupplierKey,
  markups: SupplierMarkup[],
  options?: { maxPrice?: number | null },
) {
  if (!price || price <= 0) {
    return price;
  }

  const markup = markups.find((row) => matchesSupplierKey(row.supplier_name, supplierKey));
  if (!markup) {
    return capToMaxPrice(price, options?.maxPrice);
  }

  return applyMarkupFormula(price, markup, options?.maxPrice);
}

function matchesSupplierKey(supplierName: string, supplierKey: SupplierKey) {
  const normalized = normalizeName(supplierName);
  const inferred = inferSupplierKeyFromName(normalized);

  if (inferred === supplierKey) {
    return true;
  }

  return SUPPLIER_KEY_ALIASES[supplierKey].some((alias) => normalized.includes(alias));
}

function applyMarkupFormula(price: number, markup: SupplierMarkup, maxPrice?: number | null) {
  const percentageIncrement = price * (markup.markup_percentage / 100);
  const markedPrice = Math.max(0, price + percentageIncrement + markup.markup_fixed);
  return capToMaxPrice(markedPrice, maxPrice);
}

function capToMaxPrice(price: number, maxPrice?: number | null) {
  if (typeof maxPrice !== "number" || !Number.isFinite(maxPrice) || maxPrice <= 0) {
    return price;
  }

  return Math.min(price, maxPrice);
}

function inferSupplierKeyFromName(value: string): SupplierKey | null {
  const normalized = normalizeName(value);

  if (normalized.includes("byggmakker")) {
    return "byggmakker";
  }

  if (normalized.includes("monter") || normalized.includes("optimera")) {
    return "monter_optimera";
  }

  if (normalized.includes("byggmax")) {
    return "byggmax";
  }

  if (normalized.includes("xl") || normalized.includes("xlbygg") || normalized.includes("xl-bygg")) {
    return "xl_bygg";
  }

  return null;
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function toFiniteNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

const SUPPLIER_KEY_ALIASES: Record<SupplierKey, string[]> = {
  byggmakker: ["byggmakker"],
  monter_optimera: ["monter", "optimera", "monter/optimera"],
  byggmax: ["byggmax"],
  xl_bygg: ["xl", "xl-bygg", "xl bygg", "xlbygg"],
};
