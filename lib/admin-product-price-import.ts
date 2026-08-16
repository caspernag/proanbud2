import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { parsePriceImportFile } from "@/lib/price-import-file";
import type { PriceListProduct } from "@/lib/price-lists";
import { getSupplierMarkups } from "@/lib/price-markup";
import { buildStorefrontSearchText, calculateStorefrontDisplayPrices } from "@/lib/storefront";
import {
  STOREFRONT_CATALOG_META_TABLE,
  STOREFRONT_PRODUCTS_TABLE,
} from "@/lib/storefront-catalog-db";
import { slugify } from "@/lib/utils";

const IMPORT_CHUNK_SIZE = 500;
const PAGE_SIZE = 1000;

export const PRODUCT_IMPORT_RUNS_TABLE = "product_import_runs";
export const DEFAULT_IMPORT_SUPPLIER = "Byggmakker";

type ExistingProductRow = {
  id: string;
  slug: string;
  nobb_number: string;
  /**
   * Felter prisfilen ikke bærer. Upserten skriver hele raden, så disse må leses
   * inn og skrives tilbake — ellers nullstiller hver import det som er samlet
   * opp utenom prisfilen.
   */
  popularity_score: number | null;
  ean: string | null;
  image_url: string | null;
  datasheet_url: string | null;
};

type CatalogMetaRow = {
  category: string | null;
  supplier_name: string | null;
  unit_price_nok: number | null;
};

export type ImportRunRow = {
  id: string;
  file_name: string;
  supplier_name: string;
  format: string;
  sheet_name: string | null;
  parsed_rows: number;
  inserted_count: number;
  updated_count: number;
  missing_count: number;
  kept_count: number;
  deleted_count: number;
  status: string;
  warnings: string[];
  mapped_columns: Record<string, string>;
  created_at: string;
  completed_at: string | null;
};

export type PriceImportResult = {
  runId: string;
  parsed: number;
  inserted: number;
  updated: number;
  /** Katalogprodukter fra samme leverandør som ikke lå i filen — venter på gjennomgang. */
  missing: number;
  format: string;
  sheetName: string | null;
  warnings: string[];
};

export type OrphanProductRow = {
  id: string;
  nobb_number: string;
  product_name: string;
  supplier_name: string;
  brand: string | null;
  category: string | null;
  unit: string | null;
  unit_price_nok: number;
  last_updated: string;
};

/**
 * Leser prisfilen (Excel/CSV/JSON), oppdaterer eller oppretter produktene og
 * registrerer en importkjøring. Ingenting slettes her — restene stemples ikke
 * med kjøringens ID og hentes fram til gjennomgang etterpå.
 */
