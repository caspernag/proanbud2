import { describe, expect, it } from "vitest";

import { FIKEN_ACCOUNTS, FIKEN_VAT_CODES, buildRefundJournalEntry } from "@/lib/accounting/fiken";
import { splitRefund } from "@/lib/accounting/refunds";

const order = { subtotalNok: 10000, shippingNok: 1250, totalNok: 11250 };

describe("splitRefund", () => {
  it("reverserer ordrens egne tall ved full refusjon", () => {
    const split = splitRefund(order, 1_125_000);

    expect(split).toEqual({
      goodsGrossOre: 1_000_000,
      shippingGrossOre: 125_000,
      isFullRefund: true,
      needsReview: false,
    });
  });

  it("fører delvis refusjon som varereduksjon, og ber om kontroll", () => {
    // Stripe sier bare hvor mange kroner som gikk tilbake, ikke hva de gjaldt.
    // Antakelsen (retur av vare) er den vanlige, men den er en antakelse.
    const split = splitRefund(order, 200_000);

    expect(split.goodsGrossOre).toBe(200_000);
    expect(split.shippingGrossOre).toBe(0);
    expect(split.needsReview).toBe(true);
  });

  it("legger overskytende på frakt når delrefusjonen er større enn varesummen", () => {
    const split = splitRefund(order, 1_050_000);

    expect(split.goodsGrossOre).toBe(1_000_000);
    expect(split.shippingGrossOre).toBe(50_000);
  });

  it("behandler en refusjon over totalen som full refusjon", () => {
    const split = splitRefund(order, 9_999_999);

    expect(split.isFullRefund).toBe(true);
    expect(split.goodsGrossOre + split.shippingGrossOre).toBe(1_125_000);
  });
});

describe("buildRefundJournalEntry", () => {
  it("går motsatt vei av salgsbilaget, med mva-kode på inntektslinjen", () => {
    const entry = buildRefundJournalEntry({
      stripeRefundId: "re_1",
      refundDate: "2026-08-20",
      orderReference: "#1042",
      goodsGrossOre: 1_000_000,
      shippingGrossOre: 125_000,
    });

    expect(entry.date).toBe("2026-08-20");
    expect(entry.lines[0]).toEqual({
      amount: 1_000_000,
      debitAccount: FIKEN_ACCOUNTS.goodsRevenue,
      debitVatCode: FIKEN_VAT_CODES.outgoingHigh,
      creditAccount: FIKEN_ACCOUNTS.stripeClearing,
    });
  });

  it("beholder mva-koden — uten den reverseres omsetningen, men ikke mva-en", () => {
    const entry = buildRefundJournalEntry({
      stripeRefundId: "re_1",
      refundDate: "2026-08-20",
      orderReference: "#1042",
      goodsGrossOre: 500_000,
      shippingGrossOre: 0,
    });

    expect(entry.lines).toHaveLength(1);
    expect(entry.lines[0].debitVatCode).toBe(FIKEN_VAT_CODES.outgoingHigh);
  });
});
