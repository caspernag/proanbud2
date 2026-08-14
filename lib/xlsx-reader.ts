/**
 * Minimal .xlsx-leser.
 *
 * En xlsx-fil er en ZIP med XML inni. Vi trenger bare cellene som tekst, så i
 * stedet for å dra inn et tungt regnearkbibliotek (exceljs/SheetJS) leser vi
 * ZIP-en med node:zlib og plukker ut radene med målrettet XML-skanning.
 *
 * Støtter det Excel/Google Sheets/Numbers faktisk skriver ut: delte strenger,
 * inline-strenger, formelresultater og tall. Datoer kommer ut som serienummer —
 * importen bruker ingen datokolonner, så det er greit.
 *
 * Merk: helt tomme rader skrives ikke til filen av Excel og finnes derfor ikke i
 * resultatet. Radindeksene her er «radene med innhold», ikke radnumrene i Excel.
 */
import { inflateRawSync } from "node:zlib";

export type XlsxSheet = {
  name: string;
  rows: string[][];
};

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50;
const ZIP64_MARKER = 0xffffffff;

/** Leser alle ark i en xlsx-fil, i arkfanenes rekkefølge. */
export function readXlsxWorkbook(data: Uint8Array): XlsxSheet[] {
  const entries = readZipEntries(data);

  const sharedStrings = parseSharedStrings(readEntryText(entries, "xl/sharedStrings.xml"));
  const relationships = parseRelationships(readEntryText(entries, "xl/_rels/workbook.xml.rels"));
  const workbookXml = readEntryText(entries, "xl/workbook.xml");

  if (workbookXml === null) {
    throw new Error("Excel-filen mangler xl/workbook.xml og kan ikke leses.");
  }

  const sheets: XlsxSheet[] = [];

  for (const sheet of parseWorkbookSheets(workbookXml)) {
    const target = sheet.relationshipId ? relationships.get(sheet.relationshipId) : undefined;
    const sheetXml =
      (target ? readEntryText(entries, normalizeSheetPath(target)) : null) ??
      readEntryText(entries, `xl/worksheets/sheet${sheets.length + 1}.xml`);

    if (sheetXml === null) {
      continue;
    }

    sheets.push({ name: sheet.name, rows: parseWorksheetRows(sheetXml, sharedStrings) });
  }

  if (sheets.length === 0) {
    throw new Error("Fant ingen regneark i Excel-filen.");
  }

  return sheets;
}

/** Kjenner igjen xlsx/xlsm på ZIP-signaturen, ikke bare filnavnet. */
export function looksLikeXlsx(data: Uint8Array) {
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

/** Gammelt binært .xls (OLE2) — ikke støttet, men verdt å kjenne igjen for en tydelig feilmelding. */
export function looksLikeLegacyXls(data: Uint8Array) {
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return data.length > magic.length && magic.every((byte, index) => data[index] === byte);
}

/* ── ZIP ──────────────────────────────────────────────────────────────────── */

type ZipEntry = { name: string; data: Uint8Array };

function readZipEntries(data: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEndOfCentralDirectory(view);

  const entryCount = view.getUint16(eocd + 10, true);
  const centralDirectoryOffset = view.getUint32(eocd + 16, true);

  if (centralDirectoryOffset === ZIP64_MARKER) {
    throw new Error("Excel-filen bruker ZIP64 og er for stor til å leses her. Del den opp eller lagre som CSV.");
  }

  const entries = new Map<string, Uint8Array>();
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > data.length || view.getUint32(cursor, true) !== ZIP_CENTRAL_FILE_SIGNATURE) {
      break;
    }

    const entry = readCentralDirectoryEntry(data, view, cursor);
    entries.set(entry.name, entry.data);
    cursor = entry.nextOffset;
  }

  if (entries.size === 0) {
    throw new Error("Excel-filen ser ikke ut som en gyldig xlsx-fil (tom ZIP).");
  }

  return entries;
}

function readCentralDirectoryEntry(
  data: Uint8Array,
  view: DataView,
  offset: number,
): ZipEntry & { nextOffset: number } {
  const compressionMethod = view.getUint16(offset + 10, true);
  const compressedSize = view.getUint32(offset + 20, true);
  const uncompressedSize = view.getUint32(offset + 24, true);
  const nameLength = view.getUint16(offset + 28, true);
  const extraLength = view.getUint16(offset + 30, true);
  const commentLength = view.getUint16(offset + 32, true);
  const localHeaderOffset = view.getUint32(offset + 42, true);
  const name = decodeUtf8(data.subarray(offset + 46, offset + 46 + nameLength));
  const nextOffset = offset + 46 + nameLength + extraLength + commentLength;

  if (compressedSize === ZIP64_MARKER || uncompressedSize === ZIP64_MARKER || localHeaderOffset === ZIP64_MARKER) {
    throw new Error("Excel-filen bruker ZIP64 og kan ikke leses her. Lagre den på nytt eller eksporter som CSV.");
  }

  // Den lokale headeren har sine egne navn-/extra-lengder; de kan avvike fra
  // sentralkatalogens, så data-startpunktet må leses derfra.
  const localNameLength = view.getUint16(localHeaderOffset + 26, true);
  const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
  const raw = data.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) {
    return { name, data: raw, nextOffset };
  }

  if (compressionMethod !== 8) {
    throw new Error(`Excel-filen bruker en komprimering vi ikke støtter (metode ${compressionMethod}).`);
  }

  return { name, data: new Uint8Array(inflateRawSync(raw)), nextOffset };
}

