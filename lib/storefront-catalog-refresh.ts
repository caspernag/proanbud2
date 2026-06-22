import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  STOREFRONT_BROAD_CATEGORY_FILTERS,
  buildStorefrontCatalogFromVectorStore,
  buildStorefrontSearchText,
  matchesStorefrontCategory,
  popularityScore,
} from "@/lib/storefront";
import {
  STOREFRONT_CATALOG_META_TABLE,
  STOREFRONT_PRODUCTS_TABLE,
} from "@/lib/storefront-catalog-db";
import type { StorefrontProduct } from "@/lib/storefront-types";

const UPSERT_CHUNK_SIZE = 500;
const NOBB_IMAGE_PAGE_SIZE = 1000;

export type CatalogRefreshResult = {
  ok: boolean;
  productCount: number;
  source: string;
  deletedStale: number;
  durationMs: number;
  error?: string;
};

/**
 * Projects the OpenAI vector-store catalog into the `storefront_products`
 * Postgres snapshot (+ precomputed facets in `storefront_catalog_meta`).
 *
 * This runs the EXPENSIVE vector-store parse exactly once per invocation and is
 * intended to be called from a scheduled job — never the request path.
 */
export async function refreshStorefrontCatalog(): Promise<CatalogRefreshResult> {
  const startedAt = Date.now();
  const batchIso = new Date().toISOString();

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return fail(startedAt, "none", "Supabase service-role env mangler (SUPABASE_SERVICE_ROLE_KEY).");
  }

  // 1. Build the merged, marked-up, blacklisted catalog from the vector store.
  const { products, source } = await buildStorefrontCatalogFromVectorStore();

  if (products.length === 0) {
    // Refuse to wipe the live snapshot when the upstream parse yields nothing.
    return fail(startedAt, source, "Tom katalog fra vector store — avbryter for å ikke tømme tabellen.");
  }

  // 2. Denormalize cached image paths from nobb_images.
  const imagePathByNobb = await loadImagePathByNobb(admin);

  // 3. Dedupe defensively (id is PK, slug is unique) and map to rows.
  const deduped = dedupeProducts(products);
  const rows = deduped.map((product) =>
    productToRow(product, imagePathByNobb.get(product.nobbNumber) ?? null, batchIso),
  );

  // 4. Upsert in chunks.
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
    const { error } = await admin.from(STOREFRONT_PRODUCTS_TABLE).upsert(chunk, { onConflict: "id" });
    if (error) {
      return fail(startedAt, source, `Upsert feilet (rad ${i}): ${error.message}`);
    }
  }

  // 5. Delete rows not touched in this batch (stale products removed upstream).
  const { error: deleteError, count: deletedStale } = await admin
    .from(STOREFRONT_PRODUCTS_TABLE)
    .delete({ count: "exact" })
    .lt("updated_at", batchIso);
  if (deleteError) {
    console.warn("[catalog-refresh] kunne ikke slette stale rader:", deleteError.message);
  }

  // 6. Precompute + persist facets.
  await writeCatalogMeta(admin, deduped, batchIso);

  return {
    ok: true,
    productCount: deduped.length,
    source,
    deletedStale: deletedStale ?? 0,
    durationMs: Date.now() - startedAt,
  };
}

function dedupeProducts(products: StorefrontProduct[]): StorefrontProduct[] {
  const byId = new Map<string, StorefrontProduct>();
  const seenSlugs = new Set<string>();

  for (const product of products) {
    if (byId.has(product.id)) {
      byId.set(product.id, product);
      continue;
    }
    if (seenSlugs.has(product.slug)) {
      // Extremely rare slug collision across distinct ids — skip to protect the
      // unique(slug) constraint rather than fail the whole batch.
      continue;
    }
    byId.set(product.id, product);
    seenSlugs.add(product.slug);
  }

  return Array.from(byId.values());
}

async function loadImagePathByNobb(admin: SupabaseClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (let from = 0; ; from += NOBB_IMAGE_PAGE_SIZE) {
    const { data, error } = await admin
      .from("nobb_images")
      .select("nobb_number, storage_path")
      .not("storage_path", "is", null)
      .range(from, from + NOBB_IMAGE_PAGE_SIZE - 1);

    if (error) {
      console.warn("[catalog-refresh] kunne ikke lese nobb_images:", error.message);
      break;
    }
    if (!data || data.length === 0) {
      break;
    }

    for (const row of data) {
      const nobb = String(row.nobb_number ?? "");
      const path = typeof row.storage_path === "string" ? row.storage_path : "";
      // Only point at real image objects, never the ".null" miss markers.
      if (nobb && path && !path.endsWith(".null")) {
        map.set(nobb, path);
      }
    }

    if (data.length < NOBB_IMAGE_PAGE_SIZE) {
      break;
    }
  }

  return map;
}

