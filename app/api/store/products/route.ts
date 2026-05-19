import { NextResponse } from "next/server";

import { getByggmakkerAvailabilityBatch } from "@/lib/byggmakker-availability";
import { getStorefrontProductsByIds, queryStorefrontProducts } from "@/lib/storefront";
import type { StorefrontSortOption } from "@/lib/storefront-types";

type StockStatus = "in-stock" | "store-stock" | "backorder";
type CheckoutStockInfo = {
  status: StockStatus;
  netQuantity: number | null;
  storeCount: number;
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const ids = (requestUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (ids.length > 0) {
    const items = await getStorefrontProductsByIds(ids);
    const includeStock = requestUrl.searchParams.get("stock") !== "0";

    if (!includeStock) {
      return NextResponse.json({ items, stockByProductId: {} });
    }

    const availabilityMap = await getByggmakkerAvailabilityBatch(
      items.flatMap((product) => (product.ean ? [product.ean] : [])),
    );
    const stockByProductId: Record<string, CheckoutStockInfo> = {};

    for (const product of items) {
      if (!product.ean) continue;
      const availability = availabilityMap.get(product.ean.replace(/\D/g, ""));
      if (!availability) continue;

      stockByProductId[product.id] = {
        status: availability.netAvailable ? "in-stock" : availability.storeAvailable ? "store-stock" : "backorder",
        netQuantity: availability.netQuantity,
        storeCount: availability.storeCount,
      };
    }

    return NextResponse.json({ items, stockByProductId });
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