function findEndOfCentralDirectory(view: DataView) {
  const maxCommentLength = 0xffff;
  const start = Math.max(0, view.byteLength - maxCommentLength - 22);

  for (let offset = view.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("Excel-filen er ufullstendig eller ødelagt (fant ikke ZIP-katalogen).");
}

function readEntryText(entries: Map<string, Uint8Array>, name: string) {
  const entry = entries.get(name);
  return entry ? decodeUtf8(entry) : null;
}

function normalizeSheetPath(target: string) {
  const cleaned = target.replace(/^\/+/, "").replace(/^xl\//, "");
  return `xl/${cleaned}`;
}

function decodeUtf8(bytes: Uint8Array) {
  return new TextDecoder("utf-8").decode(bytes);
}

/* ── XML ──────────────────────────────────────────────────────────────────── */

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];

  const strings: string[] = [];

  // Den tomme varianten må stå først i mønsteret: ellers matcher `[^>]*` også
  // skråstreken i `<si/>`, og kroppssøket sluker neste element.
  for (const match of xml.matchAll(/<si\b[^>]*\/>|<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    strings.push(match[1] ? collectTextNodes(match[1]) : "");
  }

  return strings;
}

function parseRelationships(xml: string | null): Map<string, string> {
  const relationships = new Map<string, string>();
  if (!xml) return relationships;

  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = readAttribute(match[0], "Id");
    const target = readAttribute(match[0], "Target");
    if (id && target) relationships.set(id, target);
  }

  return relationships;
}

function parseWorkbookSheets(xml: string) {
  const sheets: Array<{ name: string; relationshipId: string | null }> = [];

  for (const match of xml.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = decodeXmlEntities(readAttribute(match[0], "name") ?? `Ark ${sheets.length + 1}`);
    const relationshipId = readAttribute(match[0], "r:id") ?? readAttribute(match[0], "id");
    sheets.push({ name, relationshipId });
  }

  return sheets;
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];

  // Tomme rader og celler skrives selvlukkende (`<c r="D2" s="1"/>`). Den
  // varianten må stå først i mønsteret — ellers spiser `[^>]*` skråstreken, og
  // kroppssøket løper videre til neste `</c>` og sluker cellen etter den tomme.
  for (const rowMatch of xml.matchAll(/<row\b[^>]*\/>|<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const body = rowMatch[1];
    if (!body) {
      rows.push([]);
      continue;
    }

    const cells: string[] = [];

    for (const cellMatch of body.matchAll(/<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1] ?? cellMatch[2] ?? "";
      const content = cellMatch[3] ?? "";
      const columnIndex = columnIndexFromRef(readAttribute(attributes, "r")) ?? cells.length;

      while (cells.length < columnIndex) {
        cells.push("");
      }

      cells[columnIndex] = readCellValue(attributes, content, sharedStrings);
    }

    rows.push(cells);
  }

  return rows;
}

function readCellValue(attributes: string, content: string, sharedStrings: string[]) {
  const type = readAttribute(attributes, "t") ?? "n";

  if (type === "s") {
    const index = Number.parseInt(stripTags(matchFirst(content, /<v\b[^>]*>([\s\S]*?)<\/v>/)) || "", 10);
    return Number.isInteger(index) ? (sharedStrings[index] ?? "") : "";
  }

  if (type === "inlineStr") {
    return collectTextNodes(content);
  }

  if (type === "b") {
    const raw = stripTags(matchFirst(content, /<v\b[^>]*>([\s\S]*?)<\/v>/));
    return raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : "";
  }

  if (type === "e") {
    return "";
  }

  // "n" (tall) og "str" (formelresultat) ligger begge i <v>.
  return decodeXmlEntities(stripTags(matchFirst(content, /<v\b[^>]*>([\s\S]*?)<\/v>/))).trim();
}

/** Slår sammen alle <t>-noder i en celle/streng, så rik tekst ikke mister biter. */
function collectTextNodes(xml: string) {
  let text = "";

  for (const match of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
    text += decodeXmlEntities(match[1]);
  }

  return text.trim();
}

function columnIndexFromRef(ref: string | null) {
  if (!ref) return null;

  const letters = ref.match(/^[A-Z]+/i)?.[0];
  if (!letters) return null;

  let index = 0;
  for (const character of letters.toUpperCase()) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }

  return index - 1;
}

function readAttribute(tag: string, name: string) {
  const pattern = new RegExp(`\\b${name.replace(":", "\\:")}\\s*=\\s*"([^"]*)"`, "i");
  return tag.match(pattern)?.[1] ?? null;
}

function matchFirst(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1] ?? "";
}

function stripTags(value: string) {
  return value.replace(/<[^>]*>/g, "");
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
