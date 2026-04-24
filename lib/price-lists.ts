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

    for (const line of lines) {
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
        id: `${supplierKey}-${nobbNumber}`,
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
