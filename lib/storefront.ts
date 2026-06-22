import "server-only";

import OpenAI from "openai";

import { cacheLife } from "next/cache";

import { env, hasOpenAiEnv } from "@/lib/env";
import { toVatInclusiveNok } from "@/lib/material-order";
import { applyMarkup, getSupplierMarkups, type SupplierMarkup } from "@/lib/price-markup";
import {
  describeSalesUnitQuantity,
  parseSalesUnitQuantity,
  priceForSalesUnit,
} from "@/lib/product-unit-pricing";
import { loadPriceListProductsFromVectorStore, type PriceListProduct } from "@/lib/price-lists";
import { filterStorefrontBlacklistedProducts } from "@/lib/storefront-product-blacklist";
import { buildStorefrontNobbImagePath, isAllowedStorefrontImageUrl, STORE_IMAGE_FALLBACK_URL } from "@/lib/storefront-image";
import { scoreStorefrontProductForUserProfile } from "@/lib/storefront-user-profile";
import type {
  StorefrontProduct,
  StorefrontProductQuery,
  StorefrontProductQueryResult,
  StorefrontProductSource,
  StorefrontSortOption,
} from "@/lib/storefront-types";
import {
  STOREFRONT_CATALOG_META_TABLE,
  STOREFRONT_PRODUCT_COLUMNS,
  STOREFRONT_PRODUCTS_TABLE,
  buildPublicStorefrontImageUrl,
  getStorefrontCatalogClient,
  rowToStorefrontProduct,
  type StorefrontProductRow,
} from "@/lib/storefront-catalog-db";
import { slugify } from "@/lib/utils";

const STOREFRONT_DEFAULT_PAGE_SIZE = 24;

/**
 * Broad category filters shown on the storefront landing/sidebar. Used both for
 * rendering (page.tsx FEATURED_CATEGORIES) and for precomputing broad category
 * counts in the catalog-refresh job. Each value is matched via
 * matchesStorefrontCategory (name/category/alias substring).
 */
export const STOREFRONT_BROAD_CATEGORY_FILTERS = [
  "Trelast",
  "Plater",
  "Isolasjon",
  "Kledning",
  "Tak",
  "Maling",
  "Festemidler",
  "Verktøy",
] as const;

/**
 * Lowercased haystack mirroring the fields matchesStorefrontCategory inspects,
 * stored as storefront_products.search_text so category/alias filtering can run
 * in SQL (ILIKE over a trigram index).
 */
export function buildStorefrontSearchText(
  product: Pick<
    StorefrontProduct,
    "category" | "sectionTitle" | "productName" | "brand" | "description" | "technicalDetails"
  >,
): string {
  return [
    product.category,
    product.sectionTitle,
    product.productName,
    product.brand,
    product.description,
    ...product.technicalDetails,
  ]
    .join(" ")
    .toLowerCase();
}

const CATEGORY_FILTER_ALIASES: Record<string, string[]> = {
  isolasjon: [
    "isolasjon",
    "glava",
    "rockwool",
    "mineralull",
    "jackofoam",
    "jackopor",
    "cellplast",
    "eps",
    "xps",
    "flexi a-plate",
    "i-plate",
    "markplate",
    "vintermatte",
    "lydreduksjonsbøyle",
  ],
  trelast: [
    "konstruksjonsvirke",
    "trelast",
    "limtre",
    "lekt",
    "plank",
    "bord",
    "terrassebord",
  ],
  plater: [
    "gipsplater",
    "gips og plater",
    "osb",
    "sponplater",
    "kryssfiner",
    "hardbordplater",
  ],
};

export async function getStorefrontProducts() {
  "use cache";
  cacheLife("hours");

  return loadStorefrontCatalogFromDb();
}

/**
 * Reads the full catalog snapshot from Postgres (paginated). Cheap compared to
 * the vector-store build; backs text search, AI matching, and featured deals.
 */
async function loadStorefrontCatalogFromDb(): Promise<{
  products: StorefrontProduct[];
  source: StorefrontProductSource;
  vectorStoreId: string | null;
}> {
  const client = getStorefrontCatalogClient();
  const vectorStoreId = env.openAiVectorStoreIdStorefront || null;

  if (!client) {
    return { products: [], source: "vector_store", vectorStoreId };
  }

  const products: StorefrontProduct[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(STOREFRONT_PRODUCTS_TABLE)
      .select(STOREFRONT_PRODUCT_COLUMNS)
      .order("popularity_score", { ascending: false })
      .order("product_name", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("[storefront] kunne ikke lese katalog fra Postgres:", error.message);
      break;
    }
    if (!data || data.length === 0) {
      break;
    }

    products.push(...(data as unknown as StorefrontProductRow[]).map(rowToStorefrontProduct));

    if (data.length < pageSize) {
      break;
    }
  }

  return { products, source: "vector_store", vectorStoreId };
}

/**
 * Builds the fully merged, marked-up, VAT-inclusive, blacklisted catalog by
 * reading the OpenAI vector store + price lists.
 *
 * EXPENSIVE: downloads and parses every vector-store file (twice — storefront +
 * price-list shapes). Only call from the scheduled catalog-refresh job
 * (lib/storefront-catalog-refresh.ts), never on the request path.
 */
export async function buildStorefrontCatalogFromVectorStore() {
  const [fromVectorStore, markups, priceListProducts] = await Promise.all([
    loadStorefrontProductsFromVectorStore(),
    getSupplierMarkups(),
    loadPriceListProductsFromVectorStore(),
  ]);

  if (fromVectorStore.products.length > 0) {
    const enriched = applyPriceListCategoryOverrides(fromVectorStore.products, priceListProducts);

    // Merge: add any price list products whose NOBB isn't already in the
    // vector store. This ensures the full catalog is always visible even
    // when the vector store index is stale or partially uploaded.
    const vectorStoreNobbs = new Set(enriched.map((p) => p.nobbNumber));
    const missingFromVectorStore = normalizePriceListProducts(
      priceListProducts.filter((p) => !vectorStoreNobbs.has(p.nobbNumber.replace(/\D/g, ""))),
      "price_lists",
    );
    const merged = dedupeStorefrontProducts([...enriched, ...missingFromVectorStore]);

    return {
      ...fromVectorStore,
      products: filterStorefrontBlacklistedProducts(applyStorefrontPricing(merged, markups)),
    };
  }

  const fallbackProducts = priceListProducts;
  const normalizedFallbackProducts = normalizePriceListProducts(fallbackProducts, "price_lists");
  const dedupedFallbackProducts = dedupeStorefrontProducts(normalizedFallbackProducts);

  return {
    products: filterStorefrontBlacklistedProducts(
      applyStorefrontPricing(sortStorefrontProducts(dedupedFallbackProducts, "newest"), markups),
    ),
    source: "price_lists" as const,
    vectorStoreId: null,
  };
}

