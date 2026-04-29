import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getByggmakkerAvailabilityBatch } from "@/lib/byggmakker-availability";
import { getStorefrontProductsByIds, queryStorefrontProducts } from "@/lib/storefront";
import { STOREFRONT_SELECTED_STORE_COOKIE, uniqueStoreOptions } from "@/lib/storefront-store-selection";
import type { StorefrontSortOption } from "@/lib/storefront-types";

type StockStatus = "in-stock" | "stores" | "backorder";
type CheckoutStockInfo = {
  status: StockStatus;
  netQuantity: number | null;
  storeCount: number;
  storeQuantity: number;
  stores: { name: string; quantity: number }[];
  selectedStore?: { id: string; name: string; quantity: number };
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const ids = (requestUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (ids.length > 0) {
    const cookieStore = await cookies();
    const selectedStoreId = cookieStore.get(STOREFRONT_SELECTED_STORE_COOKIE)?.value ?? "";
    const items = await getStorefrontProductsByIds(ids);
    const availabilityMap = await getByggmakkerAvailabilityBatch(
      items.flatMap((product) => (product.ean ? [product.ean] : [])),
    );
    const storeOptions = uniqueStoreOptions(
      Array.from(availabilityMap.values()).flatMap((info) => info.stores),
    );
    const selectedStoreOption = selectedStoreId
      ? storeOptions.find((store) => store.id === selectedStoreId) ?? null
      : null;
    const stockByProductId: Record<string, CheckoutStockInfo> = {};

    for (const product of items) {
      if (!product.ean) continue;
      const availability = availabilityMap.get(product.ean.replace(/\D/g, ""));
      if (!availability) continue;

      const status = availability.netAvailable
        ? "in-stock"
        : availability.storeAvailable
          ? "stores"
          : "backorder";
      const selectedStore = selectedStoreId
        ? availability.stores.find((store) => store.id === selectedStoreId)
        : null;

      stockByProductId[product.id] = {
        status: selectedStoreId
          ? selectedStore && selectedStore.quantity > 0
            ? "stores"
            : "backorder"
          : status,
        netQuantity: availability.netQuantity,
        storeCount: availability.storeCount,
        storeQuantity: availability.stores.reduce((sum, store) => sum + store.quantity, 0),
        stores: availability.stores.slice(0, 3).map((store) => ({
          name: store.name,
          quantity: store.quantity,
        })),
        ...(selectedStore || selectedStoreOption
          ? {
              selectedStore: selectedStore
                ? { id: selectedStore.id, name: selectedStore.name, quantity: selectedStore.quantity }
                : { id: selectedStoreOption!.id, name: selectedStoreOption!.name, quantity: 0 },
            }
          : {}),
      };
    }

    return NextResponse.json({ items, stockByProductId, storeOptions });
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
