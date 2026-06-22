import "server-only";
import path from "node:path";

import OpenAI from "openai";

import { cacheLife } from "next/cache";

import { env, hasOpenAiEnv } from "@/lib/env";
import {
  describeSalesUnitQuantity,
  parseSalesUnitQuantity,
  priceForSalesUnit,
} from "@/lib/product-unit-pricing";

export type PriceListProduct = {
  id: string;
  nobbNumber: string;
  productName: string;
  supplierName: string;
  brand: string;
  unit: string;
  priceUnit: string;
  salesUnit: string;
  salesUnitQuantity?: number;
  packageAreaSqm?: number;
  priceNok: number;
  listPriceNok: number;
  sectionTitle: string;
  category: string;
  description: string;
  ean?: string;
  datasheetUrl?: string;
  imageUrl?: string;
  technicalDetails: string[];
  quantitySuggestion: string;
  quantityReason: string;
  lastUpdated: string;
};

export async function getPriceListProducts() {
  "use cache";
  cacheLife("hours");

  return getOpenAiVectorStorePriceListProducts();
}

/**
 * Loads price-list products directly from the OpenAI vector store.
 * This is the EXPENSIVE path (downloads + parses every vector-store file) and
 * must only run inside the scheduled catalog-refresh job — never on the request
 * path. The request path reads the snapshot from Postgres instead.
 */
export async function loadPriceListProductsFromVectorStore() {
  return getOpenAiVectorStorePriceListProducts();
}

export async function getPriceListProductByNobb(nobbNumber: string) {
  const normalized = nobbNumber.trim();

  if (!normalized) {
    return null;
  }

  const products = await getPriceListProducts();
  const matches = products.filter((product) => product.nobbNumber === normalized);

  if (matches.length === 0) {
    return null;
  }

  return matches.reduce((best, current) => (current.priceNok < best.priceNok ? current : best));
}

async function getOpenAiVectorStorePriceListProducts() {
  if (!hasOpenAiEnv()) {
    return [] as PriceListProduct[];
  }

  const vectorStoreId = env.openAiVectorStoreIdStorefront.trim();

  if (!vectorStoreId) {
    return [] as PriceListProduct[];
  }

  try {
    const openai = new OpenAI({ apiKey: env.openAiApiKey });
    const vectorStore = await openai.vectorStores.retrieve(vectorStoreId);

    if (vectorStore.status === "expired") {
      return [] as PriceListProduct[];
    }

    const products: PriceListProduct[] = [];

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

      products.push(...parsePriceListProductsFromVectorFile(rawContent, fileName));
    }

    return products;
  } catch (error) {
    console.warn(
      "[price-lists] Kunne ikke lese prisfil fra OpenAI vector-store:",
      error instanceof Error ? error.message : String(error),
    );
    return [] as PriceListProduct[];
  }
}

export function parsePriceListProductsFromVectorFile(
  rawContent: string,
  fileName: string,
  lastUpdated = new Date().toISOString().slice(0, 10),
) {
  const fromJson = parsePriceListProductsFromJson(rawContent, fileName, lastUpdated);

  if (fromJson.length > 0) {
    return fromJson;
  }

  const fromNdjson = parsePriceListProductsFromNdjson(rawContent, fileName, lastUpdated);

  if (fromNdjson.length > 0) {
    return fromNdjson;
  }

  return parsePriceListProductsFromDelimitedText(rawContent, fileName, lastUpdated);
}

function parsePriceListProductsFromJson(rawContent: string, fileName: string, lastUpdated: string) {
  try {
    const parsed = JSON.parse(rawContent) as unknown;
    return normalizePriceListProductsFromUnknown(parsed, fileName, lastUpdated);
  } catch {
    return [] as PriceListProduct[];
  }
}

function parsePriceListProductsFromNdjson(rawContent: string, fileName: string, lastUpdated: string) {
  const lines = rawContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));

  if (lines.length === 0) {
    return [] as PriceListProduct[];
  }

  const products: PriceListProduct[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      products.push(...normalizePriceListProductsFromUnknown(parsed, fileName, lastUpdated));
    } catch {
      continue;
    }
  }

  return products;
}