export type StorefrontCatalogMeta = {
  categories: string[];
  suppliers: string[];
  categoryCounts: Record<string, number>;
  supplierCounts: Record<string, number>;
  broadCategoryCounts: Record<string, number>;
  priceMin: number;
  priceMax: number;
  productCount: number;
};

const EMPTY_CATALOG_META: StorefrontCatalogMeta = {
  categories: [],
  suppliers: [],
  categoryCounts: {},
  supplierCounts: {},
  broadCategoryCounts: {},
  priceMin: 0,
  priceMax: 0,
  productCount: 0,
};

// Above this page size we read the full (cached) catalog and paginate in memory
// instead of issuing a huge SQL range — used by the "in stock only" candidate
// fetch which requests every matching product at once.
const STOREFRONT_BULK_PAGE_SIZE = 200;

/** Precomputed catalog facets (categories, counts, price range). Cached. */
export async function getStorefrontCatalogMeta(): Promise<StorefrontCatalogMeta> {
  "use cache";
  cacheLife("hours");

  const client = getStorefrontCatalogClient();
  if (!client) {
    return EMPTY_CATALOG_META;
  }

  const { data, error } = await client
    .from(STOREFRONT_CATALOG_META_TABLE)
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    return EMPTY_CATALOG_META;
  }

  return {
    categories: (data.categories as string[]) ?? [],
    suppliers: (data.suppliers as string[]) ?? [],
    categoryCounts: (data.category_counts as Record<string, number>) ?? {},
    supplierCounts: (data.supplier_counts as Record<string, number>) ?? {},
    broadCategoryCounts: (data.broad_category_counts as Record<string, number>) ?? {},
    priceMin: typeof data.price_min === "number" ? data.price_min : 0,
    priceMax: typeof data.price_max === "number" ? data.price_max : 0,
    productCount: typeof data.product_count === "number" ? data.product_count : 0,
  };
}

export async function queryStorefrontProducts(query: StorefrontProductQuery): Promise<StorefrontProductQueryResult> {
  const q = (query.q ?? "").trim();
  const category = (query.category ?? "").trim();
  const supplier = (query.supplier ?? "").trim();
  const sort = normalizeStorefrontSort(query.sort);
  const userProfile = query.userProfile ?? null;
  const pageSizeLimit = clampNumber(query.pageSizeLimit ?? 60, 1, 5000);
  const pageSize = clampNumber(query.pageSize ?? STOREFRONT_DEFAULT_PAGE_SIZE, 1, pageSizeLimit);
  const page = Math.max(1, Math.round(query.page ?? 1));

  const meta = await getStorefrontCatalogMeta();

  // Text search keeps the carefully-tuned JS relevance scoring (over the cached
  // full catalog). Bulk fetches (in-stock candidates) also go in-memory.
  // Plain browsing is served by cheap paginated SQL.
  if (q.length > 0 || pageSize > STOREFRONT_BULK_PAGE_SIZE) {
    return queryStorefrontProductsInMemory({ q, category, supplier, sort, userProfile, page, pageSize }, meta);
  }

  return browseStorefrontProductsFromDb({ category, supplier, sort, page, pageSize }, meta);
}

type BrowseArgs = {
  category: string;
  supplier: string;
  sort: StorefrontSortOption;
  page: number;
  pageSize: number;
};

type InMemoryArgs = BrowseArgs & {
  q: string;
  userProfile: StorefrontProductQuery["userProfile"];
};

async function browseStorefrontProductsFromDb(
  args: BrowseArgs,
  meta: StorefrontCatalogMeta,
): Promise<StorefrontProductQueryResult> {
  const client = getStorefrontCatalogClient();
  if (!client) {
    return buildQueryResult([], 0, 1, args.pageSize, meta);
  }

  let filter = client.from(STOREFRONT_PRODUCTS_TABLE).select(STOREFRONT_PRODUCT_COLUMNS, { count: "exact" });

  if (args.supplier) {
    filter = filter.eq("supplier_name", args.supplier);
  }

  const categoryNeedle = args.category.trim().toLowerCase();
  if (categoryNeedle) {
    // search_text is the lowercased haystack — mirrors matchesStorefrontCategory.
    // PostgREST .or() uses `*` as the ILIKE wildcard.
    const aliases = CATEGORY_FILTER_ALIASES[categoryNeedle] ?? [];
    const terms = Array.from(new Set([categoryNeedle, ...aliases]));
    filter = filter.or(terms.map((term) => `search_text.ilike.*${term}*`).join(","));
  }

  const { column, ascending } = browseSortColumn(args.sort);
  let ordered = filter.order(column, { ascending });
  if (column !== "product_name") {
    ordered = ordered.order("product_name", { ascending: true });
  }

  const start = (args.page - 1) * args.pageSize;
  const { data, error, count } = await ordered.range(start, start + args.pageSize - 1);

  if (error) {
    console.error("[storefront] browse-spørring feilet:", error.message);
    return buildQueryResult([], 0, 1, args.pageSize, meta);
  }

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / args.pageSize));
  const safePage = Math.min(args.page, totalPages);
  const items = ((data as unknown as StorefrontProductRow[]) ?? []).map(rowToStorefrontProduct);

  return buildQueryResult(items, total, safePage, args.pageSize, meta);
}

async function queryStorefrontProductsInMemory(
  args: InMemoryArgs,
  meta: StorefrontCatalogMeta,
): Promise<StorefrontProductQueryResult> {
  const { products } = await getStorefrontProducts();

  const filtered = products.filter((product) => {
    if (args.category && !matchesStorefrontCategory(product, args.category)) {
      return false;
    }
    if (args.supplier && product.supplierName !== args.supplier) {
      return false;
    }
    if (args.q.length > 0 && scoreStorefrontProduct(product, args.q) <= 0) {
      return false;
    }
    return true;
  });

  const sorted = sortStorefrontProducts(filtered, args.sort, args.q, args.userProfile);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / args.pageSize));
  const safePage = Math.min(args.page, totalPages);
  const start = (safePage - 1) * args.pageSize;
  const items = sorted.slice(start, start + args.pageSize);

  return buildQueryResult(items, total, safePage, args.pageSize, meta);
}

