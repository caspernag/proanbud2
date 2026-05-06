import { getByggmakkerAvailability } from "@/lib/byggmakker-availability";
import type { PriceListProduct } from "@/lib/price-lists";
import type { MaterialSection } from "@/lib/project-data";

const GENERIC_SINGLE_TOKEN_MATCHES = new Set([
  "beslag",
  "bord",
  "bånd",
  "duk",
  "fuge",
  "fugemasse",
  "lim",
  "list",
  "lister",
  "maling",
  "olje",
  "plate",
  "plater",
  "primer",
  "skrue",
  "skruer",
  "sparkel",
]);

type CatalogAvailabilityCache = Map<string, boolean>;

type CatalogMatchCandidate = {
  product: PriceListProduct;
  score: number;
  nameCoverage: number;
  nameOverlap: number;
  sectionOverlap: number;
};

export async function constrainMaterialSectionsToCatalog(
  sections: MaterialSection[] | null,
  products: PriceListProduct[],
) {
  if (!sections || sections.length === 0) {
    return null;
  }

  if (products.length === 0) {
    return sections;
  }

  const normalized: MaterialSection[] = [];
  const byggmakkerAvailabilityCache: CatalogAvailabilityCache = new Map();

  for (const section of sections) {
    const items: MaterialSection["items"] = [];

    for (const item of section.items) {
      const bestMatch = await findAvailableCatalogMatch(
        item,
        section,
        products,
        byggmakkerAvailabilityCache,
      );

      if (!bestMatch) {
        items.push(item);
        continue;
      }

      items.push({
        ...item,
        item: bestMatch.productName,
        nobb: bestMatch.nobbNumber,
        quantityReason: item.quantityReason || bestMatch.quantityReason,
        note: `${item.note}${item.note ? " | " : ""}Valgt fra aktiv leverandørkatalog (${bestMatch.supplierName}).`.slice(0, 1200),
      });
    }

    if (items.length === 0) {
      continue;
    }

    normalized.push({
      ...section,
      items,
    });
  }

  return normalized.length > 0 ? normalized : null;
}

export function findConfidentPriceListProductMatch(
  item: Pick<MaterialSection["items"][number], "item" | "note" | "nobb">,
  section: Pick<MaterialSection, "title" | "description">,
  products: PriceListProduct[],
) {
  const directNobb = normalizeNobb(item.nobb) || extractNobb(item.item) || extractNobb(item.note);

  if (directNobb) {
    const direct = products.find((product) => product.nobbNumber === directNobb);

    if (direct) {
      return direct;
    }
  }

  const itemName = normalizeComparableText(item.item);
  const exactName = products.find((product) => normalizeComparableText(product.productName) === itemName);

  if (exactName) {
    return exactName;
  }

  const itemTokens = tokenizeForCatalogMatch(item.item);

  if (itemTokens.length === 0 || isUnsafeSingleTokenQuery(itemTokens)) {
    return null;
  }

  const sectionTokens = tokenizeForCatalogMatch(`${section.title} ${section.description}`);
  let bestCandidate: CatalogMatchCandidate | null = null;

  for (const product of products) {
    const productTokens = tokenizeForCatalogMatch(product.productName);

    if (productTokens.length === 0) {
      continue;
    }

    const catalogTokens = tokenizeForCatalogMatch(`${product.sectionTitle} ${product.category}`);
    const nameOverlap = countTokenOverlap(itemTokens, productTokens);

    if (nameOverlap === 0) {
      continue;
    }

    const sectionOverlap = countTokenOverlap(sectionTokens, catalogTokens);
    const nameCoverage = nameOverlap / itemTokens.length;
    const score = nameOverlap / Math.max(itemTokens.length, productTokens.length) + sectionOverlap * 0.03;
    const candidate = {
      product,
      score,
      nameCoverage,
      nameOverlap,
      sectionOverlap,
    };

    if (!isConfidentCatalogCandidate(candidate, itemTokens)) {
      continue;
    }

    if (!bestCandidate || compareCatalogCandidates(candidate, bestCandidate) > 0) {
      bestCandidate = candidate;
    }
  }

  return bestCandidate?.product ?? null;
}

