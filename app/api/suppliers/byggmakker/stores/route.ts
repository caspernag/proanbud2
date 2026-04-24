import { NextResponse } from "next/server";

import { getByggmakkerAvailabilityBatch } from "@/lib/byggmakker-availability";
import { getPriceListProducts } from "@/lib/price-lists";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Ugyldig JSON." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !Array.isArray((body as { nobbs?: unknown }).nobbs)) {
    return NextResponse.json({ ok: false, message: "Mangler 'nobbs'-liste." }, { status: 400 });
  }

  const rawNobbs = ((body as { nobbs: unknown[] }).nobbs as unknown[])
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    .map((n) => n.trim())
    .slice(0, 200); // hard cap

  if (rawNobbs.length === 0) {
    return NextResponse.json({ ok: true, stores: [] });
  }

  // Resolve EANs from price list
  const products = await getPriceListProducts();
  const nobbToEan = new Map<string, string>();
  for (const nobb of rawNobbs) {
    const match = products.find((p) => p.nobbNumber === nobb && p.ean);
    if (match?.ean) {
      nobbToEan.set(nobb, match.ean);
    }
  }

  const eans = Array.from(new Set(nobbToEan.values()));

  if (eans.length === 0) {
    return NextResponse.json({ ok: true, stores: [] });
  }

  const availabilityMap = await getByggmakkerAvailabilityBatch(eans);
  const totalProducts = eans.length;

  // Aggregate: store id → { name, productCount }
  const storeMap = new Map<string, { name: string; count: number }>();

  for (const availability of availabilityMap.values()) {
    for (const store of availability.stores) {
      if (!store.id || !store.name) continue;
      const existing = storeMap.get(store.id);
      if (existing) {
        existing.count += 1;
      } else {
        storeMap.set(store.id, { name: store.name, count: 1 });
      }
    }
  }

  const stores = Array.from(storeMap.entries())
    .map(([id, { name, count }]) => ({ id, name, productCount: count, totalProducts }))
    .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name, "nb-NO"));

  return NextResponse.json({ ok: true, stores });
}
