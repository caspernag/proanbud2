import { describe, it, expect } from "vitest";

import { toVatInclusiveNok, recalculateOrderSummary, VAT_RATE, type MaterialOrderItemInput } from "@/lib/material-order";

// ─── toVatInclusiveNok ───────────────────────────────────────────────────────

describe("toVatInclusiveNok", () => {
  it("adds 25% VAT and returns value rounded to 2 decimals", () => {
    // 100 × 1.25 = 125.00
    expect(toVatInclusiveNok(100)).toBe(125);
  });

  it("returns 0 for zero input", () => {
    expect(toVatInclusiveNok(0)).toBe(0);
  });

  it("returns 0 for negative input", () => {
    expect(toVatInclusiveNok(-50)).toBe(0);
  });

  it("returns 0 for non-finite input", () => {
    expect(toVatInclusiveNok(Number.NaN)).toBe(0);
    expect(toVatInclusiveNok(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("accepts a custom VAT rate", () => {
    // 200 × 1.15 = 230
    expect(toVatInclusiveNok(200, 0.15)).toBe(230);
  });

  it("rounds to 2 decimal places", () => {
    // 1 × 1.25 = 1.25 → exactly representable
    expect(toVatInclusiveNok(1)).toBe(1.25);
  });
});

// ─── recalculateOrderSummary ─────────────────────────────────────────────────

function makeItem(overrides: Partial<MaterialOrderItemInput> = {}): MaterialOrderItemInput {
  return {
    sectionTitle: "Test",
    productName: "Testprodukt",
    quantityValue: 1,
    quantityUnit: "STK",
    unitPriceNok: 100,
    supplierKey: "byggmakker",
    isIncluded: true,
    ...overrides,
  };
}

describe("recalculateOrderSummary", () => {
  it("calculates subtotal as sum of included item line totals", () => {
    const items: MaterialOrderItemInput[] = [
      makeItem({ quantityValue: 2, unitPriceNok: 500 }), // 1000
      makeItem({ quantityValue: 3, unitPriceNok: 200 }), // 600
    ];
    const summary = recalculateOrderSummary(items, "delivery");
    expect(summary.subtotalNok).toBe(1600);
  });

  it("excludes items where isIncluded is false", () => {
    const items: MaterialOrderItemInput[] = [
      makeItem({ quantityValue: 1, unitPriceNok: 1000, isIncluded: true }),
      makeItem({ quantityValue: 1, unitPriceNok: 9999, isIncluded: false }),
    ];
    const summary = recalculateOrderSummary(items, "delivery");
    expect(summary.subtotalNok).toBe(1000);
  });

  it("delivery fee is 0 for pickup mode", () => {
    const items = [makeItem({ quantityValue: 10, unitPriceNok: 1000 })];
    const summary = recalculateOrderSummary(items, "pickup");
    expect(summary.deliveryFeeNok).toBe(0);
  });

  it("delivery fee is 0 when no items are included", () => {
    const items = [makeItem({ isIncluded: false })];
    const summary = recalculateOrderSummary(items, "delivery");
    expect(summary.deliveryFeeNok).toBe(0);
  });

  it("totalNok equals subtotal + delivery fee", () => {
    const items = [makeItem({ quantityValue: 10, unitPriceNok: 1000 })]; // subtotal = 10000
    const summary = recalculateOrderSummary(items, "delivery");
    expect(summary.totalNok).toBe(summary.subtotalNok + summary.deliveryFeeNok);
  });

  it("delivery fee is clamped between 390 and 2490", () => {
    // Very small order (just above min threshold) → fee should be >= 390
    const smallItems = [makeItem({ quantityValue: 1, unitPriceNok: 100 })];
    const smallSummary = recalculateOrderSummary(smallItems, "delivery");
    if (smallSummary.deliveryFeeNok > 0) {
      expect(smallSummary.deliveryFeeNok).toBeGreaterThanOrEqual(390);
    }

    // Very large order → fee should be <= 2490
    const largeItems = [makeItem({ quantityValue: 1000, unitPriceNok: 5000 })];
    const largeSummary = recalculateOrderSummary(largeItems, "delivery");
    expect(largeSummary.deliveryFeeNok).toBeLessThanOrEqual(2490);
  });

  it("express delivery adds an extra fee", () => {
    const items = [makeItem({ quantityValue: 10, unitPriceNok: 1000 })];
    const base = recalculateOrderSummary(items, "delivery");
    const express = recalculateOrderSummary(items, "delivery", { expressDelivery: true });
    expect(express.deliveryFeeNok).toBeGreaterThan(base.deliveryFeeNok);
  });

  it("carry-in service adds a fixed 690 NOK fee", () => {
    const items = [makeItem({ quantityValue: 10, unitPriceNok: 1000 })];
    const base = recalculateOrderSummary(items, "delivery");
    const carryIn = recalculateOrderSummary(items, "delivery", { carryInService: true });
    expect(carryIn.deliveryFeeNok - base.deliveryFeeNok).toBe(690);
  });

  it("vatNok is approximately 20% of totalNok", () => {
    const items = [makeItem({ quantityValue: 1, unitPriceNok: 10000 })];
    const summary = recalculateOrderSummary(items, "delivery");
    // The summary vatNok is Math.round(total * 0.2)
    expect(summary.vatNok).toBe(Math.round(summary.totalNok * 0.2));
  });
});
