import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

export type PriceListProduct = {
  id: string;
  nobbNumber: string;
  productName: string;
  supplierName: string;
  brand: string;
  unit: string;
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

const PRIVATE_PRICE_LIST_DIR = path.join(process.cwd(), ".private", "prislister");
const LEGACY_PRICE_LIST_DIR = path.join(process.cwd(), "prislister");
const PRICE_LIST_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedPriceListProducts: {
  expiresAt: number;
  products: PriceListProduct[];
} | null = null;
let priceListProductsInFlight: Promise<PriceListProduct[]> | null = null;

export async function getPriceListProducts() {
  const now = Date.now();

  if (cachedPriceListProducts && cachedPriceListProducts.expiresAt > now) {
    return cachedPriceListProducts.products;
  }

  if (priceListProductsInFlight) {
    return priceListProductsInFlight;
  }

  priceListProductsInFlight = (async () => {
    const csvPaths = await resolvePriceListCsvPaths();

    if (csvPaths.length === 0) {
      cachedPriceListProducts = {
        expiresAt: Date.now() + PRICE_LIST_CACHE_TTL_MS,
        products: [],
      };
      return [];
    }

    const productGroups = await Promise.all(csvPaths.map((csvPath) => parseSupplierCsv(csvPath)));
    const products = productGroups.flat();

    cachedPriceListProducts = {
      expiresAt: Date.now() + PRICE_LIST_CACHE_TTL_MS,
      products,
    };

    return products;
  })();

  try {
    return await priceListProductsInFlight;
  } finally {
    priceListProductsInFlight = null;
  }
}

function decodePriceListCsv(rawBuffer: Buffer) {
  const utf8 = rawBuffer.toString("utf8");

  // Some supplier exports are ISO-8859/Windows-1252; UTF-8 decoding then corrupts ae/oe/aa.
  if (utf8.includes("\uFFFD") || /Ã¦|Ã¸|Ã¥|Ã†|Ã˜|Ã…/.test(utf8)) {
    return rawBuffer.toString("latin1");
  }

  return utf8;
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

async function resolvePriceListCsvPaths() {
  const privatePaths = await listCsvFilesInDir(PRIVATE_PRICE_LIST_DIR);

  if (privatePaths.length > 0) {
    return privatePaths;
  }

  return listCsvFilesInDir(LEGACY_PRICE_LIST_DIR);
}

async function listCsvFilesInDir(dirPath: string) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
      .map((entry) => path.join(dirPath, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function parseSupplierCsv(csvPath: string): Promise<PriceListProduct[]> {
  try {
    const [rawBuffer, stats] = await Promise.all([fs.readFile(csvPath), fs.stat(csvPath)]);
    const raw = decodePriceListCsv(rawBuffer);
    const supplierKey = path.basename(csvPath, ".csv").toLowerCase();
    const supplierName = supplierLabelFromFileName(supplierKey);
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const lastUpdated = stats.mtime.toISOString().slice(0, 10);
    const products: PriceListProduct[] = [];

    for (const [index, line] of lines.entries()) {
      const columns = line.split(";");
      const categoryCode = normalizeColumn(columns[0]);
      const eanRaw = normalizeColumn(columns[1]);
      const nobbCandidate = normalizeColumn(columns[2]);
      const productName = normalizeColumn(columns[4]);
      const pricePrimary = normalizeColumn(columns[6]);
      const priceSecondary = normalizeColumn(columns[5]);
      const priceUnit = normalizeColumn(columns[7]);
      const descriptionRaw = normalizeColumn(columns[9]);
      const salesUnit = normalizeColumn(columns[10]);
      const brandOrSeries = normalizeColumn(columns[9]);
      const altNobbCandidate = normalizeColumn(columns[14]);

      const nobbNumber = pickNobbNumber(nobbCandidate, altNobbCandidate);

      if (!nobbNumber || !productName) {
        continue;
      }

      const unit = (salesUnit || priceUnit || "STK").toUpperCase();
      const priceNok = parsePriceNok(pricePrimary) ?? parsePriceNok(priceSecondary) ?? 0;
      const listPriceNok = parsePriceNok(priceSecondary) ?? priceNok;
      const sectionTitle = inferSectionTitle(categoryCode, productName);
      const category = inferCategory(categoryCode, productName);
      const technicalDetails = [
        descriptionRaw,
        `Prisenhet: ${priceUnit || unit}`,
        `Salgsenhet: ${unit}`,
      ].filter((value) => value.length > 0);

      products.push({
        id: `${supplierKey}-${nobbNumber}-${index}`,
        nobbNumber,
        productName,
        supplierName,
        brand: inferBrand(brandOrSeries, productName),
        unit,
        priceNok,
        listPriceNok,
        sectionTitle,
        category,
        description: descriptionRaw || productName,
        ean: parseEan(eanRaw) ?? undefined,
        technicalDetails,
        quantitySuggestion: inferQuantitySuggestion(unit, sectionTitle),
        quantityReason: inferQuantityReason(unit, sectionTitle, supplierName),
        lastUpdated,
      });
    }

    return products;
  } catch {
    return [];
  }
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

function inferSectionTitle(categoryCode: string, productName: string) {
  const text = productName.toLowerCase();

  if (categoryCode === "502") {
    return "Konstruksjon og underlag";
  }
  if (categoryCode === "504") {
    return "Kledning og fasade";
  }
  if (categoryCode === "505" || categoryCode === "511") {
    return "Innvendig ferdigstilling";
  }
  if (categoryCode === "506" || /terrasse|altan|rekk/i.test(text)) {
    return "Dekke";
  }
  if (categoryCode === "510") {
    return "Finish";
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

function inferCategory(categoryCode: string, productName: string) {
  const text = productName.toLowerCase();

  if (categoryCode === "502") {
    return "Konstruksjonsvirke";
  }
  if (categoryCode === "504") {
    return "Kledning";
  }
  if (categoryCode === "506") {
    return "Terrasse";
  }
  if (/skrue|spiker|beslag/i.test(text)) {
    return "Festemidler";
  }
  if (/primer|fuktsperre|dampsperre|tape|skum/i.test(text)) {
    return "Tetthet og kjemi";
  }
  if (/list|sparkel|fug|akryl|maling/i.test(text)) {
    return "Overflate";
  }

  return "Generelt";
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
