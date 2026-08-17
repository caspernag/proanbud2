import { describe, expect, it } from "vitest";

import { scoreStorefrontProduct } from "@/lib/storefront";
import type { StorefrontProduct } from "@/lib/storefront-types";

describe("storefront search", () => {
  it("matches product subtitle and title together", () => {
    const terraceScrew = makeProduct({
      productName: "TERRASSESKR CLASSIC UTV 4,2X55",
      brand: "TERRASSESKRUE A2 RUSTFRI",
      description: "TERRASSESKRUE A2 RUSTFRI",
      technicalDetails: ["TERRASSESKRUE A2 RUSTFRI", "Salgsenhet: PAK"],
      category: "Festemidler",
      sectionTitle: "Utvendig og terrasse",
    });

    expect(scoreStorefrontProduct(terraceScrew, "terrasseskrue a2 rustfri")).toBeGreaterThan(0);
    expect(scoreStorefrontProduct(terraceScrew, "terrasseskrue a2 rustfri classic utv 4,2x55")).toBeGreaterThan(0);
  });

  it("ranks a subtitle and title match above a title-only partial match", () => {
    const preciseMatch = makeProduct({
      productName: "TERRASSESKR CLASSIC UTV 4,2X55",
      brand: "TERRASSESKRUE A2 RUSTFRI",
      description: "TERRASSESKRUE A2 RUSTFRI",
      technicalDetails: ["TERRASSESKRUE A2 RUSTFRI"],
    });
    const looseMatch = makeProduct({
      productName: "TERRASSESKR CLASSIC UTV 4,8X75",
      brand: "TERRASSESKRUE FZV",
      description: "TERRASSESKRUE FZV",
      technicalDetails: ["TERRASSESKRUE FZV"],
    });

    expect(scoreStorefrontProduct(preciseMatch, "terrasseskrue a2 rustfri classic 4,2x55")).toBeGreaterThan(
      scoreStorefrontProduct(looseMatch, "terrasseskrue a2 rustfri classic 4,2x55"),
    );
  });

  it("does not treat text-only searches as numeric exact matches", () => {
    const product = makeProduct({
      productName: "TERRASSESKR CLASSIC UTV 4,2X55",
      brand: "TERRASSESKRUE A2 RUSTFRI",
    });

    expect(scoreStorefrontProduct(product, "heltannet")).toBe(0);
  });

  it("does not include weak multi-token matches as search results", () => {
    const weakMatch = makeProduct({
      productName: "SORTIMENTSKASSE SKRUER",
      brand: "DIVERSE FESTEMIDLER",
      description: "Blandet skruesortiment",
      technicalDetails: ["A2", "Rustfri"],
      category: "Festemidler",
      sectionTitle: "Utvendig og terrasse",
    });

    expect(scoreStorefrontProduct(weakMatch, "terrasseskrue a2 rustfri classic 4,2x55")).toBe(0);
  });

  it("still allows precise single-token category searches", () => {
    const product = makeProduct({
      productName: "TRESKRUE 5,0X60",
      category: "Festemidler",
      sectionTitle: "Skruer og beslag",
    });

    expect(scoreStorefrontProduct(product, "festemidler")).toBeGreaterThan(0);
  });

  // Prislisten skriver dimensjoner nullpolstret (48X098), folk søker uten
  // nullen (48x98). Begge sider kanoniseres, så alle skriveformer skal treffe.
  // Samme regel er speilet i SQL-kolonnen search_dims — endrer du den ene, må
  // den andre følge etter.
  describe("dimensjonssøk", () => {
    const kVirke = makeProduct({
      productName: "GRAN 48X098 K-VIRKE C24",
      description: "GRAN 48X098 K-VIRKE C24",
      category: "Trelast",
    });

    it.each(["48x98", "48x098", "48 x 98", "48X98", "48×98"])(
      "finner nullpolstret dimensjon med skrivemåten %s",
      (query) => {
        expect(scoreStorefrontProduct(kVirke, query)).toBeGreaterThan(0);
      },
    );

    it("gir samme score uansett om søket har ledende null", () => {
      expect(scoreStorefrontProduct(kVirke, "48x98")).toBe(
        scoreStorefrontProduct(kVirke, "48x098"),
      );
    });

    it("gjelder også lekt-dimensjoner", () => {
      const lekt = makeProduct({
        productName: "FURU 36X048 CUIMP LEKT KL1",
        description: "FURU 36X048 CUIMP LEKT KL1",
      });

      expect(scoreStorefrontProduct(lekt, "36x48")).toBeGreaterThan(0);
      expect(scoreStorefrontProduct(lekt, "36x048")).toBeGreaterThan(0);
    });

    it("blander ikke sammen ulike dimensjoner", () => {
      const lekt = makeProduct({
        productName: "FURU 36X048 CUIMP LEKT KL1",
        description: "FURU 36X048 CUIMP LEKT KL1",
      });

      expect(scoreStorefrontProduct(lekt, "48x98")).toBe(0);
    });

    it("lar desimaler stå — 0 foran komma er ikke en ledende null", () => {
      const gips = makeProduct({
        productName: "GIPSPLATE STD 1200X2400X12,5",
        description: "GIPSPLATE STD 1200X2400X12,5",
      });

      expect(scoreStorefrontProduct(gips, "1200x2400x12,5")).toBeGreaterThan(0);
      expect(scoreStorefrontProduct(gips, "12,5")).toBeGreaterThan(0);
    });

    it("rører ikke rene tekstsøk", () => {
      const gips = makeProduct({
        productName: "GIPSPLATE STD 1200X2400X12,5",
        description: "GIPSPLATE STD 1200X2400X12,5",
        category: "Gips og plater",
      });

      expect(scoreStorefrontProduct(gips, "gipsplate")).toBeGreaterThan(0);
    });
  });
});

function makeProduct(overrides: Partial<StorefrontProduct>): StorefrontProduct {
  return {
    id: "product-1",
    slug: "product-1",
    nobbNumber: "12345678",
    productName: "Standard produkt",
    supplierName: "Byggmakker",
    brand: "Ukjent merke",
    unit: "PAK",
    priceUnit: "STK",
    salesUnit: "PAK",
    unitPriceNok: 100,
    listPriceNok: 120,
    sectionTitle: "Byggevarer",
    category: "Diverse",
    description: "Standard produkt",
    technicalDetails: [],
    quantitySuggestion: "1 pakke",
    quantityReason: "Testprodukt.",
    lastUpdated: "2026-05-06",
    source: "price_lists",
    ...overrides,
  };
}