import { describe, it, expect } from "vitest";

import { applyMarkup, applyMarkupForSupplierKey, type SupplierMarkup } from "@/lib/price-markup";
import { calculateStorefrontDisplayPrices } from "@/lib/storefront";

const SAMPLE_MARKUPS: SupplierMarkup[] = [
  { supplier_name: "Byggmakker", markup_percentage: 10, markup_fixed: 0 },
  { supplier_name: "Monter/Optimera", markup_percentage: 8, markup_fixed: 50 },
  { supplier_name: "Byggmax", markup_percentage: 0, markup_fixed: 0 },
  { supplier_name: "XL-Bygg", markup_percentage: 12, markup_fixed: 100 },
];

describe("applyMarkupForSupplierKey", () => {
  it("applies percentage markup to base price", () => {
    // 1000 NOK + 10 % = 1100
    const result = applyMarkupForSupplierKey(1000, "byggmakker", SAMPLE_MARKUPS);
    expect(result).toBe(1100);
  });

  it("applies fixed + percentage markup", () => {
    // 500 NOK + 8 % (40) + 50 fixed = 590
    const result = applyMarkupForSupplierKey(500, "monter_optimera", SAMPLE_MARKUPS);
    expect(result).toBe(590);
  });

  it("returns base price unchanged when markup is zero", () => {
    const result = applyMarkupForSupplierKey(750, "byggmax", SAMPLE_MARKUPS);
    expect(result).toBe(750);
  });

  it("caps to maxPrice when marked price would exceed it", () => {
    // 1000 + 10 % = 1100, but maxPrice = 1050
    const result = applyMarkupForSupplierKey(1000, "byggmakker", SAMPLE_MARKUPS, { maxPrice: 1050 });
    expect(result).toBe(1050);
  });

  it("does not cap when maxPrice is higher than marked price", () => {
    const result = applyMarkupForSupplierKey(1000, "byggmakker", SAMPLE_MARKUPS, { maxPrice: 1500 });
    expect(result).toBe(1100);
  });

  it("returns 0 for a zero-value base price", () => {
    expect(applyMarkupForSupplierKey(0, "byggmakker", SAMPLE_MARKUPS)).toBe(0);
  });

  it("returns base price when no matching supplier markup exists", () => {
    const result = applyMarkupForSupplierKey(1000, "byggmakker", []);
    expect(result).toBe(1000);
  });

  it("never produces a negative price from a negative fixed fee (floor at 0)", () => {
    const markupsWithNegativeFixed: SupplierMarkup[] = [
      { supplier_name: "Byggmakker", markup_percentage: 0, markup_fixed: -9999 },
    ];
    const result = applyMarkupForSupplierKey(100, "byggmakker", markupsWithNegativeFixed);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it("falls back to the net price rather than selling below cost when maxPrice is under it", () => {
    // Veiledende pris (900) er lavere enn innkjøpsprisen (1000): null margin, ikke tap.
    const result = applyMarkupForSupplierKey(1000, "byggmakker", SAMPLE_MARKUPS, { maxPrice: 900 });
    expect(result).toBe(1000);
  });

  it("lets a negative fixed fee cut below the net price even with a maxPrice", () => {
    const markupsWithNegativeFixed: SupplierMarkup[] = [
      { supplier_name: "Byggmakker", markup_percentage: 0, markup_fixed: -10 },
    ];
    const result = applyMarkupForSupplierKey(100, "byggmakker", markupsWithNegativeFixed, { maxPrice: 120 });
    expect(result).toBe(90);
  });

  it("applies the same cap rules when no supplier markup matches", () => {
    expect(applyMarkupForSupplierKey(1000, "byggmakker", [], { maxPrice: 1200 })).toBe(1000);
    expect(applyMarkupForSupplierKey(1000, "byggmakker", [], { maxPrice: 900 })).toBe(1000);
  });
});

describe("applyMarkup (by supplier name string)", () => {
  it("matches by supplier name including substring", () => {
    // Should match "Byggmakker" → 10 %
    const result = applyMarkup(200, "Byggmakker AS", SAMPLE_MARKUPS);
    expect(result).toBe(220);
  });

  it("falls back to base price when supplier name is unrecognized", () => {
    const result = applyMarkup(300, "Ukjent Leverandør", SAMPLE_MARKUPS);
    expect(result).toBe(300);
  });

  it("matches Optimera to monter_optimera key", () => {
    // 500 + 8 % (40) + 50 = 590
    const result = applyMarkup(500, "Optimera", SAMPLE_MARKUPS);
    expect(result).toBe(590);
  });
});

describe("calculateStorefrontDisplayPrices", () => {
  it("uses list price plus VAT as before price", () => {
    const prices = calculateStorefrontDisplayPrices(
      { unitPriceNok: 890, listPriceNok: 1190, supplierName: "Byggmakker" },
      SAMPLE_MARKUPS,
    );

    expect(prices.listPriceNok).toBe(1487.5);
  });

  it("uses discounted price plus markup and VAT as current price", () => {
    const prices = calculateStorefrontDisplayPrices(
      { unitPriceNok: 890, listPriceNok: 1190, supplierName: "Byggmakker" },
      SAMPLE_MARKUPS,
    );

    expect(prices.unitPriceNok).toBe(1223.75);
  });

  it("caps the current price at the before price when the markup exceeds the discount", () => {
    // 890 + 10 % = 979, men veiledende pris er 950: rabatten er mindre enn påslaget.
    const prices = calculateStorefrontDisplayPrices(
      { unitPriceNok: 890, listPriceNok: 950, supplierName: "Byggmakker" },
      SAMPLE_MARKUPS,
    );

    expect(prices.unitPriceNok).toBe(1187.5);
    expect(prices.listPriceNok).toBe(1187.5);
  });

  it("never prices above the before price, even with no discount at all", () => {
    const prices = calculateStorefrontDisplayPrices(
      { unitPriceNok: 1000, listPriceNok: 1000, supplierName: "XL-Bygg" },
      SAMPLE_MARKUPS,
    );

    expect(prices.unitPriceNok).toBe(1250);
    expect(prices.listPriceNok).toBe(1250);
  });

  it("falls back to cost price without a fake before price when list price is below cost", () => {
    const prices = calculateStorefrontDisplayPrices(
      { unitPriceNok: 1100, listPriceNok: 1000, supplierName: "XL-Bygg" },
      SAMPLE_MARKUPS,
    );

    expect(prices.unitPriceNok).toBe(1375);
    expect(prices.listPriceNok).toBe(1375);
  });
});