function browseSortColumn(sort: StorefrontSortOption): { column: string; ascending: boolean } {
  switch (sort) {
    case "price_asc":
      return { column: "unit_price_nok", ascending: true };
    case "price_desc":
      return { column: "unit_price_nok", ascending: false };
    case "name_asc":
      return { column: "product_name", ascending: true };
    case "newest":
      return { column: "last_updated", ascending: false };
    default:
      // "relevance" with no query → precomputed popularity ranking
      return { column: "popularity_score", ascending: false };
  }
}

function buildQueryResult(
  items: StorefrontProduct[],
  total: number,
  page: number,
  pageSize: number,
  meta: StorefrontCatalogMeta,
): StorefrontProductQueryResult {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    categories: meta.categories,
    suppliers: meta.suppliers,
    categoryCounts: meta.categoryCounts,
    supplierCounts: meta.supplierCounts,
    priceRange: { min: meta.priceMin, max: meta.priceMax },
    source: "vector_store",
    vectorStoreId: env.openAiVectorStoreIdStorefront || null,
  };
}

export async function getStorefrontProductBySlug(slug: string) {
  const client = getStorefrontCatalogClient();
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from(STOREFRONT_PRODUCTS_TABLE)
    .select(STOREFRONT_PRODUCT_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return rowToStorefrontProduct(data as unknown as StorefrontProductRow);
}

export async function getStorefrontFeaturedDeals(limit = 6): Promise<StorefrontProduct[]> {
  const { products } = await getStorefrontProducts();
  return products
    .filter((product) => product.listPriceNok > product.unitPriceNok && product.unitPriceNok > 0)
    .map((product) => ({
      product,
      discount: (product.listPriceNok - product.unitPriceNok) / product.listPriceNok,
    }))
    .sort((left, right) => right.discount - left.discount)
    .slice(0, limit)
    .map((entry) => entry.product);
}

export async function getStorefrontProductsByIds(ids: string[]) {
  if (ids.length === 0) {
    return [] as StorefrontProduct[];
  }

  const client = getStorefrontCatalogClient();
  if (!client) {
    return [] as StorefrontProduct[];
  }

  const { data, error } = await client
    .from(STOREFRONT_PRODUCTS_TABLE)
    .select(STOREFRONT_PRODUCT_COLUMNS)
    .in("id", ids);

  if (error || !data) {
    return [] as StorefrontProduct[];
  }

  return (data as unknown as StorefrontProductRow[]).map(rowToStorefrontProduct);
}

export async function getStorefrontProductsByNobb(nobbNumbers: string[]): Promise<StorefrontProduct[]> {
  if (nobbNumbers.length === 0) {
    return [];
  }

  const client = getStorefrontCatalogClient();
  if (!client) {
    return [];
  }

  const { data, error } = await client
    .from(STOREFRONT_PRODUCTS_TABLE)
    .select(STOREFRONT_PRODUCT_COLUMNS)
    .in("nobb_number", nobbNumbers);

  if (error || !data) {
    return [];
  }

  const wantedOrder = new Map(nobbNumbers.map((n, i) => [n, i]));
  return (data as unknown as StorefrontProductRow[])
    .map(rowToStorefrontProduct)
    .filter((p) => wantedOrder.has(p.nobbNumber))
    .sort((a, b) => (wantedOrder.get(a.nobbNumber) ?? 99) - (wantedOrder.get(b.nobbNumber) ?? 99));
}

export function getStorefrontImageUrl(
  product: Pick<StorefrontProduct, "imageUrl" | "imagePath" | "nobbNumber">,
): string {
  // Cached object in the public bucket → served directly by the Supabase CDN.
  // This bypasses the /api/storefront-images proxy (no storage.search / objects
  // lookup / function egress) for the ~thousands of already-cached images.
  if (product.imagePath) {
    return buildPublicStorefrontImageUrl(product.imagePath);
  }

  if (product.imageUrl && isAllowedStorefrontImageUrl(product.imageUrl)) {
    return product.imageUrl;
  }

  // No cached image yet → the proxy resolves + warms it (and serves a fallback
  // redirect). Subsequent refreshes pick up the cached path.
  if (product.nobbNumber) {
    return buildStorefrontNobbImagePath(product.nobbNumber);
  }

  return STORE_IMAGE_FALLBACK_URL;
}

async function loadStorefrontProductsFromVectorStore() {
  if (!hasOpenAiEnv()) {
    return {
      products: [] as StorefrontProduct[],
      source: "vector_store" as const,
      vectorStoreId: env.openAiVectorStoreIdStorefront || null,
    };
  }

  const vectorStoreId = env.openAiVectorStoreIdStorefront.trim();

  if (!vectorStoreId) {
    return {
      products: [] as StorefrontProduct[],
      source: "vector_store" as const,
      vectorStoreId: null,
    };
  }

  try {
    const openai = new OpenAI({ apiKey: env.openAiApiKey });
    const vectorStore = await openai.vectorStores.retrieve(vectorStoreId);

    if (vectorStore.status === "expired") {
      return {
        products: [] as StorefrontProduct[],
        source: "vector_store" as const,
        vectorStoreId,
      };
    }

    const parsedProducts: StorefrontProduct[] = [];

    for await (const file of openai.vectorStores.files.list(vectorStoreId, {
      filter: "completed",
      order: "asc",
    })) {
      const fileName = await resolveVectorStoreFileName(openai, file.id, file.attributes);
      const fileContentParts: string[] = [];

      for await (const contentPart of openai.vectorStores.files.content(file.id, { vector_store_id: vectorStoreId })) {
        if (typeof contentPart.text === "string" && contentPart.text.trim().length > 0) {
          fileContentParts.push(contentPart.text);
        }
      }

      const rawContent = fileContentParts.join("\n").trim();

      if (!rawContent) {
        continue;
      }

      parsedProducts.push(...parseStorefrontProductsFromVectorFile(rawContent, fileName));
    }

    return {
      products: sortStorefrontProducts(dedupeStorefrontProducts(parsedProducts), "newest"),
      source: "vector_store" as const,
      vectorStoreId,
    };
  } catch {
    return {
      products: [] as StorefrontProduct[],
      source: "vector_store" as const,
      vectorStoreId,
    };
  }
}

function parseStorefrontProductsFromVectorFile(rawContent: string, fileName: string): StorefrontProduct[] {
  const parsedJson = parseProductsFromJson(rawContent, fileName);

  if (parsedJson.length > 0) {
    return parsedJson;
  }

  const parsedNdjson = parseProductsFromNdjson(rawContent, fileName);

  if (parsedNdjson.length > 0) {
    return parsedNdjson;
  }

  const parsedCsv = parseProductsFromCsvLikeText(rawContent, fileName);

  if (parsedCsv.length > 0) {
    return parsedCsv;
  }

  return [] as StorefrontProduct[];
}

function parseProductsFromJson(rawContent: string, fileName: string): StorefrontProduct[] {
  try {
    const parsed = JSON.parse(rawContent) as unknown;
    return normalizeProductsFromUnknown(parsed, fileName, "vector_store");
  } catch {
    return [] as StorefrontProduct[];
  }
}

function parseProductsFromNdjson(rawContent: string, fileName: string): StorefrontProduct[] {
  const lines = rawContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));

  if (lines.length === 0) {
    return [] as StorefrontProduct[];
  }

  const products: StorefrontProduct[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      products.push(...normalizeProductsFromUnknown(parsed, fileName, "vector_store"));
    } catch {
      continue;
    }
  }

  return products;
}