export async function importPriceFile(
  db: SupabaseClient,
  input: { fileName: string; data: Uint8Array; supplierName?: string },
): Promise<PriceImportResult> {
  const supplierName = (input.supplierName ?? DEFAULT_IMPORT_SUPPLIER).trim() || DEFAULT_IMPORT_SUPPLIER;
  const runId = randomUUID();

  const parsedFile = parsePriceImportFile({
    fileName: input.fileName,
    data: input.data,
    supplierName,
  });

  const bestByNobb = dedupeByNobb(parsedFile.products);

  if (bestByNobb.size === 0) {
    throw new Error("Fant ingen gyldige produktrader (NOBB-nummer må ha minst 6 sifre).");
  }

  const existingByNobb = await loadExistingProductsByNobb(db, [...bestByNobb.keys()]);
  const markups = await getSupplierMarkups();
  const updatedAt = new Date().toISOString();
  const lastUpdated = updatedAt.slice(0, 10);

  const rows = [...bestByNobb.entries()].map(([nobb, product]) => {
    const existing = existingByNobb.get(nobb);
    const prices = calculateStorefrontDisplayPrices(
      {
        unitPriceNok: product.priceNok,
        listPriceNok: product.listPriceNok,
        supplierName,
      },
      markups,
    );

    const productName = product.productName.trim();
    const brand = product.brand.trim();
    const category = product.category.trim() || "Diverse";
    const sectionTitle = product.sectionTitle.trim() || "Byggevarer";
    const description = product.description.trim() || productName;
    const technicalDetails = product.technicalDetails ?? [];

    return {
      id: existing?.id ?? `${slugify(supplierName)}-${nobb}`,
      // Slug må alltid være med: PostgREST setter kolonner som mangler i én rad
      // til DEFAULT for hele upserten, og slug er NOT NULL uten default.
      slug: existing?.slug || buildProductSlug(productName, supplierName, nobb),
      nobb_number: nobb,
      product_name: productName,
      supplier_name: supplierName,
      brand,
      unit_price_nok: Math.max(0, Math.round(prices.unitPriceNok)),
      list_price_nok: Math.max(0, Math.round(prices.listPriceNok)),
      // Råtallene fra filen, eks. mva og uten påslag. Utsalgsprisen over er
      // avrundet, påslått og klemt mot veiledende pris, så den kan ikke regnes
      // tilbake til innkjøpspris — dekningsbidraget i /sjefen trenger disse to.
      cost_price_ex_vat_nok: roundOre(product.priceNok),
      list_price_ex_vat_nok: roundOre(product.listPriceNok),
      unit: product.unit || product.salesUnit || "STK",
      price_unit: product.priceUnit || null,
      sales_unit: product.salesUnit || null,
      sales_unit_quantity: product.salesUnitQuantity ?? null,
      package_area_sqm: product.packageAreaSqm ?? null,
      section_title: sectionTitle,
      category,
      description,
      // Prisfilen har sjelden EAN, bilde eller datablad. Mangler de, beholder vi
      // det som allerede står — en tom kolonne i filen skal ikke slette dem.
      // EAN er kritisk: lagerstatusen fra Byggmakker slås opp på EAN, og uten
      // den viser hele butikken «Sjekk lager».
      ean: product.ean ?? existing?.ean ?? null,
      datasheet_url: product.datasheetUrl ?? existing?.datasheet_url ?? null,
      image_url: product.imageUrl ?? existing?.image_url ?? null,
      technical_details: technicalDetails,
      quantity_suggestion: product.quantitySuggestion || "1 stk",
      quantity_reason: product.quantityReason || "",
      last_updated: lastUpdated,
      source: "byggmakker_price_import",
      // Populariteten bygges opp av salg og visninger over tid, ikke av prisfilen.
      popularity_score: existing?.popularity_score ?? 0,
      search_text: buildStorefrontSearchText({
        category,
        sectionTitle,
        productName,
        brand,
        description,
        technicalDetails,
      }),
      last_import_id: runId,
      updated_at: updatedAt,
    };
  });

  let inserted = 0;
  for (let i = 0; i < rows.length; i += IMPORT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + IMPORT_CHUNK_SIZE);
    const { error } = await db.from(STOREFRONT_PRODUCTS_TABLE).upsert(chunk, { onConflict: "id" });

    if (error) {
      throw new Error(`Prisoppdatering feilet ved rad ${i + 1}: ${error.message}`);
    }

    inserted += chunk.filter((row) => !existingByNobb.has(row.nobb_number)).length;
  }

  const missing = await countOrphanProducts(db, { runId, supplierName });

  await refreshCatalogMetaFromDb(db);

  const { error: runError } = await db.from(PRODUCT_IMPORT_RUNS_TABLE).insert({
    id: runId,
    file_name: input.fileName || "prisfil",
    supplier_name: supplierName,
    format: parsedFile.format,
    sheet_name: parsedFile.sheetName,
    parsed_rows: parsedFile.products.length,
    inserted_count: inserted,
    updated_count: rows.length - inserted,
    missing_count: missing,
    status: missing > 0 ? "review" : "done",
    warnings: parsedFile.warnings,
    mapped_columns: parsedFile.mappedColumns,
    completed_at: missing > 0 ? null : new Date().toISOString(),
  });

  if (runError) {
    throw new Error(
      `Produktene ble lagret, men importkjøringen kunne ikke registreres: ${runError.message}`,
    );
  }

  return {
    runId,
    parsed: parsedFile.products.length,
    inserted,
    updated: rows.length - inserted,
    missing,
    format: parsedFile.format,
    sheetName: parsedFile.sheetName,
    warnings: parsedFile.warnings,
  };
}

/* ── Gjennomgang av restene ───────────────────────────────────────────────── */

type OrphanQuery<T> = {
  ilike: (column: string, pattern: string) => T;
  or: (filters: string) => T;
};

