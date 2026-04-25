import { NextResponse } from "next/server";

import { getMaterialCatalogEntries } from "@/lib/material-catalog";
import { getPriceListProducts } from "@/lib/price-lists";

const MAX_LIMIT = 25;

type CatalogSearchEntry = {
  id: string;
  productName: string;
  quantity: string;
  comment: string;
  quantityReason: string;
  nobbNumber: string;
  supplierName: string;
  unitPriceNok: number;
  sectionTitle: string;
  category: string;
};


export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const q = requestUrl.searchParams.get("q")?.trim() || "";
  const limitRaw = requestUrl.searchParams.get("limit") || "12";
  const limitParsed = Number.parseInt(limitRaw, 10);
  const limit = Number.isFinite(limitParsed) ? Math.max(1, Math.min(MAX_LIMIT, limitParsed)) : 12;

  if (q.length < 2) {
    return NextResponse.json({ items: [] as CatalogSearchEntry[] });
  }

  const products = await getPriceListProducts();
  const catalogEntries = await getMaterialCatalogEntries(products);
  const needle = q.toLowerCase();

  const ranked = catalogEntries
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, needle),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.entry);

  return NextResponse.json({ items: ranked });
}

function scoreEntry(entry: CatalogSearchEntry, needle: string) {
  const productName = entry.productName.toLowerCase();
  const nobb = entry.nobbNumber.toLowerCase();
  const supplier = entry.supplierName.toLowerCase();
  const category = entry.category.toLowerCase();
  const section = entry.sectionTitle.toLowerCase();
  const haystack = `${productName} ${nobb} ${supplier} ${category} ${section}`;

  if (productName === needle || nobb === needle) {
    return 10;
  }

  let score = 0;

  if (productName.startsWith(needle)) {
    score += 7;
  }

  if (productName.includes(needle)) {
    score += 5;
  }

  if (nobb.includes(needle)) {
    score += 5;
  }

  if (supplier.includes(needle)) {
    score += 2;
  }

  if (category.includes(needle) || section.includes(needle)) {
    score += 2;
  }

  if (!haystack.includes(needle)) {
    return 0;
  }

  return score;
}