function parseProductsFromCsvLikeText(rawContent: string, fileName: string): StorefrontProduct[] {
  const lines = rawContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const delimiter = detectCsvDelimiter(lines);

  if (!delimiter) {
    return [] as StorefrontProduct[];
  }

  const supplierName = supplierLabelFromFileName(fileName);
  const lastUpdated = new Date().toISOString().slice(0, 10);
  const products: StorefrontProduct[] = [];

  for (const line of lines) {
    const columns = splitDelimitedLine(line, delimiter);
    const isSemicolon = delimiter === ";";
    const categoryCode = normalizeCsvColumn(columns[isSemicolon ? 0 : 9]);
    const eanRaw = normalizeCsvColumn(columns[isSemicolon ? 1 : -1]);
    const nobbCandidate = normalizeCsvColumn(columns[isSemicolon ? 2 : 0]);
    const productName = normalizeCsvColumn(columns[isSemicolon ? 4 : 1]);
    const pricePrimary = normalizeCsvColumn(columns[6]);
    const priceSecondary = normalizeCsvColumn(columns[isSemicolon ? 5 : 4]);
    const priceUnit = normalizeCsvColumn(columns[7]);
    const descriptionRaw = normalizeCsvColumn(columns[isSemicolon ? 9 : 2]);
    const salesUnit = normalizeCsvColumn(columns[isSemicolon ? 10 : 7]);
    const salesUnitQuantityRaw = normalizeCsvColumn(columns[isSemicolon ? 11 : -1]);
    const altNobbCandidate = normalizeCsvColumn(columns[isSemicolon ? 14 : -1]);
    const brandOrSeries = normalizeCsvColumn(columns[isSemicolon ? 9 : 2]);
    const nobbNumber = pickCsvNobbNumber(nobbCandidate, altNobbCandidate);

    if (!nobbNumber || !productName) {
      continue;
    }

    const normalizedPriceUnit = (priceUnit || salesUnit || "STK").toUpperCase();
    const normalizedSalesUnit = (salesUnit || normalizedPriceUnit).toUpperCase();
    const salesUnitQuantity = parseSalesUnitQuantity(
      descriptionRaw,
      normalizedPriceUnit,
      normalizedSalesUnit,
      salesUnitQuantityRaw,
    );
    const packageAreaSqm = normalizedPriceUnit === "M2" ? salesUnitQuantity : undefined;
    const unit = normalizedSalesUnit;
    const priceNok = parseCsvPriceNok(pricePrimary) ?? parseCsvPriceNok(priceSecondary) ?? 0;
    const listPriceNok = parseCsvPriceNok(priceSecondary) ?? priceNok;
    const salesUnitQuantityDetail = describeSalesUnitQuantity({
      priceUnit: normalizedPriceUnit,
      salesUnit: normalizedSalesUnit,
      salesUnitQuantity,
    });

    const normalizedProduct = normalizeStorefrontProduct(
      {
      id: `${slugify(fileName)}-${nobbNumber}`,
        nobbNumber,
        productName,
        supplierName,
        brand: inferCsvBrand(brandOrSeries, productName),
        unit,
        priceUnit: normalizedPriceUnit,
        salesUnit: normalizedSalesUnit,
        salesUnitQuantity,
        packageAreaSqm,
        unitPriceNok: priceNok,
        listPriceNok,
        sectionTitle: inferCsvSectionTitle(categoryCode, productName),
        category: inferCsvCategory(categoryCode, productName),
        description: descriptionRaw || productName,
        ean: parseCsvEan(eanRaw),
        technicalDetails: [
          descriptionRaw,
          `Prisenhet: ${normalizedPriceUnit}`,
          `Salgsenhet: ${normalizedSalesUnit}`,
          salesUnitQuantityDetail,
        ].filter((value) => value.length > 0),
        quantitySuggestion: inferCsvQuantitySuggestion(unit, inferCsvSectionTitle(categoryCode, productName)),
        quantityReason: inferCsvQuantityReason(unit, inferCsvSectionTitle(categoryCode, productName), supplierName),
        lastUpdated,
        source: "vector_store",
        unitPriceBasis: "price_unit",
      },
      fileName,
    );

    if (normalizedProduct) {
      products.push(normalizedProduct);
    }
  }

  return products;
}

function normalizeProductsFromUnknown(
  raw: unknown,
  fileName: string,
  source: "vector_store" | "price_lists",
): StorefrontProduct[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => normalizeProductsFromUnknown(entry, fileName, source));
  }

  if (!raw || typeof raw !== "object") {
    return [] as StorefrontProduct[];
  }

  const record = raw as Record<string, unknown>;

  if (Array.isArray(record.items)) {
    return normalizeProductsFromUnknown(record.items, fileName, source);
  }

  if (Array.isArray(record.products)) {
    return normalizeProductsFromUnknown(record.products, fileName, source);
  }

  const product = normalizeStorefrontProduct(
    {
      id: readStringField(record, ["id", "productId"]) || "",
      nobbNumber: readStringField(record, ["nobbNumber", "nobb", "nobb_number"]) || "",
      productName: readStringField(record, ["productName", "product_name", "item", "title", "name"]) || "",
      supplierName: readStringField(record, ["supplierName", "supplier_name", "supplier"]) || "",
      brand: readStringField(record, ["brand", "brandName", "brand_name"]) || "",
      unit: readStringField(record, ["unit", "salesUnit", "unit_code"]) || "STK",
      priceUnit: readStringField(record, ["priceUnit", "price_unit", "pricingUnit", "pricing_unit"]),
      salesUnit: readStringField(record, ["salesUnit", "sales_unit", "sellingUnit", "selling_unit"]),
      salesUnitQuantity: readNumberField(record, [
        "salesUnitQuantity",
        "sales_unit_quantity",
        "quantityPerSalesUnit",
        "quantity_per_sales_unit",
      ]),
      packageAreaSqm: readNumberField(record, ["packageAreaSqm", "package_area_sqm", "sqmPerPackage", "sqm_per_package"]),
      unitPriceNok:
        readNumberField(record, ["unitPriceNok", "unit_price_nok", "priceNok", "price_nok", "price"]) ?? 0,
      listPriceNok:
        readNumberField(record, ["listPriceNok", "list_price_nok", "veiledendePrisNok", "compareAtPriceNok"]) ?? 0,
      sectionTitle: readStringField(record, ["sectionTitle", "section_title", "section"]) || "Byggevarer",
      category: readStringField(record, ["category", "categoryName", "category_name"]) || "Diverse",
      description: readStringField(record, ["description", "comment", "details"]) || "",
      ean: readStringField(record, ["ean", "eanNumber", "ean_number"]) || undefined,
      datasheetUrl: readStringField(record, ["datasheetUrl", "datasheet_url"]) || undefined,
      imageUrl: readStringField(record, ["imageUrl", "image_url"]) || undefined,
      technicalDetails: readStringArrayField(record, ["technicalDetails", "technical_details", "specs"]),
      quantitySuggestion: readStringField(record, ["quantitySuggestion", "quantity_suggestion"]) || "1 stk",
      quantityReason: readStringField(record, ["quantityReason", "quantity_reason"]) || "Direkte fra leverandørkatalog.",
      lastUpdated: readStringField(record, ["lastUpdated", "last_updated"]) || new Date().toISOString().slice(0, 10),
      source,
      unitPriceBasis: "price_unit",
    },
    fileName,
  );

  return product ? [product] : [];
}

