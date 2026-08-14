import "server-only";

/**
 * Én inngang for alle prisfil-formater adminpanelet tar imot: Excel, CSV/TSV og
 * JSON/NDJSON. Excel og CSV-med-overskrifter går gjennom den kolonnestyrte
 * parseren; rå Byggmakker-eksport uten overskrifter faller tilbake til den
 * posisjonsbaserte parseren som vector-store-filene bruker.
 */
import path from "node:path";

import { parseProductsFromTable } from "@/lib/price-import-tabular";
import { parsePriceListProductsFromVectorFile, type PriceListProduct } from "@/lib/price-lists";
import { looksLikeLegacyXls, looksLikeXlsx, readXlsxWorkbook } from "@/lib/xlsx-reader";

export type PriceImportFormat =
  | "xlsx"
  | "csv-headers"
  | "csv-uten-overskrifter"
  | "csv-posisjoner"
  | "json";

export type ParsedPriceImportFile = {
  products: PriceListProduct[];
  format: PriceImportFormat;
  sheetName: string | null;
  /** Hvilke kolonneoverskrifter som ble koblet til hvilke felt — vises i importkvitteringen. */
  mappedColumns: Record<string, string>;
  warnings: string[];
};

export type PriceImportInput = {
  fileName: string;
  data: Uint8Array;
  supplierName: string;
  lastUpdated?: string;
};

export function parsePriceImportFile(input: PriceImportInput): ParsedPriceImportFile {
  const lastUpdated = input.lastUpdated ?? new Date().toISOString().slice(0, 10);
  const fileName = input.fileName || "prisfil";
  const extension = path.extname(fileName).toLowerCase();
  const sourceKey = supplierSourceKey(input.supplierName);

  if (looksLikeLegacyXls(input.data)) {
    throw new Error(
      "Gammelt Excel-format (.xls) støttes ikke. Åpne filen i Excel og lagre den som .xlsx eller CSV.",
    );
  }

  if (looksLikeXlsx(input.data) || extension === ".xlsx" || extension === ".xlsm") {
    return parseWorkbook(input, { lastUpdated, sourceKey });
  }

  const text = new TextDecoder("utf-8").decode(input.data);

  if (!text.trim()) {
    throw new Error("Prisfilen er tom.");
  }

  if (extension === ".json" || extension === ".ndjson" || looksLikeJson(text)) {
    const products = parsePriceListProductsFromVectorFile(text, fileName, lastUpdated);
    return { products, format: "json", sheetName: null, mappedColumns: {}, warnings: [] };
  }

  return parseDelimitedText(text, { fileName, lastUpdated, sourceKey, supplierName: input.supplierName });
}

function parseWorkbook(
  input: PriceImportInput,
  context: { lastUpdated: string; sourceKey: string },
): ParsedPriceImportFile {
  const sheets = readXlsxWorkbook(input.data);
  const attempts = sheets.map((sheet) => ({
    sheet,
    result: parseProductsFromTable(sheet.rows, {
      supplierName: input.supplierName,
      sourceKey: context.sourceKey,
      lastUpdated: context.lastUpdated,
      // Prislister eksportert fra leverandørsystemer har ofte ingen
      // overskriftsrad — da gjenkjennes kolonnene på innhold.
      allowHeaderless: true,
    }),
  }));

  // Prisfiler har ofte «Forside»- og «Info»-ark ved siden av selve varelisten;
  // arket med flest gjenkjente produkter er det vi vil ha.
  const best = attempts.reduce((winner, candidate) =>
    candidate.result.products.length > winner.result.products.length ? candidate : winner,
  );

  if (best.result.products.length === 0) {
    throw new Error(
      `Fant ingen produktrader i Excel-filen. Sjekk at arket har en overskriftsrad med NOBB-nummer og pris (ark: ${sheets
        .map((sheet) => sheet.name)
        .join(", ")}).`,
    );
  }

  const warnings = [...best.result.warnings];
  const otherSheetsWithData = attempts.filter(
    (attempt) => attempt !== best && attempt.result.products.length > 0,
  );

  if (otherSheetsWithData.length > 0) {
    warnings.push(
      `Bare arket «${best.sheet.name}» ble importert. Disse arkene har også produktrader: ${otherSheetsWithData
        .map((attempt) => `${attempt.sheet.name} (${attempt.result.products.length})`)
        .join(", ")}.`,
    );
  }

  return {
    products: best.result.products,
    format: "xlsx",
    sheetName: best.sheet.name,
    mappedColumns: best.result.mappedColumns as Record<string, string>,
    warnings,
  };
}

function parseDelimitedText(
  text: string,
  context: { fileName: string; lastUpdated: string; sourceKey: string; supplierName: string },
): ParsedPriceImportFile {
  const rows = parseDelimitedRows(text);
  const headerResult = parseProductsFromTable(rows, {
    supplierName: context.supplierName,
    sourceKey: context.sourceKey,
    lastUpdated: context.lastUpdated,
  });

  if (headerResult.products.length > 0) {
    return {
      products: headerResult.products,
      format: "csv-headers",
      sheetName: null,
      mappedColumns: headerResult.mappedColumns as Record<string, string>,
      warnings: headerResult.warnings,
    };
  }

  // Byggmakkers råeksport har faste kolonneposisjoner og priser i øre; den
  // parseren må prøves før den innholdsbaserte gjetningen.
  const products = parsePriceListProductsFromVectorFile(text, context.fileName, context.lastUpdated);

  if (products.length > 0) {
    return { products, format: "csv-posisjoner", sheetName: null, mappedColumns: {}, warnings: [] };
  }

  const headerless = parseProductsFromTable(rows, {
    supplierName: context.supplierName,
    sourceKey: context.sourceKey,
    lastUpdated: context.lastUpdated,
    allowHeaderless: true,
  });

  if (headerless.products.length === 0) {
    throw new Error(
      "Fant ingen produkter i filen. Legg inn en overskriftsrad med NOBB-nummer, produktnavn og pris — eller last opp Byggmakkers råeksport.",
    );
  }

  return {
    products: headerless.products,
    format: "csv-uten-overskrifter",
    sheetName: null,
    mappedColumns: headerless.mappedColumns as Record<string, string>,
    warnings: headerless.warnings,
  };
}

/** Splitter avgrenset tekst til celler, med RFC4180-siterte felt og linjeskift inni anførselstegn. */
export function parseDelimitedRows(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(normalized);
  const rows: string[][] = [];

  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];

    if (inQuotes) {
      if (character === '"') {
        if (normalized[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }

    if (character === delimiter) {
      row.push(field);
      field = "";
      continue;
    }

    if (character === "\n" || character === "\r") {
      if (character === "\r" && normalized[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += character;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function detectDelimiter(text: string) {
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  const candidates = [";", "\t", ",", "|"];

  let best = ";";
  let bestCount = 0;

  for (const candidate of candidates) {
    const count = sample.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

function looksLikeJson(text: string) {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function supplierSourceKey(supplierName: string) {
  return supplierName.trim().toLowerCase().replace(/\s+/g, "-") || "prisfil";
}
