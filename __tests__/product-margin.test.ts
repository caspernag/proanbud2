import { describe, expect, it } from "vitest";

import {
  calculateProductMargin,
  marginTone,
  nokExact,
  pctNo,
  priceInclVatFromMarginPct,
  priceInclVatFromMarkupPct,
} from "@/lib/product-margin";

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

describe("prisen regnet baklengs fra margin og påslag", () => {
  it("gir samme pris som påslaget systemet bruker i dag", () => {
    // 25 % påslag på 100 kr innkjøp = 125 eks. mva = 156,25 inkl. mva ⇒ 156 kr.
    expect(priceInclVatFromMarkupPct(100, 25)).toBe(156);
  });

  it("25 % påslag og 20 % dekningsgrad er samme pris — tallene må ikke forveksles", () => {
    expect(priceInclVatFromMarginPct(100, 20)).toBe(priceInclVatFromMarkupPct(100, 25));
  });

  it("er invers av marginberegningen", () => {
    const price = priceInclVatFromMarginPct(80, 30);
    const margin = calculateProductMargin({
      unitPriceNok: price as number,
      costPriceExVatNok: 80,
      listPriceExVatNok: null,
    });

    // Prisen rundes til hele kroner, så dekningsgraden lander nær 30 — ikke på.
    expect(margin.marginPct).toBeGreaterThan(29.5);
    expect(margin.marginPct).toBeLessThan(30.5);
  });

  it("nekter dekningsgrad på 100 % eller mer — den prisen finnes ikke", () => {
    expect(priceInclVatFromMarginPct(100, 100)).toBeNull();
    expect(priceInclVatFromMarginPct(100, 150)).toBeNull();
  });

  it("godtar negativ margin og negativt påslag (nedsatt vare)", () => {
    // Selges 20 % under innkjøpspris: 100 / 1,2 = 83,33 eks. mva ⇒ 104 inkl. mva.
    expect(priceInclVatFromMarginPct(100, -20)).toBe(104);
    expect(priceInclVatFromMarkupPct(100, -20)).toBe(100);
  });

  it("gir null når innkjøpsprisen mangler eller er null", () => {
    expect(priceInclVatFromMarginPct(0, 25)).toBeNull();
    expect(priceInclVatFromMarkupPct(Number.NaN, 25)).toBeNull();
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