function normalizePriceListProductsFromUnknown(raw: unknown, fileName: string, lastUpdated: string): PriceListProduct[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => normalizePriceListProductsFromUnknown(entry, fileName, lastUpdated));
  }

  if (!raw || typeof raw !== "object") {
    return [] as PriceListProduct[];
  }

  const record = raw as Record<string, unknown>;

  if (Array.isArray(record.items)) {
    return normalizePriceListProductsFromUnknown(record.items, fileName, lastUpdated);
  }

  if (Array.isArray(record.products)) {
    return normalizePriceListProductsFromUnknown(record.products, fileName, lastUpdated);
  }

  const productName = readStringField(record, ["productName", "product_name", "item", "title", "name"]);
  const nobbNumber = pickNobbNumber(
    readStringField(record, ["nobbNumber", "nobb", "nobb_number"]),
    readStringField(record, ["supplierSku", "supplier_sku", "articleNumber", "article_number"]),
  );

  if (!productName || !nobbNumber) {
    return [] as PriceListProduct[];
  }

  const supplierName = readStringField(record, ["supplierName", "supplier_name", "supplier"]) || supplierLabelFromFileName(fileName);
  const description = readStringField(record, ["description", "comment", "details"]) || productName;
  const priceUnit = normalizeProductUnit(readStringField(record, ["priceUnit", "price_unit", "pricingUnit", "pricing_unit"]), "STK");
  const salesUnit = normalizeProductUnit(readStringField(record, ["salesUnit", "sales_unit", "sellingUnit", "selling_unit"]), priceUnit);
  const salesUnitQuantity =
    readNumberField(record, ["salesUnitQuantity", "sales_unit_quantity", "quantityPerSalesUnit", "quantity_per_sales_unit"]) ??
    parseSalesUnitQuantity(description, priceUnit, salesUnit);
  const rawPriceNok = readNumberField(record, ["priceNok", "price_nok", "unitPriceNok", "unit_price_nok", "price"]);
  const rawListPriceNok = readNumberField(record, ["listPriceNok", "list_price_nok", "veiledendePrisNok", "compareAtPriceNok"]);
  const priceNok = priceForSalesUnit(rawPriceNok ?? rawListPriceNok ?? 0, {
    priceUnit,
    salesUnit,
    salesUnitQuantity,
  });
  const listPriceNok = priceForSalesUnit(rawListPriceNok ?? rawPriceNok ?? 0, {
    priceUnit,
    salesUnit,
    salesUnitQuantity,
  });
  const sectionTitle = readStringField(record, ["sectionTitle", "section_title", "section"]) || inferSectionTitle("", productName);
  const category = readStringField(record, ["category", "categoryName", "category_name"]) || inferCategory("", productName);
  const salesUnitQuantityDetail = describeSalesUnitQuantity({ priceUnit, salesUnit, salesUnitQuantity });
  const technicalDetails = [
    ...readStringArrayField(record, ["technicalDetails", "technical_details", "specs"]),
    description,
    `Prisenhet: ${priceUnit}`,
    `Salgsenhet: ${salesUnit}`,
    salesUnitQuantityDetail,
  ].filter((value) => value.length > 0);

  return [
    {
      id: readStringField(record, ["id", "productId"]) || `${slugifyPriceListId(supplierName)}-${nobbNumber}`,
      nobbNumber,
      productName,
      supplierName,
      brand: readStringField(record, ["brand", "brandName", "brand_name"]) || inferBrand("", productName),
      unit: salesUnit,
      priceUnit,
      salesUnit,
      ...(salesUnitQuantity ? { salesUnitQuantity } : {}),
      ...(priceUnit === "M2" && salesUnitQuantity ? { packageAreaSqm: salesUnitQuantity } : {}),
      priceNok,
      listPriceNok,
      sectionTitle,
      category,
      description,
      ...(readStringField(record, ["ean", "eanNumber", "ean_number"]) ? { ean: readStringField(record, ["ean", "eanNumber", "ean_number"]) } : {}),
      ...(readStringField(record, ["datasheetUrl", "datasheet_url"]) ? { datasheetUrl: readStringField(record, ["datasheetUrl", "datasheet_url"]) } : {}),
      ...(readStringField(record, ["imageUrl", "image_url"]) ? { imageUrl: readStringField(record, ["imageUrl", "image_url"]) } : {}),
      technicalDetails: Array.from(new Set(technicalDetails)).slice(0, 8),
      quantitySuggestion: readStringField(record, ["quantitySuggestion", "quantity_suggestion"]) || inferQuantitySuggestion(salesUnit, sectionTitle),
      quantityReason: readStringField(record, ["quantityReason", "quantity_reason"]) || inferQuantityReason(salesUnit, sectionTitle, supplierName),
      lastUpdated: readStringField(record, ["lastUpdated", "last_updated"]) || lastUpdated,
    },
  ];
}

