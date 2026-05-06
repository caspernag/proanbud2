import { describe, expect, it } from "vitest";

import {
  describeSalesUnitQuantity,
  orderLineUnit,
  parseSalesUnitQuantity,
  priceForSalesUnit,
} from "@/lib/product-unit-pricing";

describe("product unit pricing", () => {
  it("uses the precise m2 package area from the product text", () => {
    const quantity = parseSalesUnitQuantity("6STK  4,1 M2/PK", "M2", "PAK", "4");

    expect(quantity).toBe(4.1);
    expect(priceForSalesUnit(238.5, { priceUnit: "M2", salesUnit: "PAK", salesUnitQuantity: quantity })).toBeCloseTo(
      977.85,
    );
  });

  it("falls back to the supplier quantity column when description has no package area", () => {
    const quantity = parseSalesUnitQuantity("JACKOPOR S80", "M2", "PAK", "21");

    expect(quantity).toBe(21);
    expect(priceForSalesUnit(33, { priceUnit: "M2", salesUnit: "PAK", salesUnitQuantity: quantity })).toBe(693);
  });

  it("converts piece prices to package prices", () => {
    const quantity = parseSalesUnitQuantity("100 STK/PK TYPE B", "STK", "PAK", "100");

    expect(quantity).toBe(100);
    expect(priceForSalesUnit(23.48, { priceUnit: "STK", salesUnit: "PAK", salesUnitQuantity: quantity })).toBe(2348);
    expect(describeSalesUnitQuantity({ priceUnit: "STK", salesUnit: "PAK", salesUnitQuantity: quantity })).toBe(
      "Innhold: 100 STK per PAK",
    );
  });

  it("converts square-meter prices to piece prices", () => {
    const quantity = parseSalesUnitQuantity("1 STK = 2 M2", "M2", "STK", "2");

    expect(quantity).toBe(2);
    expect(priceForSalesUnit(80.16, { priceUnit: "M2", salesUnit: "STK", salesUnitQuantity: quantity })).toBeCloseTo(
      160.32,
    );
    expect(orderLineUnit({ priceUnit: "M2", salesUnit: "STK", fallbackUnit: "STK" })).toBe("STK");
  });

  it("keeps prices unchanged when price and sales units are the same", () => {
    expect(priceForSalesUnit(987.9, { priceUnit: "PAK", salesUnit: "PAK", salesUnitQuantity: 10 })).toBe(987.9);
  });

  it("stores order lines in the sales unit, not the price unit", () => {
    expect(orderLineUnit({ priceUnit: "M2", salesUnit: "STK", fallbackUnit: "STK" })).toBe("STK");
    expect(orderLineUnit({ priceUnit: "M2", salesUnit: "PAK", fallbackUnit: "M2" })).toBe("PAK");
    expect(orderLineUnit({ priceUnit: "M2", fallbackUnit: "M2" })).toBe("M2");
  });
});