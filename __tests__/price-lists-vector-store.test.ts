import { describe, expect, it } from "vitest";

import { parsePriceListProductsFromVectorFile } from "@/lib/price-lists";

describe("OpenAI vector-store price files", () => {
  it("parses supplier CSV price rows into sales-unit prices", () => {
    const csv = [
      "0506;7020200000000;600001;;TERRASSEBORD 28X120 IMP;11900;8900;M2;;4,1 M2/PK;PAK;4,1;;;",
    ].join("\n");

    const products = parsePriceListProductsFromVectorFile(csv, "byggmakker.csv", "2026-05-06");

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      nobbNumber: "600001",
      productName: "TERRASSEBORD 28X120 IMP",
      supplierName: "Byggmakker",
      priceUnit: "M2",
      salesUnit: "PAK",
      salesUnitQuantity: 4.1,
      priceNok: 364.9,
      listPriceNok: 487.9,
      sectionTitle: "Dekke",
      category: "Terrasse",
      lastUpdated: "2026-05-06",
    });
  });

  it("parses JSON product files with explicit prices", () => {
    const json = JSON.stringify({
      products: [
        {
          nobbNumber: "700002",
          productName: "TERRASSESKRUE A2 4,2X55",
          supplierName: "Byggmakker",
          priceNok: 249,
          listPriceNok: 319,
          priceUnit: "PAK",
          salesUnit: "PAK",
          category: "Festemidler",
          sectionTitle: "Jernvarer og feste",
        },
      ],
    });

    const products = parsePriceListProductsFromVectorFile(json, "produkter.json", "2026-05-06");

    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      nobbNumber: "700002",
      productName: "TERRASSESKRUE A2 4,2X55",
      priceNok: 249,
      listPriceNok: 319,
      priceUnit: "PAK",
      salesUnit: "PAK",
    });
  });
});