/**
 * «Restene» etter en import: produkter fra samme leverandør som kjøringen ikke
 * stemplet. Brukes av både telling, listing og bulkhandlingene, så filteret må
 * være ett sted.
 */
function orphanFilter<T extends OrphanQuery<T>>(
  query: T,
  input: { runId: string; supplierName: string; q?: string },
) {
  let filtered = query
    .ilike("supplier_name", `%${input.supplierName}%`)
    // `neq` alene ville droppet rader der last_import_id er NULL (produkter fra
    // før importsporingen ble innført) — de er nettopp rester.
    .or(`last_import_id.is.null,last_import_id.neq.${input.runId}`);

  const needle = (input.q ?? "").replace(/[,%]/g, " ").replace(/\s+/g, " ").trim();
  if (needle) {
    filtered = filtered.or(
      `product_name.ilike.%${needle}%,nobb_number.ilike.%${needle}%,brand.ilike.%${needle}%`,
    );
  }

  return filtered;
}

export async function countOrphanProducts(
  db: SupabaseClient,
  input: { runId: string; supplierName: string; q?: string },
) {
  const { count, error } = await orphanFilter(
    db.from(STOREFRONT_PRODUCTS_TABLE).select("id", { count: "exact", head: true }),
    input,
  );

  if (error) {
    throw new Error(`Kunne ikke telle produkter til gjennomgang: ${error.message}`);
  }

  return count ?? 0;
}

export async function listOrphanProducts(
  db: SupabaseClient,
  input: { runId: string; supplierName: string; q?: string; from: number; to: number },
) {
  const { data, error, count } = await orphanFilter(
    db
      .from(STOREFRONT_PRODUCTS_TABLE)
      .select(
        "id, nobb_number, product_name, supplier_name, brand, category, unit, unit_price_nok, last_updated",
        { count: "exact" },
      ),
    input,
  )
    .order("product_name", { ascending: true })
    .range(input.from, input.to);

  if (error) {
    throw new Error(`Kunne ikke hente produkter til gjennomgang: ${error.message}`);
  }

  return { rows: (data ?? []) as OrphanProductRow[], total: count ?? 0 };
}

