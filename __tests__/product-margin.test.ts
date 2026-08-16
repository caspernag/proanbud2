import { describe, expect, it } from "vitest";

import { calculateProductMargin, marginTone, nokExact, pctNo } from "@/lib/product-margin";

describe("calculateProductMargin", () => {
  it("regner dekningsbidrag eks. mva av en mva-inklusiv utsalgspris", () => {
    // 125 inkl. mva = 100 eks. mva. Innkjøp 80 ⇒ DB 20 ⇒ 20 % dekningsgrad.
    const margin = calculateProductMargin({
      unitPriceNok: 125,
      costPriceExVatNok: 80,
      listPriceExVatNok: 100,
    });

    expect(margin.netPriceExVatNok).toBeCloseTo(100, 6);
    expect(margin.contributionNok).toBeCloseTo(20, 6);
    expect(margin.marginPct).toBeCloseTo(20, 6);
  });

  it("regner innkjøpsrabatten mot veiledende pris", () => {
    const margin = calculateProductMargin({
      unitPriceNok: 125,
      costPriceExVatNok: 70,
      listPriceExVatNok: 100,
    });

    expect(margin.discountPct).toBeCloseTo(30, 6);
  });

  it("viser negativ rabatt når vi betaler mer enn veiledende pris", () => {
    const margin = calculateProductMargin({
      unitPriceNok: 125,
      costPriceExVatNok: 110,
      listPriceExVatNok: 100,
    });

    expect(margin.discountPct).toBeCloseTo(-10, 6);
  });

  it("gir negativ margin når varen selges under innkjøpspris", () => {
    const margin = calculateProductMargin({
      unitPriceNok: 125,
      costPriceExVatNok: 120,
      listPriceExVatNok: 120,
    });

    expect(margin.contributionNok).toBeCloseTo(-20, 6);
    expect(margin.marginPct).toBeCloseTo(-20, 6);
    expect(marginTone(margin.marginPct)).toBe("loss");
  });

  it("lar marginen være ukjent når innkjøpsprisen mangler — ikke 100 %", () => {
    const margin = calculateProductMargin({
      unitPriceNok: 125,
      costPriceExVatNok: null,
      listPriceExVatNok: 100,
    });

    expect(margin.contributionNok).toBeNull();
    expect(margin.marginPct).toBeNull();
    expect(margin.discountPct).toBeNull();
    expect(marginTone(margin.marginPct)).toBe("unknown");
  });

  it("takler numeric-kolonner som kommer som streng fra PostgREST", () => {
    const margin = calculateProductMargin({
      unitPriceNok: 125,
      costPriceExVatNok: "80.00",
      listPriceExVatNok: "100.00",
    });

    expect(margin.marginPct).toBeCloseTo(20, 6);
    expect(margin.discountPct).toBeCloseTo(20, 6);
  });

  it("gir ukjent margin når produktet ikke har utsalgspris", () => {
    const margin = calculateProductMargin({
      unitPriceNok: 0,
      costPriceExVatNok: 80,
      listPriceExVatNok: 100,
    });

    expect(margin.marginPct).toBeNull();
    // Dekningsbidraget er fortsatt et reelt tap på 80 kr per enhet.
    expect(margin.contributionNok).toBeCloseTo(-80, 6);
  });

  it("markerer tynn margin som tåler verken frakt eller gebyr", () => {
    const margin = calculateProductMargin({
      unitPriceNok: 125,
      costPriceExVatNok: 97,
      listPriceExVatNok: 100,
    });

    expect(margin.marginPct).toBeCloseTo(3, 6);
    expect(marginTone(margin.marginPct)).toBe("thin");
  });
});

describe("formatering", () => {
  it("viser «—» for ukjente tall", () => {
    expect(pctNo(null)).toBe("—");
    expect(nokExact(null)).toBe("—");
  });

  it("beholder ørene i innkjøpsprisen", () => {
    expect(nokExact(80.55)).toContain("80,55");
  });
});
