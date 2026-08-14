import "server-only";

/**
 * Kolonnestyrt parsing av prisfiler (Excel-ark og CSV med overskriftsrad).
 *
 * Den gamle CSV-parseren i price-lists.ts leser faste kolonneposisjoner fra
 * Byggmakkers vector-store-eksport. Excel-filer fra innkjøp har overskrifter og
 * varierende kolonnerekkefølge, så her finner vi overskriftsraden og kobler
 * kolonnene på navn i stedet.
 */
import {
  inferBrand,
  inferCategory,
  inferQuantityReason,
  inferQuantitySuggestion,
  inferSectionTitle,
  type PriceListProduct,
} from "@/lib/price-lists";
import {
  describeSalesUnitQuantity,
  normalizeProductUnit,
  parseSalesUnitQuantity,
  priceForSalesUnit,
} from "@/lib/product-unit-pricing";
import { slugify } from "@/lib/utils";

/** Feltene vi kan lese ut av en tabell. Rekkefølgen er også prioritet ved kolonnekonflikt. */
const FIELD_ALIASES = {
  nobb: [
    "nobb",
    "nobbnr",
    "nobbnummer",
    "nobbno",
    "nobbid",
    "nobbnumber",
    "varenr",
    "varenummer",
    "artikkelnr",
    "artikkelnummer",
    "artnr",
    "produktnr",
    "produktnummer",
    "sku",
  ],
  ean: ["ean", "eannr", "eannummer", "gtin", "strekkode", "barcode"],
  productName: [
    "produktnavn",
    "varenavn",
    "varetekst",
    "artikkelnavn",
    "produkt",
    "vare",
    "navn",
    "benevnelse",
    "productname",
    "itemname",
    "name",
  ],
  price: [
    "nettopris",
    "innkjopspris",
    "innkjøpspris",
    "avtalepris",
    "dinpris",
    "kostpris",
    "enhetspris",
    "pris",
    "prisnok",
    "priseksmva",
    "prisekskmva",
    "netprice",
    "unitprice",
    "price",
  ],
  listPrice: [
    "veiledendepris",
    "veilpris",
    "veiledende",
    "listepris",
    "bruttopris",
    "ordinarpris",
    "ordinærpris",
    "forpris",
    "listprice",
    "rrp",
  ],
  priceUnit: ["prisenhet", "prisenh", "priseenhet", "priceunit", "pe"],
  salesUnit: ["salgsenhet", "salgsenh", "enhet", "benevning", "salesunit", "unit", "uom", "se"],
  salesUnitQuantity: [
    "antallprsalgsenhet",
    "antallpersalgsenhet",
    "salgsenhetantall",
    "antallpakke",
    "antallprpakke",
    "pakkestorrelse",
    "pakkestørrelse",
    "forpakningsstorrelse",
    "forpakning",
    "pakningsinnhold",
    "innhold",
    "antall",
    "packsize",
    "quantityperunit",
  ],
  brand: ["merke", "merkevare", "fabrikat", "produsent", "brand", "manufacturer"],
  supplier: ["leverandor", "leverandør", "supplier", "vendor"],
  category: ["varegruppe", "produktgruppe", "hovedgruppe", "kategori", "category", "productgroup"],
  section: ["seksjon", "avdeling", "hovedkategori", "section", "department"],
  description: [
    "beskrivelse",
    "produktbeskrivelse",
    "varebeskrivelse",
    "tilleggstekst",
    "spesifikasjon",
    "description",
    "specification",
  ],
  imageUrl: ["bilde", "bildeurl", "bildelenke", "imageurl", "image", "bildeadresse"],
  datasheetUrl: ["datablad", "datasheet", "datasheeturl", "produktblad", "dokumentasjon", "fdv"],
} as const;

type FieldName = keyof typeof FIELD_ALIASES;

const FIELD_ORDER = Object.keys(FIELD_ALIASES) as FieldName[];

export type TabularParseResult = {
  products: PriceListProduct[];
  /** null når filen ikke hadde overskriftsrad og kolonnene ble gjenkjent på innhold. */
  headerRowIndex: number | null;
  mappedColumns: Partial<Record<FieldName, string>>;
  dataRows: number;
  skippedRows: number;
  warnings: string[];
};

export type TabularParseOptions = {
  supplierName: string;
  sourceKey: string;
  lastUpdated: string;
  /** Tillat innholdsbasert kolonnegjenkjenning når filen mangler overskriftsrad. */
  allowHeaderless?: boolean;
};

