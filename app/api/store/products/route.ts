import { NextResponse } from "next/server";

import { getStorefrontProductsByIds, queryStorefrontProducts } from "@/lib/storefront";
import type { StorefrontSortOption } from "@/lib/storefront-types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const ids = (requestUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (ids.length > 0) {
    const items = await getStorefrontProductsByIds(ids);
    return NextResponse.json({ items });
  }

  const page = Number.parseInt(requestUrl.searchParams.get("page") ?? "1", 10);
  const pageSize = Number.parseInt(requestUrl.searchParams.get("pageSize") ?? "24", 10);

  const result = await queryStorefrontProducts({
    q: requestUrl.searchParams.get("q") ?? "",
    category: requestUrl.searchParams.get("category") ?? "",
    supplier: requestUrl.searchParams.get("supplier") ?? "",
    sort: (requestUrl.searchParams.get("sort") ?? "relevance") as StorefrontSortOption,
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 24,
  });

  return NextResponse.json(result);
}
