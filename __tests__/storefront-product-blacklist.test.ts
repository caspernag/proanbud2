import { afterEach, describe, expect, it } from "vitest";

import {
  filterStorefrontBlacklistedProducts,
  getStorefrontProductBlacklistEntries,
  isStorefrontProductBlacklisted,
} from "@/lib/storefront-product-blacklist";
import type { StorefrontProduct } from "@/lib/storefront-types";

const product = makeProduct({
  id: "byggmakker-12345678",
  slug: "terrassebord-byggmakker-12345678",
  nobbNumber: "12345678",
  ean: "7040431234567",
  productName: "Terrassebord furu 28x120",
});

afterEach(() => {
  delete process.env.STOREFRONT_PRODUCT_BLACKLIST;
});

describe("storefront product blacklist", () => {
  it("matches products by runtime NOBB number", () => {
    process.env.STOREFRONT_PRODUCT_BLACKLIST = "12345678";

    expect(isStorefrontProductBlacklisted(product)).toBe(true);
  });

  it("supports explicit runtime blacklist fields", () => {
    process.env.STOREFRONT_PRODUCT_BLACKLIST = "ean:7040431234567, slug:annen-vare, name:terrassebord";

    expect(getStorefrontProductBlacklistEntries()).toEqual([
      { ean: "7040431234567" },
      { slug: "annen-vare" },
      { productName: "terrassebord" },
    ]);
    expect(isStorefrontProductBlacklisted(product)).toBe(true);
  });

  it("filters blacklisted products from a product list", () => {
    process.env.STOREFRONT_PRODUCT_BLACKLIST = "id:byggmakker-12345678";

    const visibleProduct = makeProduct({
      id: "byggmakker-87654321",
      slug: "gipsplate-byggmakker-87654321",
      nobbNumber: "87654321",
      productName: "Gipsplate standard",
    });

    expect(filterStorefrontBlacklistedProducts([product, visibleProduct])).toEqual([visibleProduct]);
  });
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