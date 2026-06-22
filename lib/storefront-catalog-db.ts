import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env, hasSupabaseEnv } from "@/lib/env";
import type { StorefrontProduct } from "@/lib/storefront-types";

export const STOREFRONT_PRODUCTS_TABLE = "storefront_products";
export const STOREFRONT_CATALOG_META_TABLE = "storefront_catalog_meta";
export const STOREFRONT_IMAGE_BUCKET = "material-images";

/**
 * Columns selected for read queries. Listing them explicitly (instead of `*`)
 * keeps payloads small and stable.
 */
export const STOREFRONT_PRODUCT_COLUMNS =
  "id, slug, nobb_number, product_name, supplier_name, brand, unit, price_unit, sales_unit, sales_unit_quantity, package_area_sqm, unit_price_nok, list_price_nok, section_title, category, description, ean, datasheet_url, image_path, image_url, technical_details, quantity_suggestion, quantity_reason, last_updated, source, popularity_score";

export type StorefrontProductRow = {
  id: string;
  slug: string;
  nobb_number: string;
  product_name: string;
  supplier_name: string;
  brand: string | null;
  unit: string | null;
  price_unit: string | null;
  sales_unit: string | null;
  sales_unit_quantity: number | string | null;
  package_area_sqm: number | string | null;
  unit_price_nok: number;
  list_price_nok: number;
  section_title: string | null;
  category: string | null;
  description: string | null;
  ean: string | null;
  datasheet_url: string | null;
  image_path: string | null;
  image_url: string | null;
  technical_details: string[] | null;
  quantity_suggestion: string | null;
  quantity_reason: string | null;
  last_updated: string;
  source: string | null;
  popularity_score?: number | null;
};

// Module-level anon client. The catalog is public data (RLS allows anon read),
// and reads happen server-side, so no cookies / session are needed. Reusing one
// client avoids re-instantiation per request.
let cachedClient: SupabaseClient | null = null;

export function getStorefrontCatalogClient(): SupabaseClient | null {
  if (!hasSupabaseEnv()) {
    return null;
  }

  if (!cachedClient) {
    cachedClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return cachedClient;
}

/** Direct public Storage URL for a cached image object (served by Supabase CDN). */
export function buildPublicStorefrontImageUrl(imagePath: string): string {
  const base = env.supabaseUrl.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${STOREFRONT_IMAGE_BUCKET}/${imagePath}`;
}

function toOptionalNumber(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function rowToStorefrontProduct(row: StorefrontProductRow): StorefrontProduct {
  const salesUnitQuantity = toOptionalNumber(row.sales_unit_quantity);
  const packageAreaSqm = toOptionalNumber(row.package_area_sqm);

  return {
    id: row.id,
    slug: row.slug,
    nobbNumber: row.nobb_number,
    productName: row.product_name,
    supplierName: row.supplier_name,
    brand: row.brand ?? "",
    unit: row.unit ?? "STK",
    ...(row.price_unit ? { priceUnit: row.price_unit } : {}),
    ...(row.sales_unit ? { salesUnit: row.sales_unit } : {}),
    ...(salesUnitQuantity !== undefined ? { salesUnitQuantity } : {}),
    ...(packageAreaSqm !== undefined ? { packageAreaSqm } : {}),
    unitPriceNok: row.unit_price_nok ?? 0,
    listPriceNok: row.list_price_nok ?? 0,
    sectionTitle: row.section_title ?? "Byggevarer",
    category: row.category ?? "Diverse",
    description: row.description ?? "",
    ...(row.ean ? { ean: row.ean } : {}),
    ...(row.datasheet_url ? { datasheetUrl: row.datasheet_url } : {}),
    ...(row.image_url ? { imageUrl: row.image_url } : {}),
    ...(row.image_path ? { imagePath: row.image_path } : {}),
    technicalDetails: row.technical_details ?? [],
    quantitySuggestion: row.quantity_suggestion ?? "1 stk",
    quantityReason: row.quantity_reason ?? "",
    lastUpdated: row.last_updated,
    source: (row.source as StorefrontProduct["source"]) ?? "price_lists",
  };
}
