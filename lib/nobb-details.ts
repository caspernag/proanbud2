import "server-only";

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

import { env, hasNobbApiEnv } from "@/lib/env";
import { getPriceListProductByNobb } from "@/lib/price-lists";

const execFileAsync = promisify(execFile);

const EXTERNAL_NOBB_TIMEOUT_MS = 6_000;
const EXTERNAL_NOBB_CACHE_TTL_MS = 5 * 60 * 1_000;
const RENDERED_NOBB_CACHE_TTL_MS = 30 * 60 * 1_000;
const RENDERED_NOBB_TIMEOUT_MS = 10_000;

const externalNobbCache = new Map<
  string,
  {
    expiresAt: number;
    value: NobbDetailsResponse;
  }
>();

const renderedNobbCache = new Map<
  string,
  {
    expiresAt: number;
    value: RenderedNobbPageDetails | null;
  }
>();

export type NobbDocumentCategory = "documentation" | "environment" | "certificates" | "information";

export type NobbDocumentLink = {
  title: string;
  url: string;
  category: NobbDocumentCategory;
};

export type NobbInfoEntry = {
  label: string;
  value: string;
};

export type NobbInfoGroup = {
  title: string;
  entries: NobbInfoEntry[];
};

export type NobbDetailsResponse = {
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
  publicPageUrl: string;
  documents: NobbDocumentLink[];
  infoGroups: NobbInfoGroup[];
};

type RenderedNobbPageDetails = {
  productName?: string;
  description?: string;
  brand?: string;
  supplierName?: string;
  ean?: string;
  lastUpdated?: string;
  documents: NobbDocumentLink[];
  infoGroups: NobbInfoGroup[];
};

export async function getNobbDetails(nobbNumber: string): Promise<NobbDetailsResponse | null> {
  const normalizedNobbNumber = nobbNumber.trim();

  if (!normalizedNobbNumber) {
    return null;
  }

  const cachedExternal = getCachedExternalNobbDetails(normalizedNobbNumber);

  if (cachedExternal) {
    return cachedExternal;
  }

  const [baseDetails, renderedDetails] = await Promise.all([
    fetchExternalNobbDetails(normalizedNobbNumber).then((d) => d ?? fetchLocalNobbDetails(normalizedNobbNumber)),
    getRenderedNobbPageDetails(normalizedNobbNumber),
  ]);

  if (!baseDetails) {
    return null;
  }

  const mergedDetails = mergeNobbDetails(baseDetails, renderedDetails, normalizedNobbNumber);

  setCachedExternalNobbDetails(normalizedNobbNumber, mergedDetails);
  return mergedDetails;
}

async function fetchLocalNobbDetails(nobbNumber: string): Promise<NobbDetailsResponse | null> {
  const localProduct = await getPriceListProductByNobb(nobbNumber);

  if (!localProduct) {
    return null;
  }

  return {
    nobbNumber: localProduct.nobbNumber,
    productName: localProduct.productName,
    description: localProduct.description,
    brand: localProduct.brand,
    supplierName: localProduct.supplierName,
    category: localProduct.category,
    unit: localProduct.unit,
    unitPriceNok: localProduct.priceNok,
    listPriceNok: localProduct.listPriceNok,
    ean: localProduct.ean,
    datasheetUrl: localProduct.datasheetUrl,
    imageUrl: localProduct.imageUrl,
    technicalDetails: localProduct.technicalDetails,
    lastUpdated: localProduct.lastUpdated,
    source: "prislister",
    publicPageUrl: buildNobbPublicUrl(nobbNumber),
    documents: [],
    infoGroups: [],
  };
}

async function fetchExternalNobbDetails(nobbNumber: string): Promise<NobbDetailsResponse | null> {
  if (!hasNobbApiEnv()) {
    return null;
  }

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
      publicPageUrl: buildNobbPublicUrl(nobbNumber),
      documents: [],
      infoGroups: [],
    };
  } catch {
    return null;
  }
}

