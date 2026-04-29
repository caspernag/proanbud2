import { describe, expect, it } from "vitest";

import {
  createEmptyStorefrontUserProfile,
  parseStorefrontUserProfileCookie,
  scoreStorefrontProductForUserProfile,
  serializeStorefrontUserProfileCookie,
  trackStorefrontProductView,
  trackStorefrontSearch,
} from "@/lib/storefront-user-profile";
import type { StorefrontProduct } from "@/lib/storefront-types";

describe("storefront user profile", () => {
  it("builds a compact product profile from viewed products", () => {
    const profile = trackStorefrontProductView(createEmptyStorefrontUserProfile(), terraceProduct);

    expect(profile.recentNobbs).toEqual(["12345678"]);
    expect(profile.categories[0]).toMatchObject({ key: "terrasse" });
    expect(profile.terms.some((signal) => signal.key === "terrassebord")).toBe(true);
  });

  it("roundtrips profile data through the cookie serializer", () => {
    const profile = trackStorefrontSearch(createEmptyStorefrontUserProfile(), {
      q: "terrassebord brun",
      category: "Terrasse",
    });

    const parsed = parseStorefrontUserProfileCookie(serializeStorefrontUserProfileCookie(profile));

    expect(parsed.queries[0]).toMatchObject({ key: "terrassebord brun" });
    expect(parsed.categories[0]).toMatchObject({ key: "terrasse" });
  });

  it("scores products that match the profile above unrelated products", () => {
    const profile = trackStorefrontProductView(createEmptyStorefrontUserProfile(), terraceProduct);

    expect(scoreStorefrontProductForUserProfile(terraceProduct, profile)).toBeGreaterThan(
      scoreStorefrontProductForUserProfile(gipsProduct, profile),
    );
  });
});

const terraceProduct = makeProduct({
  id: "terrasse-12345678",
  slug: "terrassebord-furu-12345678",
  nobbNumber: "12345678",
  productName: "Terrassebord furu brun 28x120",
  category: "Terrasse",
  sectionTitle: "Trelast",
  brand: "Furu",
});

const gipsProduct = makeProduct({
  id: "gips-87654321",
  slug: "gipsplate-standard-87654321",
  nobbNumber: "87654321",
  productName: "Gipsplate standard 12,5 mm",
  category: "Gips og plater",
  sectionTitle: "Plater",
  brand: "",
});

function makeProduct(overrides: Partial<StorefrontProduct>): StorefrontProduct {
  return {
    id: "id",
    slug: "slug",
    nobbNumber: "00000000",
    productName: "Produkt",
    supplierName: "Byggmakker",
    brand: "",
    unit: "STK",
    unitPriceNok: 100,
    listPriceNok: 120,
    sectionTitle: "Byggevarer",
    category: "Diverse",
    description: "Produkt",
    technicalDetails: [],
    quantitySuggestion: "1 stk",
    quantityReason: "Test",
    lastUpdated: "2026-04-29",
    source: "price_lists",
    ...overrides,
  };
}