export function parseProductsFromTable(
  rows: string[][],
  options: TabularParseOptions,
): TabularParseResult {
  const empty: TabularParseResult = {
    products: [],
    headerRowIndex: null,
    mappedColumns: {},
    dataRows: 0,
    skippedRows: 0,
    warnings: [],
  };

  const header = detectHeaderRow(rows);

  // Uten overskriftsrad gjenkjennes kolonnene på innholdet i stedet — men bare
  // når den som kaller ber om det, slik at rå leverandøreksport fortsatt går til
  // den posisjonsbaserte parseren først.
  const detected =
    header ?? (options.allowHeaderless ? detectColumnsFromContent(rows) : null);

  if (!detected) {
    return empty;
  }

  const { index: headerRowIndex, columns } = detected;
  const warnings: string[] = [];
  const products: PriceListProduct[] = [];
  let skippedRows = 0;
  let dataRows = 0;

  const mappedColumns: Partial<Record<FieldName, string>> = {};
  for (const [field, columnIndex] of Object.entries(columns) as Array<[FieldName, number]>) {
    mappedColumns[field] =
      headerRowIndex === null
        ? `kolonne ${columnLetter(columnIndex)}`
        : (rows[headerRowIndex][columnIndex] ?? "").trim();
  }

  if (columns.price === undefined && columns.listPrice === undefined) {
    warnings.push("Fant ingen priskolonne — produktene importeres med pris 0.");
  }

  if (headerRowIndex === null) {
    warnings.push(
      "Filen har ingen overskriftsrad. Kolonnene ble gjenkjent på innholdet — kontroller at koblingen nedenfor stemmer.",
    );
  }

  for (let rowIndex = (headerRowIndex ?? -1) + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row || row.every((cell) => !cell || !cell.trim())) {
      continue;
    }

    dataRows += 1;
    const product = buildProduct(row, columns, options);

    if (!product) {
      skippedRows += 1;
      continue;
    }

    products.push(product);
  }

  if (skippedRows > 0) {
    warnings.push(
      `${skippedRows} rad(er) ble hoppet over fordi NOBB-nummer eller produktnavn manglet.`,
    );
  }

  return { products, headerRowIndex, mappedColumns, dataRows, skippedRows, warnings };
}

/* ── Overskriftsgjenkjenning ──────────────────────────────────────────────── */

/** `categoryCode` er en varegruppekode (f.eks. «0501»), ikke et kategorinavn. */
type ColumnMap = Partial<Record<FieldName, number>> & { categoryCode?: number };

/**
 * Leter etter overskriftsraden i de første radene. Excel-eksporter har ofte
 * tittel-/logorader over tabellen, så vi kan ikke bare anta rad 0.
 */
function detectHeaderRow(rows: string[][]) {
  const searchDepth = Math.min(rows.length, 25);
  let best: { index: number; columns: ColumnMap; score: number } | null = null;

  for (let index = 0; index < searchDepth; index += 1) {
    const columns = mapColumns(rows[index] ?? []);
    const score = Object.keys(columns).length;

    const usable =
      columns.nobb !== undefined &&
      (columns.productName !== undefined || columns.price !== undefined || columns.listPrice !== undefined);

    if (usable && (!best || score > best.score)) {
      best = { index, columns, score };
    }
  }

  return best;
}

function mapColumns(headerRow: string[]): ColumnMap {
  const normalized = headerRow.map((cell) => normalizeHeader(cell));
  const columns: ColumnMap = {};
  const taken = new Set<number>();

  // Eksakte treff først.
  for (const field of FIELD_ORDER) {
    const columnIndex = normalized.findIndex(
      (value, index) =>
        !taken.has(index) &&
        value.length > 0 &&
        FIELD_ALIASES[field].some((alias) => value === normalizeHeader(alias)),
    );

    if (columnIndex >= 0) {
      columns[field] = columnIndex;
      taken.add(columnIndex);
    }
  }

  // Så delstrengtreff, lengste alias først. «Prisenhet (PE)» må treffe
  // prisenhet-aliaset før «pris» rekker å kapre kolonnen.
  for (const { field, alias } of LOOSE_ALIASES) {
    if (columns[field] !== undefined) continue;

    const columnIndex = normalized.findIndex(
      (value, index) => !taken.has(index) && value.includes(alias),
    );

    if (columnIndex >= 0) {
      columns[field] = columnIndex;
      taken.add(columnIndex);
    }
  }

  return columns;
}

