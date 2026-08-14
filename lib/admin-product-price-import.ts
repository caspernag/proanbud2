import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { parsePriceListProductsFromVectorFile } from "@/lib/price-lists";
import { getSupplierMarkups } from "@/lib/price-markup";
import { buildStorefrontSearchText, calculateStorefrontDisplayPrices } from "@/lib/storefront";
import {
  STOREFRONT_CATALOG_META_TABLE,
  STOREFRONT_PRODUCTS_TABLE,
} from "@/lib/storefront-catalog-db";
import { slugify } from "@/lib/utils";

const IMPORT_CHUNK_SIZE = 500;

type ExistingProductRow = {
  id: string;
  nobb_number: string;
};

type CatalogMetaRow = {
  category: string | null;
  supplier_name: string | null;
  unit_price_nok: number | null;
};

export type PriceImportResult = {
  parsed: number;
  existingUpdated: number;
  inserted: number;
  updated: number;
  deletedStale: number;
};

export async function importByggmakkerPriceFile(
  db: SupabaseClient,
  input: { fileName: string; content: string; deleteStale?: boolean },
): Promise<PriceImportResult> {
  const parsedProducts = parsePriceListProductsFromVectorFile(
    input.content,
    input.fileName || "byggmakker.csv",
  ).filter((product) => product.nobbNumber.replace(/\D/g, "").length >= 6);

  if (parsedProducts.length === 0) {
    return { parsed: 0, existingUpdated: 0, inserted: 0, updated: 0, deletedStale: 0 };
  }

  const bestByNobb = new Map<string, (typeof parsedProducts)[number]>();
  for (const product of parsedProducts) {
    const nobb = product.nobbNumber.replace(/\D/g, "");
    const existing = bestByNobb.get(nobb);
    if (!existing || product.priceNok < existing.priceNok) {
      bestByNobb.set(nobb, product);
    }
  }

  const existingByNobb = await loadExistingProductsByNobb(db, [...bestByNobb.keys()]);
  const markups = await getSupplierMarkups();
  const updatedAt = new Date().toISOString();
  const lastUpdated = updatedAt.slice(0, 10);

  const rows = [...bestByNobb.entries()]
    .map(([nobb, product]) => {
      const existing = existingByNobb.get(nobb);

      const prices = calculateStorefrontDisplayPrices(
        {
          unitPriceNok: product.priceNok,
          listPriceNok: product.listPriceNok,
          supplierName: "Byggmakker",
        },
        markups,
      );

      const productName = product.productName.trim();
      const supplierName = "Byggmakker";
      const brand = product.brand.trim();
      const category = product.category.trim() || "Diverse";
      const sectionTitle = product.sectionTitle.trim() || "Byggevarer";
      const description = product.description.trim() || productName;
      const technicalDetails = product.technicalDetails ?? [];

      return {
        id: existing?.id ?? `byggmakker-${nobb}`,
        slug: existing ? undefined : slugify(`${productName}-${supplierName}-${nobb}`),
        nobb_number: nobb,
        product_name: productName,
        supplier_name: supplierName,
        brand,
        unit_price_nok: Math.max(0, Math.round(prices.unitPriceNok)),
        list_price_nok: Math.max(0, Math.round(prices.listPriceNok)),
        unit: product.unit || product.salesUnit || "STK",
        price_unit: product.priceUnit || null,
        sales_unit: product.salesUnit || null,
        sales_unit_quantity: product.salesUnitQuantity ?? null,
        package_area_sqm: product.packageAreaSqm ?? null,
        section_title: sectionTitle,
        category,
        description,
        ean: product.ean ?? null,
        datasheet_url: product.datasheetUrl ?? null,
        image_url: product.imageUrl ?? null,
        technical_details: technicalDetails,
        quantity_suggestion: product.quantitySuggestion || "1 stk",
        quantity_reason: product.quantityReason || "",
        last_updated: lastUpdated,
        source: "byggmakker_price_import",
        popularity_score: 0,
        search_text: buildStorefrontSearchText({
          category,
          sectionTitle,
          productName,
          brand,
          description,
          technicalDetails,
        }),
        updated_at: updatedAt,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  let updated = 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += IMPORT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + IMPORT_CHUNK_SIZE);
    const { error } = await db.from(STOREFRONT_PRODUCTS_TABLE).upsert(chunk, { onConflict: "id" });
    if (error) {
      throw new Error(`Prisoppdatering feilet ved rad ${i + 1}: ${error.message}`);
    }
    updated += chunk.length;
    inserted += chunk.filter((row) => !existingByNobb.has(row.nobb_number)).length;
  }

  const deletedStale = input.deleteStale ? await deleteStaleByggmakkerProducts(db, new Set(bestByNobb.keys())) : 0;

  await refreshCatalogMetaFromDb(db);

  return {
    parsed: parsedProducts.length,
    existingUpdated: rows.length - inserted,
    inserted,
    updated,
    deletedStale,
  };
}

async function loadExistingProductsByNobb(db: SupabaseClient, nobbNumbers: string[]) {
  const byNobb = new Map<string, ExistingProductRow>();

  for (let i = 0; i < nobbNumbers.length; i += IMPORT_CHUNK_SIZE) {
    const chunk = nobbNumbers.slice(i, i + IMPORT_CHUNK_SIZE);
    const { data, error } = await db
      .from(STOREFRONT_PRODUCTS_TABLE)
      .select("id, nobb_number")
      .in("nobb_number", chunk);

    if (error) {
      throw new Error(`Kunne ikke lese eksisterende produkter: ${error.message}`);
    }

    for (const row of (data ?? []) as ExistingProductRow[]) {
      const nobb = row.nobb_number.replace(/\D/g, "");
      if (nobb) byNobb.set(nobb, row);
    }
  }

  return byNobb;
}

async function deleteStaleByggmakkerProducts(db: SupabaseClient, activeNobbs: Set<string>) {
  let deleted = 0;
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from(STOREFRONT_PRODUCTS_TABLE)
      .select("id, nobb_number")
      .ilike("supplier_name", "%byggmakker%")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Kunne ikke lese gamle Byggmakker-produkter før sletting: ${error.message}`);
    }

    const batch = (data ?? []) as ExistingProductRow[];
    const staleIds = batch
      .filter((row) => !activeNobbs.has(row.nobb_number.replace(/\D/g, "")))
      .map((row) => row.id);

    for (let i = 0; i < staleIds.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = staleIds.slice(i, i + IMPORT_CHUNK_SIZE);
      const { error: deleteError, count } = await db
        .from(STOREFRONT_PRODUCTS_TABLE)
        .delete({ count: "exact" })
        .in("id", chunk);

      if (deleteError) {
        throw new Error(`Kunne ikke slette gamle produkter: ${deleteError.message}`);
      }

      deleted += count ?? chunk.length;
    }

    if (batch.length < pageSize) break;
  }

  return deleted;
}

async function refreshCatalogMetaFromDb(db: SupabaseClient) {
  const rows: CatalogMetaRow[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from(STOREFRONT_PRODUCTS_TABLE)
      .select("category, supplier_name, unit_price_nok")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Prisene ble lagret, men metadata kunne ikke oppdateres: ${error.message}`);
    }

    const batch = (data ?? []) as CatalogMetaRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  const categories = new Set<string>();
  const suppliers = new Set<string>();
  const categoryCounts: Record<string, number> = {};
  const supplierCounts: Record<string, number> = {};
  let priceMin = Number.POSITIVE_INFINITY;
  let priceMax = 0;

  for (const row of rows) {
    const category = row.category?.trim();
    const supplier = row.supplier_name?.trim();
    const price = row.unit_price_nok ?? 0;

    if (category) {
      categories.add(category);
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    }
    if (supplier) {
      suppliers.add(supplier);
      supplierCounts[supplier] = (supplierCounts[supplier] ?? 0) + 1;
    }
    if (price > 0) {
      priceMin = Math.min(priceMin, price);
      priceMax = Math.max(priceMax, price);
    }
  }

  const refreshedAt = new Date().toISOString();
  const { error } = await db.from(STOREFRONT_CATALOG_META_TABLE).upsert(
    {
      id: 1,
      categories: [...categories].sort((a, b) => a.localeCompare(b, "nb-NO")),
      suppliers: [...suppliers].sort((a, b) => a.localeCompare(b, "nb-NO")),
      category_counts: categoryCounts,
      supplier_counts: supplierCounts,
      price_min: Number.isFinite(priceMin) ? Math.floor(priceMin) : 0,
      price_max: Math.ceil(priceMax),
      product_count: rows.length,
      refreshed_at: refreshedAt,
    },
    { onConflict: "id" },
  );

  if (error) {
    throw new Error(`Prisene ble lagret, men katalogmetadata kunne ikke oppdateres: ${error.message}`);
  }
}