function mergeNobbDetails(
  baseDetails: NobbDetailsResponse,
  renderedDetails: RenderedNobbPageDetails | null,
  nobbNumber: string,
): NobbDetailsResponse {
  const documents = dedupeDocuments([
    ...baseDetails.documents,
    ...(baseDetails.datasheetUrl
      ? [{ title: "Datablad", url: baseDetails.datasheetUrl, category: "documentation" as const }]
      : []),
    ...(renderedDetails?.documents ?? []),
  ]);

  return {
    ...baseDetails,
    productName: renderedDetails?.productName || baseDetails.productName,
    description: renderedDetails?.description || baseDetails.description,
    brand: renderedDetails?.brand || baseDetails.brand,
    supplierName: renderedDetails?.supplierName || baseDetails.supplierName,
    ean: renderedDetails?.ean || baseDetails.ean,
    lastUpdated: renderedDetails?.lastUpdated || baseDetails.lastUpdated,
    publicPageUrl: buildNobbPublicUrl(nobbNumber),
    datasheetUrl: documents.find((document) => /datablad/i.test(document.title))?.url ?? baseDetails.datasheetUrl,
    documents,
    infoGroups: renderedDetails?.infoGroups ?? [],
  };
}

async function getRenderedNobbPageDetails(nobbNumber: string): Promise<RenderedNobbPageDetails | null> {
  const cached = renderedNobbCache.get(nobbNumber);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const chromePath = await resolveChromeBinary();

  if (!chromePath) {
    renderedNobbCache.set(nobbNumber, {
      expiresAt: Date.now() + RENDERED_NOBB_CACHE_TTL_MS,
      value: null,
    });
    return null;
  }

  try {
    const { stdout } = await execFileAsync(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--virtual-time-budget=6000",
        "--dump-dom",
        buildNobbPublicUrl(nobbNumber),
      ],
      {
        timeout: RENDERED_NOBB_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
      },
    );

    const parsed = parseRenderedNobbPage(stdout);
    renderedNobbCache.set(nobbNumber, {
      expiresAt: Date.now() + RENDERED_NOBB_CACHE_TTL_MS,
      value: parsed,
    });
    return parsed;
  } catch {
    renderedNobbCache.set(nobbNumber, {
      expiresAt: Date.now() + RENDERED_NOBB_CACHE_TTL_MS,
      value: null,
    });
    return null;
  }
}

async function resolveChromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function parseRenderedNobbPage(html: string): RenderedNobbPageDetails {
  const cleanHtml = html.replace(/<!--!-->/g, "");

  return {
    productName: firstMatch(cleanHtml, /<h2[^>]*>([^<]+)<\/h2>/i),
    description: firstMatch(cleanHtml, /<h4[^>]*>([^<]+)<\/h4>/i),
    brand: findValueForLabel(cleanHtml, "Merkenavn"),
    supplierName: findValueForLabel(cleanHtml, "Leverandør"),
    ean: findValueForLabel(cleanHtml, "GTIN"),
    lastUpdated: findValueForLabel(cleanHtml, "Sist endret"),
    documents: parseDocumentLinks(cleanHtml),
    infoGroups: [
      ...parseInfoGroups(extractSection(cleanHtml, "Varedetaljer", "Pakningsinformasjon")),
      ...parseInfoGroups(extractSection(cleanHtml, "Egenskaper", "</body>")),
    ],
  };
}

