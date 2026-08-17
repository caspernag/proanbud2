import { NextResponse } from "next/server";

import { getStorefrontCatalogMeta, queryStorefrontProducts } from "@/lib/storefront";

const MAX_PRODUCT_SUGGESTIONS = 5;
const MAX_CATEGORY_SUGGESTIONS = 5;

const POPULAR_SEARCHES = [
  "gipsplate",
  "terrassebord",
  "48x98",
  "isolasjon",
  "osb plate",
  "konstruksjonsskrue",
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();

  // Kategoritellingene er forhåndsberegnet i storefront_catalog_meta og cachet.
  // Denne ruta lastet tidligere hele katalogen for å telle dem selv — på hvert
  // tastetrykk, og også for tomme søk.
  const meta = await getStorefrontCatalogMeta();

  if (query.length < 2) {
    return NextResponse.json({
      query,
      searches: POPULAR_SEARCHES,
      categories: buildTopCategories(meta.categoryCounts),
      products: [],
    });
  }

  const result = await queryStorefrontProducts({ q: query, pageSize: MAX_PRODUCT_SUGGESTIONS });

  const normalizedQuery = normalize(query);
  const categoryMatches = buildTopCategories(meta.categoryCounts, Number.POSITIVE_INFINITY)
    .filter((category) => normalize(category.label).includes(normalizedQuery))
    .slice(0, MAX_CATEGORY_SUGGESTIONS);

  const products = result.items.slice(0, MAX_PRODUCT_SUGGESTIONS).map((product) => ({
    id: product.id,
    label: product.productName,
    href: `/${product.slug}`,
    meta: [product.brand, product.nobbNumber].filter(Boolean).join(" · "),
  }));

  return NextResponse.json({
    query,
    searches: POPULAR_SEARCHES.filter((search) => normalize(search).includes(normalizedQuery)).slice(0, 4),
    categories: categoryMatches,
    products,
  });
}

function buildTopCategories(
  categoryCounts: Record<string, number>,
  limit: number = MAX_CATEGORY_SUGGESTIONS,
) {
  return Object.entries(categoryCounts)
    .filter(([label]) => label.length > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "nb-NO"))
    .slice(0, limit)
    .map(([label, count]) => ({
      label,
      href: `/?category=${encodeURIComponent(label)}`,
      count,
    }));
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
