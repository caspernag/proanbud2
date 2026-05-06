import { describe, expect, it } from "vitest";

import {
  constrainMaterialSectionsToCatalog,
  findConfidentPriceListProductMatch,
} from "@/lib/material-list-catalog";
import type { PriceListProduct } from "@/lib/price-lists";
import type { MaterialSection } from "@/lib/project-data";

function makeProduct(overrides: Partial<PriceListProduct> = {}): PriceListProduct {
  return {
    id: "test-100000",
    nobbNumber: "100000",
    productName: "Standardprodukt",
    supplierName: "Test Leverandør",
    brand: "Test",
    unit: "STK",
    priceUnit: "STK",
    salesUnit: "STK",
    priceNok: 100,
    listPriceNok: 100,
    sectionTitle: "Diverse",
    category: "Diverse",
    description: "",
    technicalDetails: [],
    quantitySuggestion: "1 stk",
    quantityReason: "Testmengde.",
    lastUpdated: "2026-05-06",
    ...overrides,
  };
}

function makeSection(items: MaterialSection["items"]): MaterialSection {
  return {
    title: "Tettsjikt",
    description: "Membran og våtromsdetaljer.",
    items,
  };
}

describe("material list catalog matching", () => {
  it("preserves material lines when catalog matching is uncertain", async () => {
    const sections = [
      makeSection([
        {
          item: "Gulv- og veggflis",
          quantity: "42 m²",
          note: "Overflater til bad.",
        },
      ]),
    ];
    const products = [
      makeProduct({
        nobbNumber: "222222",
        productName: "Slukmansjett universal",
        sectionTitle: "Tettsjikt",
        category: "Membran",
      }),
    ];

    const constrained = await constrainMaterialSectionsToCatalog(sections, products);

    expect(constrained?.[0]?.items).toHaveLength(1);
    expect(constrained?.[0]?.items[0]?.item).toBe("Gulv- og veggflis");
    expect(constrained?.[0]?.items[0]?.nobb).toBeUndefined();
  });

  it("uses direct NOBB matches even when the product name is generic", async () => {
    const sections = [
      makeSection([
        {
          item: "Membran valgt i avklaringer",
          quantity: "3 spann",
          note: "Bruk valgt løsning.",
          nobb: "333333",
        },
      ]),
    ];
    const products = [
      makeProduct({
        nobbNumber: "333333",
        productName: "Smøremembran våtrom 10 liter",
        sectionTitle: "Tettsjikt",
        category: "Membran",
      }),
    ];

    const constrained = await constrainMaterialSectionsToCatalog(sections, products);

    expect(constrained?.[0]?.items[0]?.item).toBe("Smøremembran våtrom 10 liter");
    expect(constrained?.[0]?.items[0]?.nobb).toBe("333333");
  });

  it("recognizes clear plural product matches without falling back to unrelated products", () => {
    const products = [
      makeProduct({
        nobbNumber: "444444",
        productName: "Våtromsplate 12 mm 60x240 cm",
        sectionTitle: "Underlag og oppbygging",
        category: "Bygningsplater",
      }),
      makeProduct({
        nobbNumber: "555555",
        productName: "Slukmansjett universal",
        sectionTitle: "Tettsjikt",
        category: "Membran",
      }),
    ];

    const match = findConfidentPriceListProductMatch(
      {
        item: "Våtromsplater",
        note: "Vegger i våtrom.",
      },
      {
        title: "Underlag og oppbygging",
        description: "Stabil base for våtrom.",
      },
      products,
    );

    expect(match?.nobbNumber).toBe("444444");
  });
});