function normalizePriceListProducts(products: PriceListProduct[], source: "price_lists" | "vector_store") {
  return products.flatMap((product) => {
    const normalized = normalizeStorefrontProduct(
      {
        id: product.id,
        nobbNumber: product.nobbNumber,
        productName: product.productName,
        supplierName: product.supplierName,
        brand: product.brand,
        unit: product.unit,
        priceUnit: product.priceUnit,
        salesUnit: product.salesUnit,
        salesUnitQuantity: product.salesUnitQuantity,
        packageAreaSqm: product.packageAreaSqm,
        unitPriceNok: product.priceNok,
        listPriceNok: product.listPriceNok,
        sectionTitle: product.sectionTitle,
        category: product.category,
        description: product.description,
        ean: product.ean,
        datasheetUrl: product.datasheetUrl,
        imageUrl: product.imageUrl,
        technicalDetails: product.technicalDetails,
        quantitySuggestion: product.quantitySuggestion,
        quantityReason: product.quantityReason,
        lastUpdated: product.lastUpdated,
        source,
        unitPriceBasis: "sales_unit",
      },
      product.supplierName,
    );

    return normalized ? [normalized] : [];
  });
}

function normalizeStorefrontProduct(
  product: {
    id: string;
    nobbNumber: string;
    productName: string;
    supplierName: string;
    brand: string;
    unit: string;
    priceUnit?: string;
    salesUnit?: string;
    salesUnitQuantity?: number;
    packageAreaSqm?: number;
    unitPriceNok: number;
    listPriceNok: number;
    sectionTitle: string;
    category: string;
    description: string;
    ean?: string;
    datasheetUrl?: string;
    imageUrl?: string;
    technicalDetails?: string[];
    quantitySuggestion?: string;
    quantityReason?: string;
    lastUpdated?: string;
    source: "vector_store" | "price_lists";
    unitPriceBasis?: "price_unit" | "sales_unit";
  },
  fileName: string,
) {
  const productName = product.productName.trim();
  const supplierName = product.supplierName.trim() || supplierLabelFromFileName(fileName);
  const nobbNumber = product.nobbNumber.replace(/\D/g, "");

  if (!productName || !supplierName || nobbNumber.length < 6) {
    return null;
  }

  const slugBase = `${productName}-${supplierName}-${nobbNumber}`;
  const fallbackUnit = product.unit.trim().toUpperCase() || "STK";
  const priceUnit = product.priceUnit?.trim().toUpperCase() || fallbackUnit;
  const salesUnit = product.salesUnit?.trim().toUpperCase() || fallbackUnit;
  const salesUnitQuantity = product.salesUnitQuantity ?? parseSalesUnitQuantity(product.description, priceUnit, salesUnit);
  const packageAreaSqm = product.packageAreaSqm ?? (priceUnit === "M2" ? salesUnitQuantity : undefined);
  const unitPriceNok =
    product.unitPriceBasis === "price_unit"
      ? priceForSalesUnit(product.unitPriceNok, { priceUnit, salesUnit, salesUnitQuantity })
      : product.unitPriceNok;
  const listPriceNok =
    product.unitPriceBasis === "price_unit"
      ? priceForSalesUnit(product.listPriceNok || product.unitPriceNok, { priceUnit, salesUnit, salesUnitQuantity })
      : product.listPriceNok || product.unitPriceNok;

  return {
    id: product.id.trim() || `${slugify(supplierName)}-${nobbNumber}`,
    slug: slugify(slugBase),
    nobbNumber,
    productName,
    supplierName,
    brand: product.brand.trim() || inferCsvBrand("", productName),
    unit: salesUnit,
    priceUnit,
    salesUnit,
    ...(salesUnitQuantity ? { salesUnitQuantity } : {}),
    ...(packageAreaSqm ? { packageAreaSqm } : {}),
    unitPriceNok: Math.max(0, Math.round(unitPriceNok)),
    listPriceNok: Math.max(0, Math.round(listPriceNok)),
    sectionTitle: product.sectionTitle.trim() || "Byggevarer",
    category: product.category.trim() || "Diverse",
    description: product.description.trim() || productName,
    ...(product.ean?.trim() ? { ean: product.ean.trim() } : {}),
    ...(product.datasheetUrl?.trim() ? { datasheetUrl: product.datasheetUrl.trim() } : {}),
    ...(product.imageUrl?.trim() ? { imageUrl: product.imageUrl.trim() } : {}),
    technicalDetails: (product.technicalDetails ?? []).map((detail) => detail.trim()).filter(Boolean).slice(0, 8),
    quantitySuggestion: product.quantitySuggestion?.trim() || "1 stk",
    quantityReason: product.quantityReason?.trim() || "Direkte fra leverandørkatalog.",
    lastUpdated: product.lastUpdated?.trim() || new Date().toISOString().slice(0, 10),
    source: product.source,
  } satisfies StorefrontProduct;
}