/** Alle rest-ID-ene, brukt av «marker alle»-handlingene. */
async function allOrphanIds(
  db: SupabaseClient,
  input: { runId: string; supplierName: string; q?: string },
) {
  const ids: string[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await orphanFilter(
      db.from(STOREFRONT_PRODUCTS_TABLE).select("id"),
      input,
    )
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Kunne ikke hente produkter til gjennomgang: ${error.message}`);
    }

    const batch = (data ?? []) as Array<{ id: string }>;
    ids.push(...batch.map((row) => row.id));

    if (batch.length < PAGE_SIZE) break;
  }

  return ids;
}

/** Beholder produktene: de stemples med kjøringens ID og forsvinner fra listen. */
export async function keepOrphanProducts(db: SupabaseClient, runId: string, productIds: string[]) {
  let kept = 0;

  for (let i = 0; i < productIds.length; i += IMPORT_CHUNK_SIZE) {
    const chunk = productIds.slice(i, i + IMPORT_CHUNK_SIZE);
    const { error, count } = await db
      .from(STOREFRONT_PRODUCTS_TABLE)
      .update({ last_import_id: runId, updated_at: new Date().toISOString() }, { count: "exact" })
      .in("id", chunk);

    if (error) {
      throw new Error(`Kunne ikke beholde produktene: ${error.message}`);
    }

    kept += count ?? chunk.length;
  }

  if (kept > 0) {
    await bumpRunCounters(db, runId, { kept });
  }

  return kept;
}

export async function deleteOrphanProducts(db: SupabaseClient, runId: string, productIds: string[]) {
  let deleted = 0;

  for (let i = 0; i < productIds.length; i += IMPORT_CHUNK_SIZE) {
    const chunk = productIds.slice(i, i + IMPORT_CHUNK_SIZE);
    const { error, count } = await db
      .from(STOREFRONT_PRODUCTS_TABLE)
      .delete({ count: "exact" })
      .in("id", chunk);

    if (error) {
      throw new Error(`Kunne ikke slette produktene: ${error.message}`);
    }

    deleted += count ?? chunk.length;
  }

  if (deleted > 0) {
    await bumpRunCounters(db, runId, { deleted });
    await refreshCatalogMetaFromDb(db);
  }

  return deleted;
}

/** «Behold alle» / «Slett alle» — eventuelt begrenset til gjeldende søk. */
export async function applyToAllOrphans(
  db: SupabaseClient,
  input: { runId: string; supplierName: string; q?: string; action: "keep" | "delete" },
) {
  const ids = await allOrphanIds(db, input);

  if (ids.length === 0) {
    return 0;
  }

  return input.action === "keep"
    ? keepOrphanProducts(db, input.runId, ids)
    : deleteOrphanProducts(db, input.runId, ids);
}

export async function getImportRun(db: SupabaseClient, runId: string) {
  const { data, error } = await db
    .from(PRODUCT_IMPORT_RUNS_TABLE)
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(`Kunne ikke hente importkjøringen: ${error.message}`);
  }

  return (data as ImportRunRow | null) ?? null;
}

export async function listImportRuns(db: SupabaseClient, limit = 5) {
  const { data, error } = await db
    .from(PRODUCT_IMPORT_RUNS_TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { rows: [] as ImportRunRow[], error: `Importlogg: ${error.message}` };
  }

  return { rows: (data ?? []) as ImportRunRow[], error: null };
}

export async function completeImportRun(db: SupabaseClient, runId: string) {
  const { error } = await db
    .from(PRODUCT_IMPORT_RUNS_TABLE)
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", runId);

  if (error) {
    throw new Error(`Kunne ikke lukke importkjøringen: ${error.message}`);
  }
}

async function bumpRunCounters(
  db: SupabaseClient,
  runId: string,
  delta: { kept?: number; deleted?: number },
) {
  const run = await getImportRun(db, runId);
  if (!run) return;

  const kept = run.kept_count + (delta.kept ?? 0);
  const deleted = run.deleted_count + (delta.deleted ?? 0);
  const settled = kept + deleted >= run.missing_count;

  await db
    .from(PRODUCT_IMPORT_RUNS_TABLE)
    .update({
      kept_count: kept,
      deleted_count: deleted,
      ...(settled ? { status: "done", completed_at: new Date().toISOString() } : {}),
    })
    .eq("id", runId);
}

/* ── Hjelpere ─────────────────────────────────────────────────────────────── */

/** Priser lagres med øre — innkjøpsprisene fra Byggmakker har to desimaler. */
function roundOre(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

/** Samme NOBB flere ganger i filen: laveste pris vinner, som i katalogsynken. */
function dedupeByNobb(products: PriceListProduct[]) {
  const bestByNobb = new Map<string, PriceListProduct>();

  for (const product of products) {
    const nobb = product.nobbNumber.replace(/\D/g, "");
    if (nobb.length < 6) continue;

    const existing = bestByNobb.get(nobb);
    if (!existing || product.priceNok < existing.priceNok) {
      bestByNobb.set(nobb, product);
    }
  }

  return bestByNobb;
}

/**
 * Slug må inneholde NOBB-nummeret for å være unik. slugify() kutter på 60 tegn,
 * så navnet forkortes først — ellers ryker nummeret for lange produktnavn og to
 * produkter kolliderer på unike slug-indeksen.
 */
function buildProductSlug(productName: string, supplierName: string, nobb: string) {
  const base = slugify(`${productName}-${supplierName}`).slice(0, 45).replace(/-+$/, "");
  return `${base || "produkt"}-${nobb}`;
}

async function loadExistingProductsByNobb(db: SupabaseClient, nobbNumbers: string[]) {
  const byNobb = new Map<string, ExistingProductRow>();

  for (let i = 0; i < nobbNumbers.length; i += IMPORT_CHUNK_SIZE) {
    const chunk = nobbNumbers.slice(i, i + IMPORT_CHUNK_SIZE);
    const { data, error } = await db
      .from(STOREFRONT_PRODUCTS_TABLE)
      .select("id, slug, nobb_number, popularity_score, ean, image_url, datasheet_url")
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

export async function refreshCatalogMetaFromDb(db: SupabaseClient) {
  const rows: CatalogMetaRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from(STOREFRONT_PRODUCTS_TABLE)
      .select("category, supplier_name, unit_price_nok")
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Prisene ble lagret, men metadata kunne ikke oppdateres: ${error.message}`);
    }

    const batch = (data ?? []) as CatalogMetaRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
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
