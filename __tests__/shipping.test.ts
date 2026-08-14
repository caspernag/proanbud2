import { describe, it, expect } from "vitest";

import {
  amountUntilFreeShipping,
  calculateShippingNok,
  freeShippingProgressPct,
  FREE_SHIPPING_LABEL,
  FREE_SHIPPING_THRESHOLD_NOK,
  STANDARD_SHIPPING_NOK,
} from "@/lib/shipping";

describe("fraktregler", () => {
  it("har avtalte satser", () => {
    expect(FREE_SHIPPING_THRESHOLD_NOK).toBe(30_000);
    expect(STANDARD_SHIPPING_NOK).toBe(1_000);
  });

  it("tar ikke frakt for tom handlekurv", () => {
    expect(calculateShippingNok(0)).toBe(0);
    expect(calculateShippingNok(-5)).toBe(0);
  });

  it("tar standardfrakt under terskelen", () => {
    expect(calculateShippingNok(1)).toBe(1_000);
    expect(calculateShippingNok(29_999)).toBe(1_000);
  });

  it("er fraktfritt fra og med terskelen", () => {
    expect(calculateShippingNok(30_000)).toBe(0);
    expect(calculateShippingNok(45_000)).toBe(0);
  });

  it("regner ut hvor mye som mangler til fraktfritt", () => {
    expect(amountUntilFreeShipping(0)).toBe(30_000);
    expect(amountUntilFreeShipping(11_400)).toBe(18_600);
    expect(amountUntilFreeShipping(30_000)).toBe(0);
    expect(amountUntilFreeShipping(40_000)).toBe(0);
  });

  it("holder framdriftsindikatoren mellom 0 og 100", () => {
    expect(freeShippingProgressPct(0)).toBe(0);
    expect(freeShippingProgressPct(15_000)).toBe(50);
    expect(freeShippingProgressPct(30_000)).toBe(100);
    expect(freeShippingProgressPct(90_000)).toBe(100);
  });

  it("formaterer terskelen på norsk", () => {
    // Ikke-brytende mellomrom fra nb-NO — sammenlign uten å anta tegnet.
    expect(FREE_SHIPPING_LABEL.replace(/\s/g, " ")).toBe("30 000 kr");
  });
});