// Prislisten er autoritativ for kategori, enheter og basispris.
// Vector-store-indeksen kan være stale, så vi overlegger prislistedata matchet på NOBB-nummer.
function applyPriceListCategoryOverrides(
  products: StorefrontProduct[],
  priceListProducts: PriceListProduct[],
): StorefrontProduct[] {
  if (priceListProducts.length === 0) {
    return products;
  }

  const byNobb = new Map<string, PriceListProduct>();
  for (const entry of priceListProducts) {
    const key = entry.nobbNumber.replace(/\D/g, "");
    if (!key) continue;
    const existing = byNobb.get(key);
    if (!existing || entry.priceNok < existing.priceNok) {
      byNobb.set(key, entry);
    }
  }

  return products.map((product) => {
    const match = byNobb.get(product.nobbNumber);
    if (!match) return product;
    const nextCategory = match.category?.trim();
    const nextSection = match.sectionTitle?.trim();
    return {
      ...product,
      brand: preferSearchText(match.brand, product.brand, product.productName),
      category: nextCategory || product.category,
      sectionTitle: nextSection || product.sectionTitle,
      description: preferSearchText(match.description, product.description, product.productName),
      unit: match.salesUnit || match.unit || product.unit,
      priceUnit: match.priceUnit || product.priceUnit,
      salesUnit: match.salesUnit || product.salesUnit,
      ...(match.salesUnitQuantity ? { salesUnitQuantity: match.salesUnitQuantity } : {}),
      ...(match.packageAreaSqm ? { packageAreaSqm: match.packageAreaSqm } : {}),
      unitPriceNok: match.priceNok,
      listPriceNok: match.listPriceNok || match.priceNok,
      technicalDetails: mergeTechnicalDetails(product.technicalDetails, match.technicalDetails),
    };
  });
}

function mergeTechnicalDetails(current: string[], next: string[]) {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const detail of [...next, ...current]) {
    const trimmed = detail.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    merged.push(trimmed);
  }

  return merged.slice(0, 8);
}

function preferSearchText(primary: string, fallback: string, productName: string) {
  const primaryText = primary.trim();
  const fallbackText = fallback.trim();
  const normalizedFallback = fallbackText.toLowerCase();
  const normalizedProductName = productName.trim().toLowerCase();

  if (!primaryText) {
    return fallbackText;
  }

  if (!fallbackText || normalizedFallback === normalizedProductName || normalizedFallback === "ukjent merke") {
    return primaryText;
  }

  return fallbackText;
}

function applyStorefrontPricing(products: StorefrontProduct[], markups: SupplierMarkup[]): StorefrontProduct[] {
  return products.map((product) => {
    const prices = calculateStorefrontDisplayPrices(product, markups);

    return {
      ...product,
      unitPriceNok: prices.unitPriceNok,
      listPriceNok: prices.listPriceNok,
    };
  });
}

export function calculateStorefrontDisplayPrices(
  product: Pick<StorefrontProduct, "unitPriceNok" | "listPriceNok" | "supplierName">,
  markups: SupplierMarkup[],
) {
  const currentPriceWithMarkup = applyMarkup(product.unitPriceNok, product.supplierName, markups);
  const unitPriceNok = toVatInclusiveNok(currentPriceWithMarkup);
  const listPriceNok = product.listPriceNok > 0 ? toVatInclusiveNok(product.listPriceNok) : unitPriceNok;

  return { unitPriceNok, listPriceNok };
}

function dedupeStorefrontProducts(products: StorefrontProduct[]) {
  const deduped = new Map<string, StorefrontProduct>();

  for (const product of products) {
    const key = `${product.supplierName.toLowerCase()}::${product.nobbNumber}`;
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, product);
      continue;
    }

    const existingUpdated = new Date(existing.lastUpdated).getTime();
    const productUpdated = new Date(product.lastUpdated).getTime();

    if (productUpdated > existingUpdated || product.unitPriceNok < existing.unitPriceNok) {
      deduped.set(key, product);
    }
  }

  return Array.from(deduped.values());
}

/** Category popularity weight — higher = more frequently purchased. */
const CATEGORY_POPULARITY: Record<string, number> = {
  "Konstruksjonsvirke": 100,
  "Festemidler": 95,
  "Isolasjon": 90,
  "Gips og plater": 85,
  "Tetting og fukt": 75,
  "Maling": 70,
  "Overflatebehandling": 60,
  "Terrasse": 50,
  "Baderom": 45,
  "Gulv": 40,
  "Generelt": 20,
};

export function popularityScore(
  product: StorefrontProduct,
  userProfile?: StorefrontProductQuery["userProfile"],
) {
  const categoryScore = CATEGORY_POPULARITY[product.category] ?? 20;

  // Penalise accessories and minor variants (names starting with "+", "KARMSETT", etc.)
  const name = product.productName.trim();
  const isVariant = name.startsWith("+") || /^(KARMSETT|KARMSET)\b/i.test(name);
  const variantPenalty = isVariant ? 40 : 0;

  // Slight boost for products with a known list price discount (popular = on offer)
  const hasDiscount = product.listPriceNok > product.unitPriceNok ? 5 : 0;

  const profileScore = scoreStorefrontProductForUserProfile(product, userProfile);

  return categoryScore - variantPenalty + hasDiscount + profileScore;
}

function sortStorefrontProducts(
  products: StorefrontProduct[],
  sort: StorefrontSortOption,
  q = "",
  userProfile?: StorefrontProductQuery["userProfile"],
) {
  return products.slice().sort((left, right) => {
    if (sort === "price_asc") {
      return left.unitPriceNok - right.unitPriceNok || left.productName.localeCompare(right.productName, "nb-NO");
    }

    if (sort === "price_desc") {
      return right.unitPriceNok - left.unitPriceNok || left.productName.localeCompare(right.productName, "nb-NO");
    }

    if (sort === "name_asc") {
      return left.productName.localeCompare(right.productName, "nb-NO");
    }

    if (sort === "newest") {
      return (
        new Date(right.lastUpdated).getTime() - new Date(left.lastUpdated).getTime() ||
        left.productName.localeCompare(right.productName, "nb-NO")
      );
    }

    // Without a search query, surface the most commonly purchased products first.
    if (!q) {
      const leftPop = popularityScore(left, userProfile);
      const rightPop = popularityScore(right, userProfile);
      return (
        rightPop - leftPop ||
        left.productName.localeCompare(right.productName, "nb-NO")
      );
    }

    const leftRelevance = scoreStorefrontProduct(left, q) + scoreStorefrontProductForUserProfile(left, userProfile);
    const rightRelevance = scoreStorefrontProduct(right, q) + scoreStorefrontProductForUserProfile(right, userProfile);

    return (
      rightRelevance - leftRelevance ||
      left.productName.localeCompare(right.productName, "nb-NO")
    );
  });
}