function productToRow(product: StorefrontProduct, imagePath: string | null, batchIso: string) {
  return {
    id: product.id,
    slug: product.slug,
    nobb_number: product.nobbNumber,
    product_name: product.productName,
    supplier_name: product.supplierName,
    brand: product.brand ?? "",
    unit: product.unit ?? "STK",
    price_unit: product.priceUnit ?? null,
    sales_unit: product.salesUnit ?? null,
    sales_unit_quantity: product.salesUnitQuantity ?? null,
    package_area_sqm: product.packageAreaSqm ?? null,
    unit_price_nok: Math.max(0, Math.round(product.unitPriceNok ?? 0)),
    list_price_nok: Math.max(0, Math.round(product.listPriceNok ?? 0)),
    section_title: product.sectionTitle ?? "Byggevarer",
    category: product.category ?? "Diverse",
    description: product.description ?? "",
    ean: product.ean ?? null,
    datasheet_url: product.datasheetUrl ?? null,
    image_path: imagePath,
    image_url: product.imageUrl ?? null,
    technical_details: product.technicalDetails ?? [],
    quantity_suggestion: product.quantitySuggestion ?? "1 stk",
    quantity_reason: product.quantityReason ?? "",
    last_updated: product.lastUpdated || new Date().toISOString().slice(0, 10),
    source: product.source ?? "price_lists",
    popularity_score: Math.round(popularityScore(product)),
    search_text: buildStorefrontSearchText(product),
    updated_at: batchIso,
  };
}

async function writeCatalogMeta(
  admin: SupabaseClient,
  products: StorefrontProduct[],
  batchIso: string,
): Promise<void> {
  const categoryCounts: Record<string, number> = {};
  const supplierCounts: Record<string, number> = {};
  let priceMin = Number.POSITIVE_INFINITY;
  let priceMax = 0;

  for (const product of products) {
    if (product.category) {
      categoryCounts[product.category] = (categoryCounts[product.category] ?? 0) + 1;
    }
    if (product.supplierName) {
      supplierCounts[product.supplierName] = (supplierCounts[product.supplierName] ?? 0) + 1;
    }
    if (product.unitPriceNok > 0) {
      if (product.unitPriceNok < priceMin) priceMin = product.unitPriceNok;
      if (product.unitPriceNok > priceMax) priceMax = product.unitPriceNok;
    }
  }
  if (!Number.isFinite(priceMin)) {
    priceMin = 0;
  }

  const broadCategoryCounts: Record<string, number> = {};
  for (const filter of STOREFRONT_BROAD_CATEGORY_FILTERS) {
    broadCategoryCounts[filter] = products.filter((product) =>
      matchesStorefrontCategory(product, filter),
    ).length;
  }

  const categories = Array.from(new Set(products.map((p) => p.category))).sort((left, right) =>
    left.localeCompare(right, "nb-NO"),
  );
  const suppliers = Array.from(new Set(products.map((p) => p.supplierName))).sort((left, right) =>
    left.localeCompare(right, "nb-NO"),
  );

  const { error } = await admin.from(STOREFRONT_CATALOG_META_TABLE).upsert(
    {
      id: 1,
      categories,
      suppliers,
      category_counts: categoryCounts,
      supplier_counts: supplierCounts,
      broad_category_counts: broadCategoryCounts,
      price_min: Math.floor(priceMin),
      price_max: Math.ceil(priceMax),
      product_count: products.length,
      refreshed_at: batchIso,
    },
    { onConflict: "id" },
  );

  if (error) {
    console.warn("[catalog-refresh] kunne ikke skrive storefront_catalog_meta:", error.message);
  }
}

function fail(startedAt: number, source: string, error: string): CatalogRefreshResult {
  return {
    ok: false,
    productCount: 0,
    source,
    deletedStale: 0,
    durationMs: Date.now() - startedAt,
    error,
  };
}