/** Alle alias lange nok til delstrengsøk, sortert slik at det mest spesifikke vinner. */
const LOOSE_ALIASES = FIELD_ORDER.flatMap((field) =>
  FIELD_ALIASES[field]
    .map((alias) => ({ field, alias: normalizeHeader(alias) }))
    .filter((entry) => entry.alias.length >= 4),
).sort((a, b) => b.alias.length - a.alias.length);

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/* ── Innholdsbasert kolonnegjenkjenning (filer uten overskriftsrad) ───────── */

const UNIT_CODES = new Set([
  "STK", "LM", "M", "M2", "M3", "PAK", "PK", "POS", "SEK", "RL", "SET", "KG", "L", "PLT", "BUNT",
  "PAR", "ESK", "KRT", "SPN", "TUB", "SPI", "BNT",
]);

type ColumnStats = {
  index: number;
  filled: number;
  numeric: number;
  positiveNumeric: number;
  productNumber: number;
  ean13: number;
  words: number;
  unitCode: number;
  shortCode: number;
  decimals: number;
  sum: number;
};

/**
 * Leverandøreksport kommer ofte som en ren dataliste uten overskrifter — som
 * Byggmakkers «NOBB, navn, tilleggstekst, …, veil.pris, rabatt %, nettopris,
 * enhet, …, varegruppe». I stedet for å låse oss til faste kolonnenumre leser vi
 * hva kolonnene faktisk inneholder.
 */
function detectColumnsFromContent(rows: string[][]): { index: null; columns: ColumnMap } | null {
  const sample = rows.filter((row) => row.some((cell) => cell && cell.trim())).slice(0, 200);

  if (sample.length === 0) {
    return null;
  }

  const width = sample.reduce((max, row) => Math.max(max, row.length), 0);
  const stats = Array.from({ length: width }, (_, index) => columnStats(sample, index));
  const ratio = (value: number, total: number) => (total === 0 ? 0 : value / total);
  const columns: ColumnMap = {};
  const taken = new Set<number>();

  const claim = (field: keyof ColumnMap, index: number | undefined) => {
    if (index === undefined || taken.has(index)) return;
    columns[field] = index;
    taken.add(index);
  };

  // NOBB: 6–10 sifre i så godt som hver rad. EAN (13 sifre) er noe annet.
  const nobb = stats
    .filter((column) => ratio(column.productNumber, column.filled) >= 0.8 && column.filled > 0)
    .sort((a, b) => ratio(b.productNumber, b.filled) - ratio(a.productNumber, a.filled) || a.index - b.index)[0];

  if (!nobb) return null;
  claim("nobb", nobb.index);

  claim(
    "ean",
    stats.find(
      (column) => !taken.has(column.index) && column.filled > 0 && ratio(column.ean13, column.filled) >= 0.8,
    )?.index,
  );

  claim(
    "salesUnit",
    stats.find(
      (column) => !taken.has(column.index) && column.filled > 0 && ratio(column.unitCode, column.filled) >= 0.6,
    )?.index,
  );

  // Tekstkolonner: den bredeste er produktnavnet, neste er tilleggstekst.
  const textColumns = stats
    .filter((column) => !taken.has(column.index) && column.filled > 0 && ratio(column.words, column.filled) >= 0.5)
    .sort((a, b) => b.words - a.words || a.index - b.index);

  if (textColumns.length === 0) return null;
  claim("productName", textColumns[0].index);

  const descriptionColumn = stats
    .filter((column) => !taken.has(column.index) && column.filled > 0 && ratio(column.words, column.filled) >= 0.3)
    .sort((a, b) => a.index - b.index)[0];
  claim("description", descriptionColumn?.index);

  // Varegruppekode: korte tallkoder, ofte med ledende null («0501»).
  claim(
    "categoryCode",
    stats.find(
      (column) => !taken.has(column.index) && column.filled > 0 && ratio(column.shortCode, column.filled) >= 0.8,
    )?.index,
  );

  assignPriceColumns(stats, sample, taken, columns, ratio);

  if (columns.productName === undefined) return null;

  return { index: null, columns };
}