export function scoreStorefrontProduct(product: StorefrontProduct, q: string) {
  const needle = normalizeSearchText(q);

  if (!needle) {
    return 1;
  }

  const numericNeedle = q.replace(/\D/g, "");
  const ean = product.ean ?? "";

  if (numericNeedle.length >= 6 && (product.nobbNumber === numericNeedle || ean === numericNeedle)) {
    return 100;
  }

  let score = 0;
  let numericMatch = false;
  const fields = searchableProductFields(product);
  const combined = normalizeSearchText(fields.map((field) => field.value).join(" "));
  const tokens = searchTokens(q);
  const matchQuality = analyzeSearchMatch(fields, needle, tokens);

  if (combined.includes(needle)) {
    score += 45;
  }

  for (const field of fields) {
    const value = normalizeSearchText(field.value);

    if (!value) {
      continue;
    }

    if (value === needle) {
      score += field.phraseWeight * 3;
    } else if (value.startsWith(needle)) {
      score += field.phraseWeight * 2;
    } else if (value.includes(needle)) {
      score += field.phraseWeight;
    }

    for (const token of tokens) {
      if (fieldMatchesToken(value, token)) {
        score += field.tokenWeight;
      }
    }
  }

  if (product.nobbNumber.includes(numericNeedle) && numericNeedle.length >= 4) {
    score += 30;
    numericMatch = true;
  }

  if (ean.includes(numericNeedle) && numericNeedle.length >= 6) {
    score += 20;
    numericMatch = true;
  }

  const matchedTokens = tokens.filter((token) => fieldMatchesToken(combined, token)).length;

  if (tokens.length > 1 && matchedTokens > 0) {
    score += matchedTokens * 8;
  }

  if (tokens.length > 1 && matchedTokens === tokens.length) {
    score += 40;
  } else if (tokens.length > 2 && matchedTokens / tokens.length >= 0.6) {
    score += 18;
  }

  return isSearchMatchEligible({ score, tokens, numericMatch, matchQuality }) ? score : 0;
}

function searchableProductFields(product: StorefrontProduct) {
  const brandAndName = `${product.brand} ${product.productName}`.trim();
  const nameAndBrand = `${product.productName} ${product.brand}`.trim();

  return [
    { value: product.productName, phraseWeight: 70, tokenWeight: 20, strength: "strong" },
    { value: brandAndName, phraseWeight: 62, tokenWeight: 16, strength: "strong" },
    { value: nameAndBrand, phraseWeight: 58, tokenWeight: 15, strength: "strong" },
    { value: product.brand, phraseWeight: 50, tokenWeight: 14, strength: "strong" },
    { value: product.description, phraseWeight: 36, tokenWeight: 10, strength: "supporting" },
    { value: product.technicalDetails.join(" "), phraseWeight: 32, tokenWeight: 9, strength: "supporting" },
    { value: product.category, phraseWeight: 24, tokenWeight: 7, strength: "weak" },
    { value: product.sectionTitle, phraseWeight: 20, tokenWeight: 6, strength: "weak" },
    { value: product.supplierName, phraseWeight: 12, tokenWeight: 4, strength: "weak" },
  ];
}

type SearchableProductField = ReturnType<typeof searchableProductFields>[number];

function analyzeSearchMatch(fields: SearchableProductField[], needle: string, tokens: string[]) {
  const strongTokens = new Set<string>();
  const supportingTokens = new Set<string>();
  const weakTokens = new Set<string>();
  let strongPhrase = false;
  let supportingPhrase = false;

  for (const field of fields) {
    const value = normalizeSearchText(field.value);

    if (!value) {
      continue;
    }

    const hasPhrase = value === needle || value.startsWith(needle) || value.includes(needle);

    if (hasPhrase && field.strength === "strong") {
      strongPhrase = true;
    }

    if (hasPhrase && field.strength === "supporting") {
      supportingPhrase = true;
    }

    for (const token of tokens) {
      if (!fieldMatchesToken(value, token)) {
        continue;
      }

      if (field.strength === "strong") {
        strongTokens.add(token);
      } else if (field.strength === "supporting") {
        supportingTokens.add(token);
      } else {
        weakTokens.add(token);
      }
    }
  }

  const totalTokens = new Set([...strongTokens, ...supportingTokens, ...weakTokens]);

  return {
    strongTokens: strongTokens.size,
    supportingTokens: supportingTokens.size,
    totalTokens: totalTokens.size,
    strongPhrase,
    supportingPhrase,
  };
}

function isSearchMatchEligible({
  score,
  tokens,
  numericMatch,
  matchQuality,
}: {
  score: number;
  tokens: string[];
  numericMatch: boolean;
  matchQuality: ReturnType<typeof analyzeSearchMatch>;
}) {
  if (score <= 0) {
    return false;
  }

  if (numericMatch) {
    return true;
  }

  if (tokens.length <= 1) {
    return matchQuality.totalTokens > 0 && score >= 30;
  }

  if (matchQuality.strongPhrase || matchQuality.supportingPhrase) {
    return true;
  }

  if (tokens.length === 2) {
    return matchQuality.strongTokens >= 1 && matchQuality.totalTokens === 2;
  }

  const requiredTokenMatches = Math.max(2, Math.ceil(tokens.length * 0.6));
  const requiredStrongMatches = Math.max(1, Math.ceil(requiredTokenMatches / 2));

  return matchQuality.totalTokens >= requiredTokenMatches && matchQuality.strongTokens >= requiredStrongMatches;
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/m²/g, "m2")
    .replace(/×/g, "x")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)\s*x\s*(\d)/g, "$1x$2")
    .replace(/[^a-z0-9æøå.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTokens(value: string) {
  return normalizeSearchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 || /^\d$/.test(token));
}

function fieldMatchesToken(fieldValue: string, token: string) {
  if (!token) {
    return false;
  }

  if (fieldValue.includes(token)) {
    return true;
  }

  const words = fieldValue.split(" ");

  return words.some((word) => {
    if (word.length < 4 || token.length < 4) {
      return false;
    }

    return word.startsWith(token) || token.startsWith(word);
  });
}

export function matchesStorefrontCategory(product: StorefrontProduct, category: string) {
  const needle = category.trim().toLowerCase();

  if (!needle) {
    return true;
  }

  const haystack = [
    product.category,
    product.sectionTitle,
    product.productName,
    product.brand,
    product.description,
    ...product.technicalDetails,
  ]
    .join(" ")
    .toLowerCase();

  if (haystack.includes(needle)) {
    return true;
  }

  const aliases = CATEGORY_FILTER_ALIASES[needle] ?? [];
  return aliases.some((alias) => haystack.includes(alias));
}

function normalizeStorefrontSort(value?: string): StorefrontSortOption {
  switch (value) {
    case "price_asc":
    case "price_desc":
    case "name_asc":
    case "newest":
      return value;
    default:
      return "relevance";
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

function readStringArrayField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    }

    if (typeof value === "string" && value.trim().length > 0) {
      return value
        .split(/\r?\n| \| /)
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }

  return [] as string[];
}

function readNumberField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.replace(/\s+/g, "").replace(",", ".");
      const parsed = Number.parseFloat(normalized);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

async function resolveVectorStoreFileName(
  openai: OpenAI,
  fileId: string,
  attributes?: Record<string, string | number | boolean> | null,
) {
  const namedAttribute = attributes?.filename ?? attributes?.name ?? attributes?.label;

  if (typeof namedAttribute === "string" && namedAttribute.trim().length > 0) {
    return namedAttribute.trim();
  }

  try {
    const file = await openai.files.retrieve(fileId);
    return file.filename?.trim() || fileId;
  } catch {
    return fileId;
  }
}

function detectCsvDelimiter(lines: string[]) {
  const sample = lines.slice(0, 12);
  const semicolonHits = sample.reduce((sum, line) => sum + countDelimiter(line, ";"), 0);
  const commaHits = sample.reduce((sum, line) => sum + countDelimiter(line, ","), 0);

  if (semicolonHits === 0 && commaHits === 0) {
    return null;
  }

  return semicolonHits >= commaHits ? ";" : ",";
}

function countDelimiter(line: string, delimiter: string) {
  let count = 0;
  let inQuotes = false;

  for (const character of line) {
    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && character === delimiter) {
      count += 1;
    }
  }

  return count;
}