function parseDocumentLinks(html: string) {
  const sectionHtml = extractSection(html, "Dokumentasjon, bærekraft og miljø", "Egenskaper");

  if (!sectionHtml) {
    return [] as NobbDocumentLink[];
  }

  const headings = [
    { label: "Dokumentasjon", category: "documentation" as const },
    { label: "Miljødokumentasjon", category: "environment" as const },
    { label: "Firmasertifikater", category: "certificates" as const },
    { label: "Informasjon", category: "information" as const },
  ];

  return headings.flatMap((heading, index) => {
    const startIndex = sectionHtml.indexOf(`>${heading.label}</h3>`);

    if (startIndex < 0) {
      return [];
    }

    const nextHeading = headings.slice(index + 1).find((candidate) => sectionHtml.indexOf(`>${candidate.label}</h3>`, startIndex + 1) >= 0);
    const endIndex = nextHeading ? sectionHtml.indexOf(`>${nextHeading.label}</h3>`, startIndex + 1) : sectionHtml.length;
    const chunk = sectionHtml.slice(startIndex, endIndex);
    const anchorMatches = Array.from(chunk.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi));

    return anchorMatches
      .map((match) => {
        const url = match[1]?.trim();
        const title = normalizeText(match[2] ?? "") || heading.label;

        if (!url || !/^https?:\/\//i.test(url)) {
          return null;
        }

        return {
          title,
          url: sanitizeDocumentUrl(url),
          category: heading.category,
        } satisfies NobbDocumentLink;
      })
      .filter((entry): entry is NobbDocumentLink => entry !== null);
  });
}

function parseInfoGroups(sectionHtml: string) {
  if (!sectionHtml) {
    return [] as NobbInfoGroup[];
  }

  const groups: NobbInfoGroup[] = [];
  const cardMatches = sectionHtml.split('<div class="mud-paper mud-elevation-0 mud-card mud-height-full bg-primary-lightest"');

  for (const rawCard of cardMatches.slice(1)) {
    const titles = Array.from(rawCard.matchAll(/<h3[^>]*>([^<]+)<\/h3>/gi))
      .map((match) => normalizeText(match[1] ?? ""))
      .filter(Boolean);
    const entries = Array.from(rawCard.matchAll(/<p[^>]*d-inline[^>]*>([^<]+)<\/p>\s*<p[^>]*d-inline[^>]*>([^<]+)<\/p>/gi))
      .map((match) => ({
        label: normalizeLabel(match[1] ?? ""),
        value: normalizeText(match[2] ?? ""),
      }))
      .filter((entry) => entry.label.length > 0 && entry.value.length > 0);

    if (titles.length === 0 || entries.length === 0) {
      continue;
    }

    groups.push({
      title: titles.join(" · "),
      entries,
    });
  }

  return dedupeInfoGroups(groups);
}

function extractSection(html: string, startHeading: string, endMarker: string) {
  const startIndex = html.indexOf(`>${startHeading}</div>`);

  if (startIndex < 0) {
    return "";
  }

  const endIndex = endMarker.startsWith("</")
    ? html.indexOf(endMarker, startIndex + 1)
    : html.indexOf(`>${endMarker}</div>`, startIndex + 1);

  return endIndex > startIndex ? html.slice(startIndex, endIndex) : html.slice(startIndex);
}

function findValueForLabel(html: string, label: string) {
  const pattern = new RegExp(
    `<p[^>]*d-inline[^>]*>${escapeRegExp(label)}:?\\s*<\\/p>\\s*<p[^>]*d-inline[^>]*>([^<]+)<\\/p>`,
    "i",
  );

  return firstMatch(html, pattern) ?? undefined;
}

function firstMatch(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1] ? normalizeText(match[1]) : undefined;
}

function normalizeLabel(value: string) {
  return normalizeText(value).replace(/:\s*$/, "");
}

function normalizeText(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function sanitizeDocumentUrl(value: string) {
  try {
    const url = new URL(decodeHtmlEntities(value));
    url.searchParams.delete("__hstc");
    url.searchParams.delete("__hssc");
    url.searchParams.delete("__hsfp");
    return url.toString();
  } catch {
    return decodeHtmlEntities(value);
  }
}

function dedupeDocuments(documents: NobbDocumentLink[]) {
  const seen = new Set<string>();

  return documents.filter((document) => {
    const key = `${document.category}:${document.title}:${document.url}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function dedupeInfoGroups(groups: NobbInfoGroup[]) {
  const seen = new Set<string>();

  return groups.filter((group) => {
    const key = `${group.title}:${group.entries.map((entry) => `${entry.label}:${entry.value}`).join("|")}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildNobbPublicUrl(nobbNumber: string) {
  return `https://www.nobb.no/nobbnr/${encodeURIComponent(nobbNumber)}`;
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