async function findAvailableCatalogMatch(
  item: MaterialSection["items"][number],
  section: MaterialSection,
  products: PriceListProduct[],
  byggmakkerAvailabilityCache: CatalogAvailabilityCache,
) {
  const match = findConfidentPriceListProductMatch(item, section, products);

  if (!match) {
    return null;
  }

  const isAvailable = await isCatalogProductAvailableForMaterialList(
    match,
    byggmakkerAvailabilityCache,
  );

  return isAvailable ? match : null;
}

function compareCatalogCandidates(left: CatalogMatchCandidate, right: CatalogMatchCandidate) {
  if (left.nameCoverage !== right.nameCoverage) {
    return left.nameCoverage - right.nameCoverage;
  }

  if (left.nameOverlap !== right.nameOverlap) {
    return left.nameOverlap - right.nameOverlap;
  }

  if (left.score !== right.score) {
    return left.score - right.score;
  }

  return left.sectionOverlap - right.sectionOverlap;
}

function isConfidentCatalogCandidate(candidate: CatalogMatchCandidate, itemTokens: string[]) {
  if (candidate.nameCoverage >= 0.72 && candidate.score >= 0.18) {
    return true;
  }

  if (candidate.nameOverlap >= 2 && candidate.nameCoverage >= 0.5 && candidate.score >= 0.2) {
    return true;
  }

  if (itemTokens.length === 1 && candidate.nameCoverage === 1 && candidate.score >= 0.24) {
    return true;
  }

  return false;
}

async function isCatalogProductAvailableForMaterialList(
  product: PriceListProduct,
  byggmakkerAvailabilityCache: CatalogAvailabilityCache,
) {
  if (!product.supplierName.toLowerCase().includes("byggmakker")) {
    return true;
  }

  const cacheKey = (product.ean ?? "").trim();

  if (!cacheKey) {
    return false;
  }

  const cached = byggmakkerAvailabilityCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const availability = await getByggmakkerAvailability(cacheKey);
  const isAvailable = Boolean(availability?.netAvailable);
  byggmakkerAvailabilityCache.set(cacheKey, isAvailable);
  return isAvailable;
}

function isUnsafeSingleTokenQuery(tokens: string[]) {
  return tokens.length === 1 && GENERIC_SINGLE_TOKEN_MATCHES.has(tokens[0]);
}

function countTokenOverlap(sourceTokens: string[], targetTokens: string[]) {
  let overlap = 0;

  for (const sourceToken of sourceTokens) {
    if (targetTokens.some((targetToken) => tokensMatch(sourceToken, targetToken))) {
      overlap += 1;
    }
  }

  return overlap;
}

function tokensMatch(left: string, right: string) {
  if (left === right) {
    return true;
  }

  const leftVariants = tokenVariants(left);
  const rightVariants = tokenVariants(right);

  return leftVariants.some((variant) => rightVariants.includes(variant));
}

function tokenVariants(token: string) {
  const variants = new Set([token]);
  const suffixes = ["ene", "ane", "er", "ar", "en", "et", "a", "e", "s"];

  for (const suffix of suffixes) {
    if (token.length > suffix.length + 4 && token.endsWith(suffix)) {
      variants.add(token.slice(0, -suffix.length));
    }
  }

  return Array.from(variants);
}

function normalizeComparableText(value: string) {
  return value
    .toLocaleLowerCase("nb-NO")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9æøå]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForCatalogMatch(value: string) {
  return normalizeComparableText(value)
    .split(" ")
    .filter((token) => token.length > 1 && token !== "og");
}

function extractNobb(value: string) {
  const match = value.match(/\b(\d{6,10})\b/);
  return match ? match[1] : "";
}

function normalizeNobb(value?: string) {
  if (!value) {
    return "";
  }

  const normalized = value.replace(/\D/g, "");
  return normalized.length >= 6 && normalized.length <= 10 ? normalized : "";
}