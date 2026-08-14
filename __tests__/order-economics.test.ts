import { describe, it, expect } from "vitest";

import {
  calculateOrderEconomics,
  netOfVat,
  paymentFeeNok,
  STRIPE_FIXED_FEE_NOK,
  STRIPE_PERCENT_FEE,
  sumEconomics,
  vatWithin,
  VAT_SHARE_OF_GROSS,
} from "@/lib/order-economics";

describe("mva-håndtering", () => {
  it("trekker 25 % mva ut av et mva-inklusivt beløp", () => {
    expect(netOfVat(11_400)).toBeCloseTo(9_120, 6);
    expect(vatWithin(11_400)).toBeCloseTo(2_280, 6);
  });

  it("mva utgjør 20 % av bruttobeløpet når satsen er 25 %", () => {
    expect(VAT_SHARE_OF_GROSS).toBeCloseTo(0.2, 10);
    expect(vatWithin(11_400) / 11_400).toBeCloseTo(0.2, 10);
  });

  it("håndterer null uten å dele på noe rart", () => {
    expect(netOfVat(0)).toBe(0);
    expect(vatWithin(0)).toBe(0);
  });
});

describe("betalingsgebyr", () => {
  it("regnes av bruttobeløpet kunden faktisk belastes", () => {
    expect(paymentFeeNok(11_400)).toBeCloseTo(11_400 * STRIPE_PERCENT_FEE + STRIPE_FIXED_FEE_NOK, 6);
  });

  it("er null for ubetalte ordre", () => {
    expect(paymentFeeNok(0)).toBe(0);
  });
});

describe("dekningsbidrag på en ekte ordre", () => {
  // Ordre ordre-20260813-38fbea9a: 300 LM GRAN 30X148, 38 kr/LM inkl. mva.
  // Innkjøpspris fra Byggmakker-prislisten: 25,30 kr/LM eks. mva.
  // Byggmakker-påslaget var 20 % da kunden handlet (satt opp til 30 % dagen
  // etter), og regnestykket stemmer: 25,30 × 1,20 = 30,36 eks. mva,
  // × 1,25 mva = 37,95 ≈ 38 kr/LM. Dekningsgraden under gjenspeiler derfor
  // 20 % påslag; med 30 % blir den ca. 23 % før gebyr.
  const UNIT_COST_EX_VAT = 25.3;

  const economics = calculateOrderEconomics(
    {
      subtotalNok: 11_400,
      shippingNok: 0,
      totalNok: 11_400,
      freightCostExVatNok: 0,
      otherCostExVatNok: null,
    },
    [
      {
        id: "line-1",
        nobbNumber: "25414046",
        productName: "GRAN 30X148 FORSKALING",
        quantity: 300,
        unit: "LM",
        lineTotalNok: 11_400,
        unitCostExVatNok: UNIT_COST_EX_VAT,
      },
    ],
  );

  it("bruker netto salgsinntekt, ikke beløpet inkl. mva", () => {
    expect(economics.grossRevenueNok).toBe(11_400);
    expect(economics.netRevenueNok).toBeCloseTo(9_120, 6);
    expect(economics.outgoingVatNok).toBeCloseTo(2_280, 6);
  });

  it("regner varekost eks. mva", () => {
    // 300 LM × 25,30 = 7 590
    expect(economics.goodsCostNok).toBeCloseTo(7_590, 6);
  });

  it("gir det reelle dekningsbidraget på ordren", () => {
    // 9 120 netto − 7 590 vare − 172,80 gebyr = 1 357,20
    expect(economics.contributionNok).toBeCloseTo(1_357.2, 1);
    expect(economics.contributionPct as number).toBeCloseTo(14.88, 1);
  });

  it("trekker fra betalingsgebyret", () => {
    const withoutFee = economics.netRevenueNok - economics.goodsCostNok;
    expect(economics.contributionNok).toBeCloseTo(withoutFee - economics.paymentFeeNok, 6);
  });

  it("er komplett når alle linjer har kostnad og frakt er registrert", () => {
    expect(economics.complete).toBe(true);
    expect(economics.linesWithKnownCost).toBe(1);
  });
});

describe("den gamle feilen", () => {
  it("inntekt inkl. mva mot kostnad eks. mva overvurderer dekningsbidraget", () => {
    const unitCost = 25.3;
    const feilaktig = 11_400 - unitCost * 300;
    const riktig = calculateOrderEconomics(
      { subtotalNok: 11_400, shippingNok: 0, totalNok: 11_400, freightCostExVatNok: 0, otherCostExVatNok: null },
      [
        {
          id: "l",
          nobbNumber: "25414046",
          productName: "GRAN",
          quantity: 300,
          unit: "LM",
          lineTotalNok: 11_400,
          unitCostExVatNok: unitCost,
        },
      ],
    ).contributionNok;

    // Differansen er i praksis hele mva-beløpet på 2 280 kr.
    expect(feilaktig - riktig).toBeGreaterThan(2_200);
  });
});

describe("ufullstendige kostnadsdata", () => {
  const economics = calculateOrderEconomics(
    { subtotalNok: 10_000, shippingNok: 1_000, totalNok: 11_000, freightCostExVatNok: null, otherCostExVatNok: null },
    [
      {
        id: "a",
        nobbNumber: "1",
        productName: "Kjent",
        quantity: 10,
        unit: "STK",
        lineTotalNok: 5_000,
        unitCostExVatNok: 300,
      },
      {
        id: "b",
        nobbNumber: "2",
        productName: "Ukjent",
        quantity: 5,
        unit: "STK",
        lineTotalNok: 5_000,
        unitCostExVatNok: null,
      },
    ],
  );

  it("markerer seg som ufullstendig", () => {
    expect(economics.complete).toBe(false);
    expect(economics.linesWithKnownCost).toBe(1);
    expect(economics.totalLines).toBe(2);
    expect(economics.freightCostRegistered).toBe(false);
  });

  it("teller bare kjente varekostnader", () => {
    expect(economics.goodsCostNok).toBe(3_000);
  });

  it("skiller fraktinntekt fra varesalg", () => {
    expect(economics.goodsNetRevenueNok).toBeCloseTo(8_000, 6);
    expect(economics.shippingNetRevenueNok).toBeCloseTo(800, 6);
  });
});

describe("summering på tvers av ordre", () => {
  it("legger sammen og regner samlet dekningsgrad", () => {
    const base = {
      subtotalNok: 10_000,
      shippingNok: 0,
      totalNok: 10_000,
      freightCostExVatNok: 0,
      otherCostExVatNok: null,
    };
    const line = {
      id: "l",
      nobbNumber: "1",
      productName: "Vare",
      quantity: 1,
      unit: "STK",
      lineTotalNok: 10_000,
      unitCostExVatNok: 6_000,
    };

    const total = sumEconomics([
      calculateOrderEconomics(base, [line]),
      calculateOrderEconomics(base, [line]),
    ]);

    expect(total.orderCount).toBe(2);
    expect(total.netRevenueNok).toBeCloseTo(16_000, 6);
    expect(total.goodsCostNok).toBe(12_000);
    expect(total.completeCount).toBe(2);
    expect(total.contributionPct as number).toBeLessThan(25);
  });
});
