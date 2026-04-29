import "server-only";

import OpenAI from "openai";

import { cacheLife } from "next/cache";

import { env, hasOpenAiEnv } from "@/lib/env";
import { toVatInclusiveNok } from "@/lib/material-order";
import { applyMarkup, getSupplierMarkups, type SupplierMarkup } from "@/lib/price-markup";
import { getPriceListProducts, type PriceListProduct } from "@/lib/price-lists";
import { filterStorefrontBlacklistedProducts } from "@/lib/storefront-product-blacklist";
import { buildStorefrontNobbImagePath, isAllowedStorefrontImageUrl, STORE_IMAGE_FALLBACK_URL } from "@/lib/storefront-image";
import { scoreStorefrontProductForUserProfile } from "@/lib/storefront-user-profile";
import type {
  StorefrontProduct,
  StorefrontProductQuery,
  StorefrontProductQueryResult,
  StorefrontSortOption,
} from "@/lib/storefront-types";
import { slugify } from "@/lib/utils";

const STOREFRONT_DEFAULT_PAGE_SIZE = 24;

export async function getStorefrontProducts() {
  "use cache";
  cacheLife("minutes");

  const [fromVectorStore, markups, priceListProducts] = await Promise.all([
    loadStorefrontProductsFromVectorStore(),
    getSupplierMarkups(),
    getPriceListProducts(),
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

export async function queryStorefrontProducts(query: StorefrontProductQuery): Promise<StorefrontProductQueryResult> {
  const { products, source, vectorStoreId } = await getStorefrontProducts();
  const q = (query.q ?? "").trim();
  const category = (query.category ?? "").trim();
  const supplier = (query.supplier ?? "").trim();
  const sort = normalizeStorefrontSort(query.sort);
  const userProfile = query.userProfile ?? null;
  const pageSizeLimit = clampNumber(query.pageSizeLimit ?? 60, 1, 5000);
  const pageSize = clampNumber(query.pageSize ?? STOREFRONT_DEFAULT_PAGE_SIZE, 1, pageSizeLimit);
  const page = Math.max(1, Math.round(query.page ?? 1));

  const filtered = products.filter((product) => {
    if (category && !product.category.toLowerCase().includes(category.toLowerCase()) && !product.sectionTitle.toLowerCase().includes(category.toLowerCase())) {
      return false;
    }

    if (supplier && product.supplierName !== supplier) {
      return false;
    }

    if (q.length > 0 && scoreStorefrontProduct(product, q) <= 0) {
      return false;
    }

    return true;
  });

  const sorted = sortStorefrontProducts(filtered, sort, q, userProfile);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const items = sorted.slice(start, start + pageSize);

  const categoryCounts: Record<string, number> = {};
  const supplierCounts: Record<string, number> = {};
  let minPrice = Number.POSITIVE_INFINITY;
  let maxPrice = 0;
  for (const product of products) {
    if (product.category) {
      categoryCounts[product.category] = (categoryCounts[product.category] ?? 0) + 1;
    }
    if (product.supplierName) {
      supplierCounts[product.supplierName] = (supplierCounts[product.supplierName] ?? 0) + 1;
    }
    if (product.unitPriceNok > 0) {
      if (product.unitPriceNok < minPrice) minPrice = product.unitPriceNok;
      if (product.unitPriceNok > maxPrice) maxPrice = product.unitPriceNok;
    }
  }
  if (!Number.isFinite(minPrice)) {
    minPrice = 0;
  }

  return {
    items,
    total,
    page: safePage,
    pageSize,
    totalPages,
    categories: Array.from(new Set(products.map((product) => product.category))).sort((left, right) =>
      left.localeCompare(right, "nb-NO"),
    ),
    suppliers: Array.from(new Set(products.map((product) => product.supplierName))).sort((left, right) =>
      left.localeCompare(right, "nb-NO"),
    ),
    categoryCounts,
    supplierCounts,
    priceRange: { min: Math.floor(minPrice), max: Math.ceil(maxPrice) },
    source,
    vectorStoreId,
  };
}

export async function getStorefrontProductBySlug(slug: string) {
  const { products } = await getStorefrontProducts();
  return products.find((product) => product.slug === slug) ?? null;
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

  const { products } = await getStorefrontProducts();
  const wanted = new Set(ids);
  return products.filter((product) => wanted.has(product.id));
}

export async function getStorefrontProductsByNobb(nobbNumbers: string[]): Promise<StorefrontProduct[]> {
  if (nobbNumbers.length === 0) {
    return [];
  }

  const { products } = await getStorefrontProducts();
  const wantedOrder = new Map(nobbNumbers.map((n, i) => [n, i]));
  return products
    .filter((p) => wantedOrder.has(p.nobbNumber))
    .sort((a, b) => (wantedOrder.get(a.nobbNumber) ?? 99) - (wantedOrder.get(b.nobbNumber) ?? 99));
}

export function getStorefrontImageUrl(product: Pick<StorefrontProduct, "imageUrl" | "nobbNumber">): string {
  if (product.imageUrl && isAllowedStorefrontImageUrl(product.imageUrl)) {
    return product.imageUrl;
  }

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
    const altNobbCandidate = normalizeCsvColumn(columns[isSemicolon ? 14 : -1]);
    const brandOrSeries = normalizeCsvColumn(columns[isSemicolon ? 9 : 2]);
    const nobbNumber = pickCsvNobbNumber(nobbCandidate, altNobbCandidate);

    if (!nobbNumber || !productName) {
      continue;
    }

    const normalizedPriceUnit = (priceUnit || salesUnit || "STK").toUpperCase();
    const normalizedSalesUnit = (salesUnit || normalizedPriceUnit).toUpperCase();
    const packageAreaSqm = parsePackageAreaSqm(descriptionRaw);
    const unit = normalizedSalesUnit;
    const priceNok = parseCsvPriceNok(pricePrimary) ?? parseCsvPriceNok(priceSecondary) ?? 0;
    const listPriceNok = parseCsvPriceNok(priceSecondary) ?? priceNok;

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
          packageAreaSqm ? `Pakningsinnhold: ${formatDecimalNo(packageAreaSqm)} m²` : "",
        ].filter((value) => value.length > 0),
        quantitySuggestion: inferCsvQuantitySuggestion(unit, inferCsvSectionTitle(categoryCode, productName)),
        quantityReason: inferCsvQuantityReason(unit, inferCsvSectionTitle(categoryCode, productName), supplierName),
        lastUpdated,
        source: "vector_store",
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
  const packageAreaSqm = product.packageAreaSqm ?? parsePackageAreaSqm(product.description);

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
    ...(packageAreaSqm ? { packageAreaSqm } : {}),
    unitPriceNok: Math.max(0, Math.round(product.unitPriceNok)),
    listPriceNok: Math.max(0, Math.round(product.listPriceNok || product.unitPriceNok)),
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

// Prislisten (Varekategori-kolonnen) er autoritativ for kategorisering.
// Vector-store-indeksen kan inneholde utdaterte kategorier, så vi overlegger
// category/sectionTitle fra prislisten matchet på NOBB-nummer.
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
      category: nextCategory || product.category,
      sectionTitle: nextSection || product.sectionTitle,
      unit: match.salesUnit || match.unit || product.unit,
      priceUnit: match.priceUnit || product.priceUnit,
      salesUnit: match.salesUnit || product.salesUnit,
      ...(match.packageAreaSqm ? { packageAreaSqm: match.packageAreaSqm } : {}),
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

function applyStorefrontPricing(products: StorefrontProduct[], markups: SupplierMarkup[]): StorefrontProduct[] {
  return products.map((product) => {
    // Salgs-/minpris: markup + MVA.
    // Førpris = veiledende pris fra prisliste + MVA (ingen pålegg).
    // Ikke tillat at salgsprisen overstiger førpris (veil.pris m/MVA).
    const listWithVat = product.listPriceNok > 0 ? toVatInclusiveNok(product.listPriceNok) : 0;
    const markedUnit = applyMarkup(product.unitPriceNok, product.supplierName, markups);
    const unitWithVat = toVatInclusiveNok(markedUnit);
    const cappedUnitWithVat =
      listWithVat > 0 && unitWithVat > 0 ? Math.min(unitWithVat, listWithVat) : unitWithVat;

    return {
      ...product,
      unitPriceNok: cappedUnitWithVat,
      listPriceNok: listWithVat || cappedUnitWithVat,
    };
  });
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

    const leftRelevance = scoreStorefrontProduct(left, q) + scoreStorefrontProductForUserProfile(left, userProfile);
    const rightRelevance = scoreStorefrontProduct(right, q) + scoreStorefrontProductForUserProfile(right, userProfile);

    return (
      rightRelevance - leftRelevance ||
      left.productName.localeCompare(right.productName, "nb-NO")
    );
  });
}

function scoreStorefrontProduct(product: StorefrontProduct, q: string) {
  const needle = q.trim().toLowerCase();

  if (!needle) {
    return 1;
  }

  const productName = product.productName.toLowerCase();
  const category = product.category.toLowerCase();
  const sectionTitle = product.sectionTitle.toLowerCase();
  const supplierName = product.supplierName.toLowerCase();
  const brand = product.brand.toLowerCase();
  const description = product.description.toLowerCase();
  const nobbNumber = product.nobbNumber.toLowerCase();

  if (productName === needle || nobbNumber === needle) {
    return 100;
  }

  let score = 0;

  if (productName.startsWith(needle)) {
    score += 60;
  }

  if (productName.includes(needle)) {
    score += 40;
  }

  if (brand.includes(needle)) {
    score += 15;
  }

  if (category.includes(needle) || sectionTitle.includes(needle)) {
    score += 12;
  }

  if (supplierName.includes(needle)) {
    score += 10;
  }

  if (description.includes(needle)) {
    score += 6;
  }

  if (nobbNumber.includes(needle)) {
    score += 25;
  }

  const tokens = needle.split(/\s+/).filter(Boolean);

  if (tokens.length > 1) {
    score += tokens.reduce((sum, token) => sum + scoreStorefrontProduct(product, token), 0);
  }

  return score;
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

function parsePackageAreaSqm(raw: string) {
  const normalized = raw.replace(/m²/gi, "M2");
  const match = normalized.match(/(\d+(?:[,.]\d+)?)\s*M2\s*(?:PR|PER)?\s*(?:PK|PAK|PAKKE)\b/i);

  if (!match) {
    return undefined;
  }

  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function formatDecimalNo(value: number) {
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(value);
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
