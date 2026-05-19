import { NextResponse } from "next/server";

import { getStorefrontProducts, queryStorefrontProducts } from "@/lib/storefront";

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

  if (query.length < 2) {
    const { products } = await getStorefrontProducts();
    const categories = buildTopCategories(products);

    return NextResponse.json({
      query,
      searches: POPULAR_SEARCHES,
      categories,
      products: [],
    });
  }

  const [result, catalog] = await Promise.all([
    queryStorefrontProducts({ q: query, pageSize: MAX_PRODUCT_SUGGESTIONS }),
    getStorefrontProducts(),
  ]);

  const normalizedQuery = normalize(query);
  const categoryMatches = buildTopCategories(catalog.products)
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

function buildTopCategories(products: Awaited<ReturnType<typeof getStorefrontProducts>>["products"]) {
  const counts = new Map<string, number>();

  for (const product of products) {
    if (!product.category) continue;
    counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "nb-NO"))
    .slice(0, MAX_CATEGORY_SUGGESTIONS)
    .map(([label, count]) => ({
      label,
      href: `/?category=${encodeURIComponent(label)}`,
      count,
    }));
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