function parsePriceListProductsFromDelimitedText(rawContent: string, fileName: string, lastUpdated: string) {
  const lines = rawContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const delimiter = detectDelimitedTextDelimiter(lines);

  if (!delimiter) {
    return [] as PriceListProduct[];
  }

  const supplierKey = path.basename(fileName, path.extname(fileName)).toLowerCase();
  const supplierName = supplierLabelFromFileName(supplierKey);
  const products: PriceListProduct[] = [];

  for (const line of lines) {
    const columns = splitDelimitedLine(line, delimiter);
    const isSemicolon = delimiter === ";";
    const categoryCode = normalizeColumn(columns[isSemicolon ? 0 : 9]);
    const eanRaw = normalizeColumn(columns[isSemicolon ? 1 : -1]);
    const nobbCandidate = normalizeColumn(columns[isSemicolon ? 2 : 0]);
    const productName = normalizeColumn(columns[isSemicolon ? 4 : 1]);
    const pricePrimary = normalizeColumn(columns[6]);
    const priceSecondary = normalizeColumn(columns[isSemicolon ? 5 : 4]);
    const priceUnit = normalizeColumn(columns[7]);
    const descriptionRaw = normalizeColumn(columns[isSemicolon ? 9 : 2]);
    const salesUnit = normalizeColumn(columns[isSemicolon ? 10 : 7]);
    const salesUnitQuantityRaw = normalizeColumn(columns[isSemicolon ? 11 : -1]);
    const brandOrSeries = normalizeColumn(columns[isSemicolon ? 9 : 2]);
    const altNobbCandidate = normalizeColumn(columns[isSemicolon ? 14 : -1]);
    const nobbNumber = pickNobbNumber(nobbCandidate, altNobbCandidate);

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
    const priceUnitPriceNok = parsePriceNok(pricePrimary) ?? parsePriceNok(priceSecondary) ?? 0;
    const listPriceUnitNok = parsePriceNok(priceSecondary) ?? priceUnitPriceNok;
    const priceNok = priceForSalesUnit(priceUnitPriceNok, {
      priceUnit: normalizedPriceUnit,
      salesUnit: normalizedSalesUnit,
      salesUnitQuantity,
    });
    const listPriceNok = priceForSalesUnit(listPriceUnitNok, {
      priceUnit: normalizedPriceUnit,
      salesUnit: normalizedSalesUnit,
      salesUnitQuantity,
    });
    const sectionTitle = inferSectionTitle(categoryCode, productName);
    const category = inferCategory(categoryCode, productName);
    const salesUnitQuantityDetail = describeSalesUnitQuantity({
      priceUnit: normalizedPriceUnit,
      salesUnit: normalizedSalesUnit,
      salesUnitQuantity,
    });
    const technicalDetails = [
      descriptionRaw,
      `Prisenhet: ${normalizedPriceUnit}`,
      `Salgsenhet: ${normalizedSalesUnit}`,
      salesUnitQuantityDetail,
    ].filter((value) => value.length > 0);

    products.push({
      id: `${supplierKey}-${nobbNumber}`,
      nobbNumber,
      productName,
      supplierName,
      brand: inferBrand(brandOrSeries, productName),
      unit: normalizedSalesUnit,
      priceUnit: normalizedPriceUnit,
      salesUnit: normalizedSalesUnit,
      ...(salesUnitQuantity ? { salesUnitQuantity } : {}),
      ...(packageAreaSqm ? { packageAreaSqm } : {}),
      priceNok,
      listPriceNok,
      sectionTitle,
      category,
      description: descriptionRaw || productName,
      ean: parseEan(eanRaw) ?? undefined,
      technicalDetails,
      quantitySuggestion: inferQuantitySuggestion(normalizedSalesUnit, sectionTitle),
      quantityReason: inferQuantityReason(normalizedSalesUnit, sectionTitle, supplierName),
      lastUpdated,
    });
  }

  return products;
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

function normalizeProductUnit(value: string, fallback: string) {
  return (value || fallback).trim().toUpperCase().replace("M²", "M2") || fallback;
}

function detectDelimitedTextDelimiter(lines: string[]) {
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

  for (const character of line) {
    if (character === delimiter) {
      count += 1;
    }
  }

  return count;
}

function splitDelimitedLine(line: string, delimiter: string) {
  return line.split(delimiter);
}

function slugifyPriceListId(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "produkt";
}

function supplierLabelFromFileName(fileName: string) {
  const normalized = fileName.toLowerCase();

  if (normalized === "byggmakker") {
    return "Byggmakker";
  }

  if (normalized === "monter" || normalized === "optimera" || normalized === "monter_optimera") {
    return "Monter/Optimera";
  }

  if (normalized === "byggmax") {
    return "Byggmax";
  }

  if (normalized === "xl_bygg" || normalized === "xl-bygg" || normalized === "xlbygg") {
    return "XL-Bygg";
  }

  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalizeColumn(value: string | undefined) {
  return (value ?? "").replaceAll('"', "").trim();
}

function pickNobbNumber(primary: string, secondary: string) {
  const primaryDigits = primary.replace(/\D/g, "");
  const secondaryDigits = secondary.replace(/\D/g, "");

  if (primaryDigits.length >= 6) {
    return primaryDigits;
  }

  if (secondaryDigits.length >= 6) {
    return secondaryDigits;
  }

  return "";
}

function parsePriceNok(raw: string) {
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(",", ".").replace(/\s/g, "");
  const numeric = Number(normalized);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (/^\d+$/.test(raw)) {
    return Math.max(0, Math.round(numeric) / 100);
  }

  return Math.max(0, numeric);
}

function parseEan(raw: string) {
  if (!raw) {
    return null;
  }

  const directDigits = raw.replace(/\D/g, "");

  if (directDigits.length >= 8) {
    return directDigits;
  }

  const normalized = raw.replace(",", ".");
  const numeric = Number(normalized);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  const ean = Math.round(numeric).toString();
  return ean.length >= 8 ? ean : null;
}

// NOBB Varekategori-kode → lesbar kategori.
// Kodene i CSV-ene er zero-padded (f.eks. "0502", "1130"). Dette er primærkilden
// for kategorisering – tekstheuristikk brukes bare som siste fallback.
const CATEGORY_BY_CODE: Record<string, string> = {
  // Trelast og konstruksjon
  "0502": "Konstruksjonsvirke",
  "0504": "Kledning",
  "0505": "Innvendig panel",
  "0506": "Terrasse",
  "0508": "Gjerde og stolper",
  "0509": "Limtre",
  "0510": "Gulv",
  "0511": "Lister",
  "0512": "Lister",
  "0513": "Lister",
  // Mur, betong og grunn
  "0601": "Mur og betong",
  "0602": "Mur og betong",
  "0605": "Mur og betong",
  "0610": "Mur og betong",
  "0615": "Mur og betong",
  // Stål og tak
  "0703": "Stålprofiler",
  "0707": "Stålprofiler",
  "0710": "Taktekking",
  // Armering
  "0812": "Armering",
  "0830": "Armering",
  // Plater (gips, OSB, spon, finer, MDF, sement)
  "0910": "Gips og plater",
  "0920": "Gips og plater",
  "0935": "Gips og plater",
  "0940": "Gips og plater",
  "0950": "Gips og plater",
  "0960": "Gips og plater",
  "0965": "Gips og plater",
  "0970": "Gips og plater",
  "0980": "Gips og plater",
  // Takbeslag og takrenner
  "1020": "Takbeslag",
  "1021": "Takbeslag",
  "1022": "Takbeslag",
  "1023": "Takbeslag",
  "1024": "Takbeslag",
  // Isolasjon og tetting
  "1130": "Isolasjon",
  "1131": "Spileplater og akustikk",
  "1140": "Tetting og fukt",
  // Innredning
  "1214": "Innredning",
  "1226": "Innredning",
  // Dører, porter og vinduer
  "1310": "Dører",
  "1340": "Dører",
  "1350": "Garasjeport",
  "1355": "Dører",
  "1410": "Vinduer",
  "1452": "Ventilasjon",
  // Baderom og gulvbelegg
  "1510": "Baderom",
  "1512": "Baderom",
  "1513": "Gulvbelegg",
  "1523": "Tetting og fukt",
  "1525": "Gulvbelegg",
  "1568": "Lim og fuge",
  "1580": "Lister",
  "1584": "Tapet og vegg",
  "1598": "Tilbud og restesalg",
  // Jernvarer og tilbehør
  "1601": "Jernvarer",
  "1602": "Jernvarer",
  "1603": "Jernvarer",
  "1604": "Jernvarer",
  "1605": "Jernvarer",
  "1606": "Jernvarer",
  "1607": "Jernvarer",
  "1608": "Jernvarer",
  "1612": "Jernvarer",
  "1634": "Tilbehør",
  "1637": "Sikkerhet",
  "1638": "Sikkerhet",
  "1641": "Tilbehør",
  "1642": "Tilbehør",
  "1650": "Tilbehør",
  "1655": "Jernvarer",
  // Festemidler
  "1701": "Festemidler",
  "1704": "Festemidler",
  "1706": "Festemidler",
  "1708": "Festemidler",
  "1714": "Festemidler",
  "1715": "Festemidler",
  "1720": "Festemidler",
  "1725": "Festemidler",
  "1726": "Festemidler",
  "1730": "Festemidler",
  "1732": "Festemidler",
  "1740": "Festemidler",
  "1780": "Festemidler",
  // Håndverktøy
  "1843": "Håndverktøy",
  "1844": "Håndverktøy",
  "1845": "Håndverktøy",
  "1846": "Håndverktøy",
  "1847": "Håndverktøy",
  "1850": "Håndverktøy",
  "1852": "Håndverktøy",
  "1853": "Håndverktøy",
  "1854": "Pensler og ruller",
  "1855": "Håndverktøy",
  "1858": "Håndverktøy",
  "1859": "Håndverktøy",
  "1860": "Håndverktøy",
  // Elektroverktøy og maskiner
  "1959": "Elverktøy",
  "1962": "Elverktøy",
  "1963": "Elverktøy",
  "1965": "Elverktøy",
  "1967": "Elverktøy",
  "1968": "Elverktøy",
  "1969": "Elverktøy",
  "1972": "Elverktøy",
  "1973": "Elverktøy",
  "1974": "Elverktøy",
  "1980": "Elverktøy",
  "1985": "Elverktøy",
  // Maling, kjemi og forbruk
  "2002": "Overflatebehandling",
  "2004": "Maling",
  "2007": "Maling",
  "2010": "Overflatebehandling",
  "2011": "Forbruksvarer",
  "2014": "Overflatebehandling",
  "2017": "Overflatebehandling",
  "2020": "Lim og fuge",
  "2022": "Lim og fuge",
  "2024": "Sparkel",
  "2026": "Tetting og fukt",
  "2028": "Maling",
  "2029": "Maling",
  "2031": "Forbruksvarer",
};

// Kategori → grovere seksjon (for materialliste-grupperinger).
const SECTION_BY_CATEGORY: Record<string, string> = {
  "Konstruksjonsvirke": "Konstruksjon og underlag",
  "Limtre": "Konstruksjon og underlag",
  "Armering": "Konstruksjon og underlag",
  "Mur og betong": "Konstruksjon og underlag",
  "Stålprofiler": "Konstruksjon og underlag",
  "Kledning": "Kledning og fasade",
  "Taktekking": "Kledning og fasade",
  "Takbeslag": "Kledning og fasade",
  "Gjerde og stolper": "Kledning og fasade",
  "Terrasse": "Dekke",
  "Gulv": "Dekke",
  "Gulvbelegg": "Dekke",
  "Gips og plater": "Innvendig ferdigstilling",
  "Innvendig panel": "Innvendig ferdigstilling",
  "Lister": "Innvendig ferdigstilling",
  "Spileplater og akustikk": "Innvendig ferdigstilling",
  "Baderom": "Innvendig ferdigstilling",
  "Innredning": "Innvendig ferdigstilling",
  "Dører": "Innvendig ferdigstilling",
  "Vinduer": "Innvendig ferdigstilling",
  "Garasjeport": "Innvendig ferdigstilling",
  "Isolasjon": "Teknisk klargjøring",
  "Tetting og fukt": "Teknisk klargjøring",
  "Ventilasjon": "Teknisk klargjøring",
  "Maling": "Finish",
  "Overflatebehandling": "Finish",
  "Sparkel": "Finish",
  "Lim og fuge": "Finish",
  "Tapet og vegg": "Finish",
  "Pensler og ruller": "Finish",
  "Festemidler": "Jernvarer og feste",
  "Jernvarer": "Jernvarer og feste",
  "Håndverktøy": "Verktøy",
  "Elverktøy": "Verktøy",
  "Tilbehør": "Verktøy",
  "Sikkerhet": "Verktøy",
  "Forbruksvarer": "Verktøy",
  "Tilbud og restesalg": "Tilbud",
};

function inferCategory(categoryCode: string, productName: string) {
  const fromCode = CATEGORY_BY_CODE[categoryCode];
  if (fromCode) {
    return fromCode;
  }

  const text = productName.toLowerCase();

  if (/glava|rockwool|isolasjon|jackofoam|jackopor|cellplast/i.test(text)) {
    return "Isolasjon";
  }
  if (/skrue|spiker|beslag|bolt|mutter|skive/i.test(text)) {
    return "Festemidler";
  }
  if (/primer|fuktsperre|dampsperre|tape|skum|membran/i.test(text)) {
    return "Tetting og fukt";
  }
  if (/maling|lakk|beis|olje|pensel/i.test(text)) {
    return "Maling";
  }
  if (/list|sparkel|fug|akryl/i.test(text)) {
    return "Overflatebehandling";
  }
  if (/terrasse|altan|rekk/i.test(text)) {
    return "Terrasse";
  }
  if (/virke|k-virke|lekt|bjelke|forskaling/i.test(text)) {
    return "Konstruksjonsvirke";
  }
  if (/gips|plate|osb|spon|finer|mdf/i.test(text)) {
    return "Gips og plater";
  }

  return "Generelt";
}

function inferSectionTitle(categoryCode: string, productName: string) {
  const category = inferCategory(categoryCode, productName);
  const section = SECTION_BY_CATEGORY[category];
  if (section) {
    return section;
  }

  const text = productName.toLowerCase();
  if (/terrasse|altan|rekk/i.test(text)) {
    return "Dekke";
  }
  if (/skrue|beslag|lekt|virke|k-virke|forskaling/i.test(text)) {
    return "Konstruksjon og underlag";
  }
  if (/primer|fuktsperre|dampsperre|tape|skum/i.test(text)) {
    return "Teknisk klargjøring";
  }
  if (/list|sparkel|fug|akryl|maling/i.test(text)) {
    return "Finish";
  }

  return "Uklassifisert";
}

function inferBrand(brandOrSeries: string, productName: string) {
  if (brandOrSeries) {
    return brandOrSeries;
  }

  const firstWord = productName.split(" ")[0];
  return firstWord || "Byggmakker";
}

function inferQuantitySuggestion(unit: string, sectionTitle: string) {
  if (unit === "LM") {
    return sectionTitle === "Dekke" ? "25 lm" : "10 lm";
  }
  if (unit === "STK") {
    return "10 stk";
  }
  if (unit === "PAK") {
    return "1 pak";
  }
  if (unit === "SET") {
    return "1 sett";
  }

  return `1 ${unit.toLowerCase()}`;
}

function inferQuantityReason(unit: string, sectionTitle: string, supplierName: string) {
  return `Mengdeforslaget er avledet fra enhetskode (${unit}) i ${supplierName}-prislisten og kategorien "${sectionTitle}".`;
}