/**
 * Priskolonnene. Mange prislister har tre tall ved siden av hverandre:
 * veiledende pris, rabatt i prosent og nettopris. Finner vi den sammenhengen
 * (netto = veil × (1 − rabatt/100)) vet vi sikkert hvilken som er hvilken — og
 * at prosentkolonnen ikke er en pris.
 */
function assignPriceColumns(
  stats: ColumnStats[],
  sample: string[][],
  taken: Set<number>,
  columns: ColumnMap,
  ratio: (value: number, total: number) => number,
) {
  const numeric = stats.filter(
    (column) =>
      !taken.has(column.index) &&
      column.filled > 0 &&
      ratio(column.numeric, column.filled) >= 0.8 &&
      ratio(column.positiveNumeric, column.filled) >= 0.5,
  );

  if (numeric.length === 0) return;

  for (const list of numeric) {
    for (const percent of numeric) {
      if (percent.index === list.index) continue;

      for (const net of numeric) {
        if (net.index === list.index || net.index === percent.index) continue;
        if (!matchesDiscountTriple(sample, list.index, percent.index, net.index)) continue;

        columns.listPrice = list.index;
        columns.price = net.index;
        taken.add(list.index);
        taken.add(percent.index);
        taken.add(net.index);
        return;
      }
    }
  }

  // Ingen rabattsammenheng: høyeste snitt er listepris, laveste er nettopris.
  const byAverage = [...numeric].sort((a, b) => b.sum / b.numeric - a.sum / a.numeric);

  if (byAverage.length === 1) {
    columns.price = byAverage[0].index;
    return;
  }

  columns.listPrice = byAverage[0].index;
  columns.price = byAverage[byAverage.length - 1].index;
}

function matchesDiscountTriple(sample: string[][], listIndex: number, percentIndex: number, netIndex: number) {
  let checked = 0;
  let matched = 0;

  for (const row of sample) {
    const list = parseDecimalNo((row[listIndex] ?? "").trim());
    const percent = parseDecimalNo((row[percentIndex] ?? "").trim());
    const net = parseDecimalNo((row[netIndex] ?? "").trim());

    if (list === null || percent === null || net === null || list <= 0 || percent > 100) continue;

    checked += 1;
    const expected = list * (1 - percent / 100);
    if (Math.abs(expected - net) <= Math.max(0.02, list * 0.005)) {
      matched += 1;
    }
  }

  return checked >= 3 && matched / checked >= 0.8;
}

function columnStats(sample: string[][], index: number): ColumnStats {
  const stats: ColumnStats = {
    index,
    filled: 0,
    numeric: 0,
    positiveNumeric: 0,
    productNumber: 0,
    ean13: 0,
    words: 0,
    unitCode: 0,
    shortCode: 0,
    decimals: 0,
    sum: 0,
  };

  for (const row of sample) {
    const value = (row[index] ?? "").trim();
    if (!value) continue;

    stats.filled += 1;

    const digits = value.replace(/\D/g, "");
    const isPureDigits = /^\d+$/.test(value);

    if (isPureDigits && digits.length >= 6 && digits.length <= 10) stats.productNumber += 1;
    if (isPureDigits && digits.length === 13) stats.ean13 += 1;
    if (isPureDigits && digits.length >= 2 && digits.length <= 6) stats.shortCode += 1;
    if (UNIT_CODES.has(value.toUpperCase().replace("M²", "M2"))) stats.unitCode += 1;
    if (/[a-zæøåA-ZÆØÅ]{2,}/.test(value)) stats.words += 1;

    const numeric = parseDecimalNo(value);
    if (numeric !== null && /^[\s\d.,-]+$/.test(value)) {
      stats.numeric += 1;
      stats.sum += numeric;
      if (numeric > 0) stats.positiveNumeric += 1;
      if (/[.,]\d/.test(value)) stats.decimals += 1;
    }
  }

  return stats;
}

function columnLetter(index: number) {
  let letter = "";
  let remaining = index;

  do {
    letter = String.fromCharCode(65 + (remaining % 26)) + letter;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);

  return letter;
}

/* ── Radoversettelse ──────────────────────────────────────────────────────── */

