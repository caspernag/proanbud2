import { NextResponse } from "next/server";

import { getByggmakkerAvailability } from "@/lib/byggmakker-availability";
import { getPriceListProductByNobb } from "@/lib/price-lists";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const nobb = (searchParams.get("nobb") || searchParams.get("query") || "").trim();

  if (!nobb) {
    return NextResponse.json(
      { ok: false, message: "Mangler nobb-nummer." },
      { status: 400 },
    );
  }

  // Resolve EAN from price list (same approach as the storefront).
  const product = await getPriceListProductByNobb(nobb);
  const ean = product?.ean ?? null;

  if (!ean) {
    return NextResponse.json({
      ok: false,
      nobb,
      message: "EAN ikke funnet for dette produktet.",
    });
  }

  const availability = await getByggmakkerAvailability(ean);

  if (!availability) {
    return NextResponse.json({
      ok: false,
      nobb,
      ean,
      message: "Fant ikke lagerstatus hos Byggmakker.",
    });
  }

  return NextResponse.json({
    ok: true,
    ...availability,
  });
}
