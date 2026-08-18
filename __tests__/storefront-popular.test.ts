import { describe, expect, it } from "vitest";

import {
  MIN_FEATURED_MARGIN_PCT,
  POPULAR_STOREFRONT_NOBB,
  rankPopularStorefrontProducts,
  type PopularProductMargin,
} from "@/lib/storefront-popular";
import type { StorefrontProduct } from "@/lib/storefront-types";

function product(nobbNumber: string, category = "Trelast"): StorefrontProduct {
  return {
    id: `id-${nobbNumber}`,
    slug: `slug-${nobbNumber}`,
    nobbNumber,
    productName: `Vare ${nobbNumber}`,
    supplierName: "Byggmakker",
    brand: "",
    unit: "STK",
    unitPriceNok: 100,
    listPriceNok: 120,
    sectionTitle: "Byggevarer",
    category,
    description: "",
    technicalDetails: [],
    quantitySuggestion: "1 stk",
    quantityReason: "",
    lastUpdated: "2026-08-01",
    source: "price_lists",
  };
}

function margins(entries: Array<[string, number | null]>): Map<string, PopularProductMargin> {
  return new Map(entries.map(([nobb, marginPct]) => [nobb, { marginPct }]));
}

describe("populære byggevarer", () => {
  const [first, second, third] = POPULAR_STOREFRONT_NOBB;

  it("holder nullmargin-varer ute av stripa", () => {
    const ranked = rankPopularStorefrontProducts(
      [product(first), product(second)],
      margins([
        [first, 0.4],
        [second, 20],
      ]),
      12,
    );

    expect(ranked.map((p) => p.nobbNumber)).toEqual([second]);
  });

  it("holder varer med ukjent innkjøpspris ute", () => {
    const ranked = rankPopularStorefrontProducts(
      [product(first), product(second)],
      margins([
        [first, null],
        [second, 20],
      ]),
      12,
    );

    expect(ranked.map((p) => p.nobbNumber)).toEqual([second]);
  });

  it("slipper gjennom varer på grensa", () => {
    const ranked = rankPopularStorefrontProducts(
      [product(first)],
      margins([[first, MIN_FEATURED_MARGIN_PCT]]),
      12,
    );

    expect(ranked).toHaveLength(1);
  });

  it("lar populariteten avgjøre når marginen er lik", () => {
    const ranked = rankPopularStorefrontProducts(
      [product(third), product(first), product(second)],
      margins([
        [first, 20],
        [second, 20],
        [third, 20],
      ]),
      12,
    );

    expect(ranked.map((p) => p.nobbNumber)).toEqual([first, second, third]);
  });

  it("løfter høy margin, men ikke forbi en mye mer populær vare", () => {
    const lastNobb = POPULAR_STOREFRONT_NOBB[POPULAR_STOREFRONT_NOBB.length - 1]!;
    const ranked = rankPopularStorefrontProducts(
      [product(first), product(second), product(lastNobb)],
      margins([
        [first, 10],
        [second, 45],
        [lastNobb, 45],
      ]),
      12,
    );

    // Marginen flytter #2 forbi #1, men den minst populære varen blir liggende sist.
    expect(ranked.map((p) => p.nobbNumber)).toEqual([second, first, lastNobb]);
  });

  it("slipper ikke én kategori til å ta hele stripa", () => {
    const nobbs = POPULAR_STOREFRONT_NOBB.slice(0, 6);
    const ranked = rankPopularStorefrontProducts(
      nobbs.map((nobb, index) => product(nobb, index === 4 ? "Isolasjon" : "Konstruksjonsvirke")),
      margins(nobbs.map((nobb) => [nobb, 20])),
      4,
    );

    expect(ranked.map((p) => p.category)).toEqual([
      "Konstruksjonsvirke",
      "Konstruksjonsvirke",
      "Konstruksjonsvirke",
      "Isolasjon",
    ]);
  });

  it("fyller stripa med overskuddet når kategoriene er for få", () => {
    const nobbs = POPULAR_STOREFRONT_NOBB.slice(0, 6);
    const ranked = rankPopularStorefrontProducts(
      nobbs.map((nobb) => product(nobb, "Konstruksjonsvirke")),
      margins(nobbs.map((nobb) => [nobb, 20])),
      5,
    );

    expect(ranked).toHaveLength(5);
  });

  it("respekterer grensa for antall varer", () => {
    const nobbs = POPULAR_STOREFRONT_NOBB.slice(0, 8);
    const ranked = rankPopularStorefrontProducts(
      nobbs.map((nobb) => product(nobb)),
      margins(nobbs.map((nobb) => [nobb, 20])),
      4,
    );

    expect(ranked).toHaveLength(4);
  });

  it("har ingen duplikater i kandidatlista", () => {
    expect(new Set(POPULAR_STOREFRONT_NOBB).size).toBe(POPULAR_STOREFRONT_NOBB.length);
  });
});
