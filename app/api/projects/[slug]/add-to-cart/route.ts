import { NextResponse } from "next/server";

import { getMaterialCatalogEntries, type MaterialCatalogEntry } from "@/lib/material-catalog";
import { projectFromRow, PROJECT_ROW_SELECT } from "@/lib/project-data";
import { getStorefrontProductsByNobb } from "@/lib/storefront";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase er ikke konfigurert." }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Innlogging kreves." }, { status: 401 });
  }

  const { data: row } = await supabase
    .from("projects")
    .select(PROJECT_ROW_SELECT)
    .eq("slug", slug)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "Prosjekt ikke funnet." }, { status: 404 });
  }

  const project = projectFromRow(row);
  const catalogEntries = await getMaterialCatalogEntries();
  const lineItems = collectLineItems(project.materialSections, catalogEntries);
  const totalRows = countTotalRows(project.materialSections);

  if (lineItems.length === 0) {
    return NextResponse.json({
      items: [],
      unmatched: [],
      matchedCount: 0,
      totalRows,
      withNobbCount: 0,
      reason: "no_nobb",
    });
  }

  const nobbNumbers = Array.from(new Set(lineItems.map((line) => line.nobbNumber)));
  const products = await getStorefrontProductsByNobb(nobbNumbers);
  const productByNobb = new Map(products.map((product) => [product.nobbNumber, product]));

  const items: { productId: string; quantity: number }[] = [];
  const unmatched: { productName: string; nobbNumber: string }[] = [];
  const seen = new Map<string, number>();

  for (const line of lineItems) {
    const product = productByNobb.get(line.nobbNumber);

    if (!product) {
      unmatched.push({ productName: line.productName, nobbNumber: line.nobbNumber });
      continue;
    }

    seen.set(product.id, (seen.get(product.id) ?? 0) + line.quantity);
  }

  for (const [productId, quantity] of seen) {
    items.push({ productId, quantity });
  }

  return NextResponse.json({
    items,
    unmatched,
    matchedCount: items.length,
    totalRows,
    withNobbCount: lineItems.length,
  });
}

function countTotalRows(sections: { items: unknown[] }[]) {
  return sections.reduce((sum, section) => sum + section.items.length, 0);
}

function collectLineItems(sections: unknown[], catalogEntries: MaterialCatalogEntry[]) {
  const lines: { productName: string; nobbNumber: string; quantity: number }[] = [];

  for (const section of sections as Array<{ title?: unknown; items?: unknown[] }>) {
    if (!Array.isArray(section?.items)) continue;
    const sectionTitle = typeof section.title === "string" ? section.title : "";
    for (const raw of section.items) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const productName =
        (typeof item.item === "string" && item.item) ||
        (typeof item.productName === "string" && item.productName) ||
        "";
      const candidate =
        (typeof item.nobb === "string" ? item.nobb : "") ||
        (typeof item.nobbNumber === "string" ? item.nobbNumber : "") ||
        extractNobbNumber(typeof item.note === "string" ? item.note : "") ||
        extractNobbNumber(productName) ||
        findCatalogMatch(productName, sectionTitle, catalogEntries)?.nobbNumber ||
        "";
      const nobb = normalizeNobbNumber(candidate);
      if (nobb.length < 6) continue;

      const quantityRaw =
        (typeof item.quantity === "string" && item.quantity) || "1 stk";

      lines.push({
        productName: productName || `NOBB ${nobb}`,
        nobbNumber: nobb,
        quantity: parseQuantityNumber(quantityRaw),
      });
    }
  }

  return lines;
}

function findCatalogMatch(itemName: string, sectionTitle: string, catalogEntries: MaterialCatalogEntry[]) {
  const needle = itemName.trim().toLowerCase();

  if (!needle) {
    return null;
  }

  for (const entry of catalogEntries) {
    const haystack = entry.productName.toLowerCase();

    if (haystack.includes(needle) || needle.includes(haystack)) {
      return entry;
    }
  }

  const itemTokens = extractProductTokens(itemName);
  if (itemTokens.length === 0) {
    return null;
  }

  const sectionKey = sectionTitle.trim().toLowerCase();
  const scored = catalogEntries
    .map((entry) => {
      const entryTokens = extractProductTokens(entry.productName);
      const overlap = itemTokens.filter((token) => entryTokens.includes(token)).length;
      const sectionMatch = sectionKey.length > 0 && (
        entry.sectionTitle.toLowerCase().includes(sectionKey) ||
        sectionKey.includes(entry.sectionTitle.toLowerCase()) ||
        entry.category.toLowerCase().includes(sectionKey) ||
        sectionKey.includes(entry.category.toLowerCase())
      );

      return {
        entry,
        score: overlap + (sectionMatch ? 2 : 0),
        overlap,
      };
    })
    .filter((candidate) => candidate.overlap > 0)
    .sort((left, right) => right.score - left.score);

  return scored[0]?.entry ?? null;
}

const PRODUCT_STOPWORDS = new Set([
  "med",
  "uten",
  "for",
  "til",
  "som",
  "stk",
  "pak",
  "sett",
  "set",
  "ubh",
  "obh",
  "ny",
  "gr",
  "lm",
  "tk",
]);

function extractProductTokens(productName: string) {
  return productName
    .toLowerCase()
    .split(/[^a-z0-9æøå]+/i)
    .map((token) => token.trim())
    .filter((token) => {
      if (token.length < 3) return false;
      if (/^\d+$/.test(token)) return false;
      if (/^\d+[a-z]/i.test(token)) return false;
      if (/^[a-z]\d+/i.test(token)) return false;
      if (PRODUCT_STOPWORDS.has(token)) return false;
      return true;
    });
}

function extractNobbNumber(value: string) {
  const match = value.match(/\b(\d{6,10})\b/);
  return match ? match[1] : "";
}

function normalizeNobbNumber(value: string) {
  const normalized = value.replace(/\D/g, "");
  return normalized.length >= 6 && normalized.length <= 10 ? normalized : "";
}

function parseQuantityNumber(raw: string) {
  const match = raw.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return 1;
  const value = parseFloat(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.round(value));
}
