import { describe, expect, it } from "vitest";

import { buildDaybookDraft } from "@/lib/accounting/daybook";
import {
  FIKEN_ACCOUNTS,
  FIKEN_VAT_CODES,
  buildDaybookJournalEntry,
  buildPayoutJournalEntry,
  postJournalEntry,
} from "@/lib/accounting/fiken";

describe("buildDaybookJournalEntry", () => {
  it("debiterer Stripe-kontoen og krediterer salg med mva-kode", () => {
    const draft = buildDaybookDraft("2026-08-14", [
      { id: "a", subtotalNok: 10000, shippingNok: 1250, totalNok: 11250 },
    ]);
    const entry = buildDaybookJournalEntry(draft);

    expect(entry.date).toBe("2026-08-14");
    expect(entry.lines).toHaveLength(2);

    const [goods, shipping] = entry.lines;

    expect(goods).toMatchObject({
      amount: 1_000_000,
      debitAccount: FIKEN_ACCOUNTS.stripeClearing,
      creditAccount: FIKEN_ACCOUNTS.goodsRevenue,
      creditVatCode: FIKEN_VAT_CODES.outgoingHigh,
    });
    expect(shipping).toMatchObject({
      amount: 125_000,
      creditAccount: FIKEN_ACCOUNTS.shippingRevenue,
      creditVatCode: FIKEN_VAT_CODES.outgoingHigh,
    });
  });

  it("poster BRUTTO, ikke netto — Fiken splitter mva selv", () => {
    // Poster man netto her, blir mva-en beregnet av Fiken på toppen av et
    // beløp som allerede er fratrukket mva, og mva-meldingen blir for lav.
    const draft = buildDaybookDraft("2026-08-14", [
      { id: "a", subtotalNok: 11400, shippingNok: 0, totalNok: 11400 },
    ]);
    const entry = buildDaybookJournalEntry(draft);

    expect(entry.lines[0].amount).toBe(1_140_000);
    expect(entry.lines[0].amount).not.toBe(draft.goodsNetOre);
  });

  it("dropper fraktlinjen når alt er hentet i butikk", () => {
    const draft = buildDaybookDraft("2026-08-14", [
      { id: "a", subtotalNok: 5000, shippingNok: 0, totalNok: 5000 },
    ]);
    const entry = buildDaybookJournalEntry(draft);

    expect(entry.lines).toHaveLength(1);
    expect(entry.lines[0].creditAccount).toBe(FIKEN_ACCOUNTS.goodsRevenue);
  });

  it("summerer flere ordre til ett bilag", () => {
    const draft = buildDaybookDraft("2026-08-14", [
      { id: "a", subtotalNok: 1000, shippingNok: 0, totalNok: 1000 },
      { id: "b", subtotalNok: 2000, shippingNok: 500, totalNok: 2500 },
    ]);
    const entry = buildDaybookJournalEntry(draft);

    expect(entry.lines[0].amount).toBe(300_000);
    expect(entry.lines[1].amount).toBe(50_000);
    expect(entry.description).toContain("2 ordre");
  });
});

describe("buildPayoutJournalEntry", () => {
  it("splitter utbetalingen i bank og gebyr mot Stripe-kontoen", () => {
    const entry = buildPayoutJournalEntry({
      stripePayoutId: "po_123",
      payoutDate: "2026-08-16",
      grossOre: 1_140_000,
      feeOre: 17_280,
      netOre: 1_122_720,
    });

    expect(entry.lines).toEqual([
      {
        amount: 1_122_720,
        debitAccount: FIKEN_ACCOUNTS.bank,
        creditAccount: FIKEN_ACCOUNTS.stripeClearing,
      },
      {
        amount: 17_280,
        debitAccount: FIKEN_ACCOUNTS.paymentFees,
        creditAccount: FIKEN_ACCOUNTS.stripeClearing,
      },
    ]);
  });

  it("gir gebyrlinjen ingen mva-kode", () => {
    // Stripe-gebyret er en finansiell tjeneste uten mva. Settes det mva-kode
    // her, trekkes det fra inngående mva vi ikke har rett på.
    const entry = buildPayoutJournalEntry({
      stripePayoutId: "po_123",
      payoutDate: "2026-08-16",
      grossOre: 100_000,
      feeOre: 1_500,
      netOre: 98_500,
    });

    expect(entry.lines[1].debitVatCode).toBeUndefined();
    expect(entry.lines[1].creditVatCode).toBeUndefined();
  });

  it("balanserer: bank + gebyr = det Stripe-kontoen krediteres", () => {
    const entry = buildPayoutJournalEntry({
      stripePayoutId: "po_123",
      payoutDate: "2026-08-16",
      grossOre: 1_140_000,
      feeOre: 17_280,
      netOre: 1_122_720,
    });

    const creditedToStripe = entry.lines
      .filter((line) => line.creditAccount === FIKEN_ACCOUNTS.stripeClearing)
      .reduce((sum, line) => sum + line.amount, 0);

    expect(creditedToStripe).toBe(1_140_000);
  });
});

describe("postJournalEntry", () => {
  it("kjører i tørrmodus uten Fiken-nøkkel, i stedet for å feile", () => {
    // Dette er tilstanden fram til selskapet er registrert: bilaget bygges og
    // valideres, men sendes ikke.
    const entry = buildDaybookJournalEntry(
      buildDaybookDraft("2026-08-14", [{ id: "a", subtotalNok: 1000, shippingNok: 0, totalNok: 1000 }]),
    );

    return expect(postJournalEntry(entry)).resolves.toMatchObject({ posted: false, dryRun: true });
  });

  it("nekter å poste et bilag uten linjer", () => {
    return expect(
      postJournalEntry({ description: "Tomt", date: "2026-08-14", lines: [] }),
    ).rejects.toThrow(/ingen linjer/);
  });
});