function splitDelimitedLine(line: string, delimiter: string) {
  // Supplier CSVs don't use RFC 4180 quoting. A lone `"` inside a product name
  // (e.g. `BASIC 16" 1-79-`) must not toggle a quoted-field mode, otherwise
  // every subsequent `;` is absorbed into the current column. Split on the raw
  // delimiter and let `normalizeCsvColumn` strip stray quote characters.
  return line.split(delimiter);
}

function normalizeCsvColumn(value: string | undefined) {
  return (value ?? "").replaceAll('"', "").trim();
}

function pickCsvNobbNumber(primary: string, secondary: string) {
  const candidates = [primary, secondary];

  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");

    if (digits.length >= 6 && digits.length <= 10) {
      return digits;
    }
  }

  return "";
}

function parseCsvPriceNok(value: string) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const normalized = trimmed.replace(/\s+/g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(normalized);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  // Price lists store øre (integer). Decimal values are assumed to already be kroner.
  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, parsed / 100);
  }

  return Math.max(0, parsed);
}

function parseCsvEan(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 ? digits : undefined;
}

function supplierLabelFromFileName(fileName: string) {
  const normalized = fileName.toLowerCase();

  if (normalized.includes("byggmakker")) {
    return "Byggmakker";
  }

  if (normalized.includes("monter") || normalized.includes("optimera")) {
    return "Monter/Optimera";
  }

  if (normalized.includes("byggmax")) {
    return "Byggmax";
  }

  if (normalized.includes("xl")) {
    return "XL-Bygg";
  }

  return normalized
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function inferCsvBrand(rawValue: string, productName: string) {
  const cleaned = rawValue.trim();

  if (cleaned.length > 0) {
    return cleaned.split(/\s+/).slice(0, 3).join(" ");
  }

  const firstToken = productName.split(/\s+/)[0]?.trim() ?? "";
  return firstToken.length > 1 ? firstToken : "Ukjent merke";
}

function inferCsvSectionTitle(categoryCode: string, productName: string) {
  const normalizedCategory = categoryCode.toLowerCase();
  const compactCategory = normalizedCategory.replace(/^0+/, "");
  const normalizedName = productName.toLowerCase();

  if (compactCategory === "502") {
    return "Konstruksjon og underlag";
  }

  if (compactCategory === "504") {
    return "Kledning og fasade";
  }

  if (compactCategory === "505" || compactCategory === "511") {
    return "Innvendig ferdigstilling";
  }

  if (compactCategory === "506") {
    return "Dekke";
  }

  if (compactCategory === "510") {
    return "Finish";
  }

  if (normalizedCategory.startsWith("tak") || normalizedName.includes("tak")) {
    return "Tak og beslag";
  }

  if (normalizedCategory.startsWith("gulv") || normalizedName.includes("gulv")) {
    return "Gulv og underlag";
  }

  if (normalizedCategory.startsWith("bad") || normalizedName.includes("membran")) {
    return "Bad og membran";
  }

  if (normalizedCategory.startsWith("utv") || normalizedName.includes("terrasse")) {
    return "Utvendig og terrasse";
  }

  if (normalizedCategory.startsWith("iso") || normalizedName.includes("isolasjon")) {
    return "Isolasjon og tetting";
  }

  return "Byggevarer";
}

function inferCsvCategory(categoryCode: string, productName: string) {
  const normalizedCategory = categoryCode.toLowerCase();
  const compactCategory = normalizedCategory.replace(/^0+/, "");
  const normalizedName = productName.toLowerCase();

  if (compactCategory === "502") {
    return "Konstruksjonsvirke";
  }

  if (compactCategory === "504") {
    return "Kledning";
  }

  if (compactCategory === "505" || compactCategory === "511") {
    return "Innvendig ferdigstilling";
  }

  if (compactCategory === "506") {
    return "Terrasse";
  }

  if (compactCategory === "510") {
    return "Overflate";
  }

  if (normalizedName.includes("skrue") || normalizedName.includes("spiker")) {
    return "Festemidler";
  }

  if (normalizedName.includes("gips")) {
    return "Plater";
  }

  if (normalizedName.includes("membran") || normalizedName.includes("primer")) {
    return "Membran";
  }

  if (normalizedName.includes("terrasse") || normalizedName.includes("impregnert")) {
    return "Uteprodukter";
  }

  if (normalizedName.includes("isolasjon")) {
    return "Isolasjon";
  }

  return inferCsvSectionTitle(categoryCode, productName);
}

function inferCsvQuantitySuggestion(unit: string, sectionTitle: string) {
  if (unit === "M2") {
    return "10 m²";
  }

  if (unit === "M") {
    return "12 m";
  }

  if (sectionTitle === "Festemidler") {
    return "1 pk";
  }

  return "1 stk";
}

function inferCsvQuantityReason(unit: string, sectionTitle: string, supplierName: string) {
  return `Mengdeforslag for ${sectionTitle.toLowerCase()} basert på enhet ${unit} og katalog fra ${supplierName}.`;
}
