import { NextResponse } from "next/server";

import { env, hasNobbApiEnv } from "@/lib/env";
import { getPriceListProductByNobb } from "@/lib/price-lists";

const EXTERNAL_NOBB_TIMEOUT_MS = 8_000;
const EXTERNAL_NOBB_CACHE_TTL_MS = 5 * 60 * 1_000;

const externalNobbCache = new Map<
  string,
  {
    expiresAt: number;
    value: NobbDetailsResponse;
  }
>();

type RouteContext = {
  params: Promise<{
    nobb: string;
  }>;
};

type NobbDetailsResponse = {
  nobbNumber: string;
  productName: string;
  description: string;
  brand: string;
  supplierName: string;
  category: string;
  unit: string;
  unitPriceNok: number;
  listPriceNok?: number;
  ean?: string;
  datasheetUrl?: string;
  imageUrl?: string;
  technicalDetails: string[];
  lastUpdated?: string;
  source: "nobb_api" | "prislister";
};

export async function GET(_request: Request, context: RouteContext) {
  const { nobb } = await context.params;
  const nobbNumber = nobb.trim();

  if (!nobbNumber) {
    return NextResponse.json({ error: "Ugyldig NOBB-nummer." }, { status: 400 });
  }

  if (hasNobbApiEnv()) {
    const cachedExternal = getCachedExternalNobbDetails(nobbNumber);

    if (cachedExternal) {
      return NextResponse.json(cachedExternal);
    }

    const external = await fetchExternalNobbDetails(nobbNumber);

    if (external) {
      setCachedExternalNobbDetails(nobbNumber, external);
      return NextResponse.json(external);
    }
  }

  const localProduct = await getPriceListProductByNobb(nobbNumber);
  const localDetails = localProduct
    ? toResponseFromLocal(localProduct)
    : null;

  if (localDetails) {
    return NextResponse.json(localDetails);
  }

  return NextResponse.json(
    { error: "Fant ikke produktinformasjon for NOBB-nummeret." },
    { status: 404 },
  );
}

function toResponseFromLocal(product: NonNullable<Awaited<ReturnType<typeof getPriceListProductByNobb>>>): NobbDetailsResponse {
  return {
    nobbNumber: product.nobbNumber,
    productName: product.productName,
    description: product.description,
    brand: product.brand,
    supplierName: product.supplierName,
    category: product.category,
    unit: product.unit,
    unitPriceNok: product.priceNok,
    listPriceNok: product.listPriceNok,
    ean: product.ean,
    datasheetUrl: product.datasheetUrl,
    imageUrl: product.imageUrl,
    technicalDetails: product.technicalDetails,
    lastUpdated: product.lastUpdated,
    source: "prislister",
  };
}

async function fetchExternalNobbDetails(nobbNumber: string): Promise<NobbDetailsResponse | null> {
  try {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), EXTERNAL_NOBB_TIMEOUT_MS);
    let response: Response;

    try {
      const url = `${env.nobbApiBaseUrl.replace(/\/$/, "")}/products/${encodeURIComponent(nobbNumber)}`;
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${env.nobbApiKey}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const name = readString(payload, ["productName", "name", "itemName"]);

    if (!name) {
      return null;
    }

    return {
      nobbNumber,
      productName: name,
      description: readString(payload, ["description", "shortDescription"]) ?? "",
      brand: readString(payload, ["brand", "brandName"]) ?? "Ukjent",
      supplierName: readString(payload, ["supplierName", "supplier"]) ?? "Ukjent",
      category: readString(payload, ["category", "categoryName"]) ?? "Generelt",
      unit: readString(payload, ["unit", "salesUnit"]) ?? "stk",
      unitPriceNok: readNumber(payload, ["unitPriceNok", "price", "priceNok"]) ?? 0,
      ean: readString(payload, ["ean", "gtin"]) ?? undefined,
      datasheetUrl: readString(payload, ["datasheetUrl", "dataSheetUrl"]) ?? undefined,
      imageUrl: readString(payload, ["imageUrl", "image"]) ?? undefined,
      technicalDetails: readStringArray(payload, ["technicalDetails", "specifications"]),
      lastUpdated: readString(payload, ["lastUpdated", "updatedAt"]) ?? undefined,
      source: "nobb_api",
    };
  } catch {
    return null;
  }
}

function getCachedExternalNobbDetails(nobbNumber: string) {
  const cached = externalNobbCache.get(nobbNumber);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    externalNobbCache.delete(nobbNumber);
    return null;
  }

  return cached.value;
}

function setCachedExternalNobbDetails(nobbNumber: string, value: NobbDetailsResponse) {
  externalNobbCache.set(nobbNumber, {
    expiresAt: Date.now() + EXTERNAL_NOBB_CACHE_TTL_MS,
    value,
  });
}

function readString(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readNumber(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function readStringArray(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    }
  }

  return [];
}