function buildProduct(
  row: string[],
  columns: ColumnMap,
  options: TabularParseOptions,
): PriceListProduct | null {
  const cell = (field: keyof ColumnMap) => {
    const index = columns[field];
    return index === undefined ? "" : (row[index] ?? "").trim();
  };

  const nobbNumber = normalizeNobb(cell("nobb"));
  const rawName = cell("productName");
  const descriptionRaw = cell("description");
  const productName = collapseWhitespace(rawName || descriptionRaw);

  if (!nobbNumber || !productName) {
    return null;
  }

  const priceUnit = normalizeProductUnit(cell("priceUnit") || cell("salesUnit") || "STK");
  const salesUnit = normalizeProductUnit(cell("salesUnit") || priceUnit, priceUnit);
  const description = collapseWhitespace(descriptionRaw) || productName;
  const salesUnitQuantity = parseSalesUnitQuantity(
    `${description} ${productName}`,
    priceUnit,
    salesUnit,
    cell("salesUnitQuantity"),
  );

  const rawPrice = parseDecimalNo(cell("price"));
  const rawListPrice = parseDecimalNo(cell("listPrice"));
  const priceNok = priceForSalesUnit(rawPrice ?? rawListPrice ?? 0, {
    priceUnit,
    salesUnit,
    salesUnitQuantity,
  });
  const listPriceNok = priceForSalesUnit(rawListPrice ?? rawPrice ?? 0, {
    priceUnit,
    salesUnit,
    salesUnitQuantity,
  });

  const supplierName = collapseWhitespace(cell("supplier")) || options.supplierName;
  const categoryCode = cell("categoryCode");
  const categoryRaw = collapseWhitespace(cell("category"));
  const category = categoryRaw || inferCategory(categoryCode, productName);
  const sectionTitle =
    collapseWhitespace(cell("section")) || inferSectionTitle(categoryCode, productName);
  const ean = normalizeEan(cell("ean"));
  const imageUrl = normalizeUrl(cell("imageUrl"));
  const datasheetUrl = normalizeUrl(cell("datasheetUrl"));

  const technicalDetails = [
    description === productName ? "" : description,
    `Prisenhet: ${priceUnit}`,
    `Salgsenhet: ${salesUnit}`,
    describeSalesUnitQuantity({ priceUnit, salesUnit, salesUnitQuantity }),
  ].filter((value) => value.length > 0);

  return {
    id: `${slugify(options.sourceKey)}-${nobbNumber}`,
    nobbNumber,
    productName,
    supplierName,
    brand: collapseWhitespace(cell("brand")) || inferBrand("", productName),
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
    ...(ean ? { ean } : {}),
    ...(datasheetUrl ? { datasheetUrl } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    technicalDetails: Array.from(new Set(technicalDetails)).slice(0, 8),
    quantitySuggestion: inferQuantitySuggestion(salesUnit, sectionTitle),
    quantityReason: inferQuantityReason(salesUnit, sectionTitle, supplierName),
    lastUpdated: options.lastUpdated,
  };
}

function normalizeNobb(raw: string) {
  // Excel gjør ofte lange tall om til 1,23457E+11 — da er sifrene tapt og raden
  // er ubrukelig. Bedre å hoppe over enn å importere et oppdiktet NOBB.
  if (/e\+?\d+$/i.test(raw.replace(/\s/g, ""))) {
    return "";
  }

  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 ? digits : "";
}

function normalizeEan(raw: string) {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 ? digits : undefined;
}

function normalizeUrl(raw: string) {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Tall fra norske prislister: «1 234,56», «1.234,56», «kr 199,-», «1234.56».
 *
 * Merk: her tolkes ingenting som øre. Den gamle vector-store-parseren deler
 * heltall på 100 fordi Byggmakkers råeksport oppgir øre, men et Excel-ark fra
 * innkjøp har kroner — å gjette der ville gjort 199 kr til 1,99 kr.
 */
export function parseDecimalNo(raw: string): number | null {
  if (!raw) return null;

  const cleaned = raw
    .replace(/ /g, " ")
    .replace(/(kr|nok)/gi, "")
    .replace(/,-$/, "")
    .replace(/\s/g, "")
    .trim();

  if (!cleaned || !/\d/.test(cleaned)) {
    return null;
  }

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;

  if (hasComma && hasDot) {
    // Den siste separatoren er desimalskilletegnet.
    const decimalSeparator = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? "," : ".";
    const thousandSeparator = decimalSeparator === "," ? "." : ",";
    normalized = cleaned.split(thousandSeparator).join("").replace(decimalSeparator, ".");
  } else if (hasComma) {
    normalized = cleaned.replace(/,/g, ".");
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    // 1.234 / 1.234.567 er tusenskille, ikke desimaltall.
    normalized = cleaned.split(".").join("");
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}
