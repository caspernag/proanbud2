import OpenAI from "openai";
import { z } from "zod";

import { env, hasOpenAiEnv } from "@/lib/env";

const MAX_HTML_CHARS = 260_000;
const MAX_TEXT_CHARS = 22_000;
const FETCH_TIMEOUT_MS = 16_000;

const webProductSchema = z.object({
  foundProduct: z.boolean(),
  reason: z.string().max(280).optional(),
  product: z.unknown().optional(),
});

export type ImportedWebProduct = {
  productName: string;
  quantity: string;
  comment: string;
  quantityReason: string;
  supplierName?: string;
  nobbNumber?: string;
  imageUrl?: string;
  productUrl: string;
  unitPriceNok?: number;
};

export type AnalyzeProductUrlResult =
  | {
      ok: true;
      product: ImportedWebProduct;
    }
  | {
      ok: false;
      reason: "not_found" | "error";
      message: string;
    };

export async function analyzeProductFromUrl(rawUrl: string): Promise<AnalyzeProductUrlResult> {
  const normalizedUrl = normalizeHttpUrl(rawUrl);

  if (!normalizedUrl) {
    return {
      ok: false,
      reason: "error",
      message: "Ugyldig lenke. Bruk en gyldig http/https-produktlenke.",
    };
  }

  if (isBlockedHost(normalizedUrl)) {
    return {
      ok: false,
      reason: "error",
      message: "Lenken kan ikke analyseres.",
    };
  }

  if (!hasOpenAiEnv()) {
    return {
      ok: false,
      reason: "error",
      message: "OpenAI er ikke konfigurert for analyse av produktlenker.",
    };
  }

  const pageSnapshot = await fetchPageSnapshot(normalizedUrl);

  if (!pageSnapshot) {
    return {
      ok: false,
      reason: "error",
      message: "Kunne ikke hente nettsiden akkurat nå.",
    };
  }

  const aiOutput = await runOpenAiExtraction(pageSnapshot);

  if (!aiOutput) {
    return {
      ok: false,
      reason: "error",
      message: "Kunne ikke analysere nettsiden med AI.",
    };
  }

  if (!aiOutput.foundProduct) {
    return {
      ok: false,
      reason: "not_found",
      message: aiOutput.reason || "Fant ikke et gyldig produkt på siden.",
    };
  }

  const productPayload = asRecord(aiOutput.product);

  const normalizedNobb = normalizeNobb(readStringField(productPayload, "nobbNumber"));
  const imageUrl = normalizeHttpUrl(readStringField(productPayload, "imageUrl") || pageSnapshot.ogImage || "");
  const productUrl = normalizeHttpUrl(readStringField(productPayload, "productUrl") || pageSnapshot.finalUrl || normalizedUrl);
  const quantity = normalizeQuantity(readStringField(productPayload, "quantity"));
  const unitPriceNok = normalizePriceNok(readNumberField(productPayload, "unitPriceNok"), readStringField(productPayload, "currency"));

  if (!productUrl) {
    return {
      ok: false,
      reason: "not_found",
      message: "Fant ikke gyldig produktlenke i analysen.",
    };
  }

  if (!normalizedNobb && !imageUrl) {
    return {
      ok: false,
      reason: "not_found",
      message: "Produkt uten NOBB må ha bilde fra nettsiden for å kunne legges til.",
    };
  }

  const productName = normalizeText(
    readStringField(productPayload, "productName") || pageSnapshot.ogTitle || pageSnapshot.title,
    220,
  );
  const shortDescription = normalizeText(
    readStringField(productPayload, "shortDescription") ||
      pageSnapshot.ogDescription ||
      pageSnapshot.metaDescription ||
      `Produkt hentet fra ${pageSnapshot.hostLabel}.`,
    1200,
  );

  if (!productName || !shortDescription) {
    return {
      ok: false,
      reason: "not_found",
      message: "Fant ikke nok produktinformasjon på nettsiden.",
    };
  }

  const quantityReason =
    normalizeText(readStringField(productPayload, "quantityReason") || "", 320) ||
    "Mengde satt fra nettsideanalyse. Kontroller mot prosjektbehov.";

  const commentParts = [shortDescription, `Kilde: ${productUrl}`];

  if (unitPriceNok !== undefined) {
    commentParts.push(`Veiledende pris: ${unitPriceNok} NOK`);
  }

  return {
    ok: true,
    product: {
      productName,
      quantity,
      comment: commentParts.join(" | ").slice(0, 1200),
      quantityReason,
      ...(normalizeText(readStringField(productPayload, "supplierName") || pageSnapshot.hostLabel, 120)
        ? { supplierName: normalizeText(readStringField(productPayload, "supplierName") || pageSnapshot.hostLabel, 120) }
        : {}),
      ...(normalizedNobb ? { nobbNumber: normalizedNobb } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      productUrl,
      ...(unitPriceNok !== undefined ? { unitPriceNok } : {}),
    },
  };
}

type PageSnapshot = {
  finalUrl: string;
  hostLabel: string;
  title: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  pageText: string;
  jsonLdSummary: string;
};

async function fetchPageSnapshot(url: string): Promise<PageSnapshot | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "ProanbudBot/1.0 (+https://proanbud.no)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return null;
    }

    const html = (await response.text()).slice(0, MAX_HTML_CHARS);
    const finalUrl = normalizeHttpUrl(response.url) || url;
    const finalHost = safeHost(finalUrl);

    const jsonLdBlocks = extractJsonLdBlocks(html);
    const productFromJsonLd = extractProductHintFromJsonLd(jsonLdBlocks);

    const title =
      extractTagContent(html, "title") ||
      extractMetaTag(html, "property", "og:title") ||
      productFromJsonLd.name ||
      "";

    const metaDescription =
      extractMetaTag(html, "name", "description") ||
      extractMetaTag(html, "property", "og:description") ||
      productFromJsonLd.description ||
      "";

    const ogTitle = extractMetaTag(html, "property", "og:title") || productFromJsonLd.name || "";
    const ogDescription =
      extractMetaTag(html, "property", "og:description") || productFromJsonLd.description || "";

    const ogImage =
      normalizeHttpUrl(extractMetaTag(html, "property", "og:image") || productFromJsonLd.image || "") ||
      "";

    const pageText = stripHtmlToText(html).slice(0, MAX_TEXT_CHARS);

    const jsonLdSummary = JSON.stringify(
      {
        productHint: productFromJsonLd,
        itemCount: jsonLdBlocks.length,
      },
      null,
      2,
    ).slice(0, 6000);

    return {
      finalUrl,
      hostLabel: finalHost,
      title,
      metaDescription,
      ogTitle,
      ogDescription,
      ogImage,
      pageText,
      jsonLdSummary,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function runOpenAiExtraction(snapshot: PageSnapshot) {
  try {
    const openai = new OpenAI({ apiKey: env.openAiApiKey });

    const prompt = [
      "Du analyserer produktsider for byggevare/materialliste.",
      "Svar KUN gyldig JSON.",
      "Returner shape:",
      "{",
      '  "foundProduct": boolean,',
      '  "reason"?: string,',
      '  "product"?: {',
      '    "productName": string,',
      '    "quantity"?: string,',
      '    "shortDescription": string,',
      '    "quantityReason"?: string,',
      '    "supplierName"?: string,',
      '    "nobbNumber"?: string,',
      '    "imageUrl"?: string,',
      '    "productUrl"?: string,',
      '    "unitPriceNok"?: number,',
      '    "currency"?: string',
      "  }",
      "}",
      "",
      "Regler:",
      "1) foundProduct=true kun hvis siden faktisk beskriver ett konkret produkt som kan legges i en materialliste.",
      "2) Hvis NOBB ikke finnes, krev et bilde-URL hvis tilgjengelig fra siden.",
      "3) quantity skal være egnet for materialliste-kolonne (f.eks. '1 stk', '1 spann', '1 pakke').",
      "4) shortDescription skal være kort og konkret om produktet.",
      "5) Hvis ikke gyldig produktside: foundProduct=false og reason.",
      "",
      `Final URL: ${snapshot.finalUrl}`,
      `Host: ${snapshot.hostLabel}`,
      `TITLE: ${snapshot.title}`,
      `META DESCRIPTION: ${snapshot.metaDescription}`,
      `OG TITLE: ${snapshot.ogTitle}`,
      `OG DESCRIPTION: ${snapshot.ogDescription}`,
      `OG IMAGE: ${snapshot.ogImage}`,
      "",
      "JSON-LD hint:",
      snapshot.jsonLdSummary,
      "",
      "Utdrag fra nettsidetekst:",
      snapshot.pageText,
    ].join("\n");

    const response = await openai.responses.create({
      model: "gpt-5-mini",
      input: prompt,
      text: {
        format: {
          type: "json_object",
        },
      },
      tools: [
        { type: "web_search" },
      ],
    });

    const output = response.output_text?.trim();

    if (!output) {
      return null;
    }

    const parsed = parseJsonWithFenceFallback(output);

    if (!parsed) {
      return null;
    }

    const validated = webProductSchema.safeParse(parsed);

    if (!validated.success) {
      return null;
    }

    return validated.data;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function readStringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readNumberField(record: Record<string, unknown>, key: string) {
  const value = record[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/\s+/g, "").replace(",", "."));

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function parseJsonWithFenceFallback(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    const fenced = normalized.match(/^```(?:json)?\s*([\s\S]+?)\s*```$/i);

    if (!fenced) {
      return null;
    }

    try {
      return JSON.parse(fenced[1]) as unknown;
    } catch {
      return null;
    }
  }
}

function normalizeHttpUrl(value: string) {
  if (!value || typeof value !== "string") {
    return "";
  }

  try {
    const parsed = new URL(value.trim());

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function isBlockedHost(url: string) {
  try {
    const { hostname } = new URL(url);
    const lowered = hostname.toLowerCase();

    if (lowered === "localhost" || lowered === "127.0.0.1" || lowered === "::1") {
      return true;
    }

    if (lowered.endsWith(".local")) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "nettside";
  }
}

function normalizeText(value: string, maxLength: number) {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return "";
  }

  return normalized.slice(0, maxLength);
}

function normalizeQuantity(value?: string) {
  const normalized = normalizeText(value || "", 80);

  if (!normalized) {
    return "1 stk";
  }

  return normalized;
}

function normalizeNobb(value?: string) {
  if (!value) {
    return "";
  }

  const match = value.replace(/\D/g, "");

  if (match.length < 6 || match.length > 10) {
    return "";
  }

  return match;
}

function normalizePriceNok(value: number | undefined, currency: string | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  const normalizedCurrency = (currency || "NOK").toUpperCase();

  if (normalizedCurrency !== "NOK") {
    return undefined;
  }

  return Math.round(value);
}

function extractTagContent(html: string, tag: string) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = html.match(regex);
  return match ? decodeEntities(stripHtmlToText(match[1])).trim() : "";
}

function extractMetaTag(html: string, attrName: "name" | "property", attrValue: string) {
  const regex = new RegExp(
    `<meta[^>]*${attrName}=["']${escapeRegExp(attrValue)}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    "i",
  );

  const direct = html.match(regex);

  if (direct) {
    return decodeEntities(direct[1]).trim();
  }

  const reverseRegex = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*${attrName}=["']${escapeRegExp(attrValue)}["'][^>]*>`,
    "i",
  );
  const reverse = html.match(reverseRegex);

  return reverse ? decodeEntities(reverse[1]).trim() : "";
}

function extractJsonLdBlocks(html: string) {
  const blocks: unknown[] = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(regex)) {
    const raw = match[1]?.trim();

    if (!raw) {
      continue;
    }

    try {
      blocks.push(JSON.parse(raw) as unknown);
    } catch {
      continue;
    }
  }

  return blocks;
}

function extractProductHintFromJsonLd(blocks: unknown[]) {
  const queue = [...blocks];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || typeof current !== "object") {
      continue;
    }

    if (Array.isArray(current)) {
      for (const entry of current) {
        queue.push(entry);
      }
      continue;
    }

    const record = current as Record<string, unknown>;
    const typeValue = record["@type"];
    const types = Array.isArray(typeValue) ? typeValue.map(String) : typeof typeValue === "string" ? [typeValue] : [];

    if (types.some((type) => type.toLowerCase().includes("product"))) {
      const image = record.image;
      const imageValue =
        typeof image === "string"
          ? image
          : Array.isArray(image) && image.length > 0 && typeof image[0] === "string"
            ? image[0]
            : "";

      let price: number | undefined;
      let currency = "";
      const offers = record.offers;

      if (offers && typeof offers === "object") {
        const offerRecord = Array.isArray(offers) ? offers[0] : offers;

        if (offerRecord && typeof offerRecord === "object") {
          const offer = offerRecord as Record<string, unknown>;
          const rawPrice = offer.price;
          const parsedPrice =
            typeof rawPrice === "number"
              ? rawPrice
              : typeof rawPrice === "string"
                ? Number.parseFloat(rawPrice.replace(/\s+/g, "").replace(",", "."))
                : Number.NaN;

          if (Number.isFinite(parsedPrice)) {
            price = parsedPrice;
          }

          currency = typeof offer.priceCurrency === "string" ? offer.priceCurrency : "";
        }
      }

      const brand = record.brand;
      const brandName =
        typeof brand === "string"
          ? brand
          : brand && typeof brand === "object" && typeof (brand as Record<string, unknown>).name === "string"
            ? String((brand as Record<string, unknown>).name)
            : "";

      return {
        name: typeof record.name === "string" ? record.name : "",
        description: typeof record.description === "string" ? record.description : "",
        image: imageValue,
        brand: brandName,
        sku: typeof record.sku === "string" ? record.sku : "",
        gtin: typeof record.gtin13 === "string" ? record.gtin13 : typeof record.gtin === "string" ? record.gtin : "",
        price,
        currency,
      };
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return {
    name: "",
    description: "",
    image: "",
    brand: "",
    sku: "",
    gtin: "",
    price: undefined as number | undefined,
    currency: "",
  };
}

function stripHtmlToText(value: string) {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  )
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
