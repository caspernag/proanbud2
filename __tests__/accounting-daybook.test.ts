import { describe, expect, it } from "vitest";

import {
  buildDaybookDraft,
  osloDateOf,
  osloDayRange,
  previousOsloDate,
  type DaybookOrderInput,
} from "@/lib/accounting/daybook";

function order(id: string, subtotalNok: number, shippingNok: number): DaybookOrderInput {
  return { id, subtotalNok, shippingNok, totalNok: subtotalNok + shippingNok };
}

describe("osloDayRange", () => {
  it("dekker døgnet i norsk tid, ikke UTC", () => {
    // Sommertid: Norge er UTC+2, så norsk midnatt er 22:00 UTC dagen før.
    const range = osloDayRange("2026-08-14");

    expect(range.fromIso).toBe("2026-08-13T22:00:00.000Z");
    expect(range.toIso).toBe("2026-08-14T22:00:00.000Z");
  });

  it("bruker vintertid-offset i januar", () => {
    // Vintertid: UTC+1, altså 23:00 UTC dagen før.
    const range = osloDayRange("2026-01-15");

    expect(range.fromIso).toBe("2026-01-14T23:00:00.000Z");
    expect(range.toIso).toBe("2026-01-15T23:00:00.000Z");
  });

  it("håndterer overgangen til sommertid, der døgnet er 23 timer", () => {
    // Klokka stilles fram natt til siste søndag i mars 2026 (29. mars).
    const range = osloDayRange("2026-03-29");
    const hours = (Date.parse(range.toIso) - Date.parse(range.fromIso)) / 3_600_000;

    expect(hours).toBe(23);
  });

  it("håndterer overgangen til vintertid, der døgnet er 25 timer", () => {
    // Klokka stilles tilbake natt til siste søndag i oktober 2026 (25. oktober).
    const range = osloDayRange("2026-10-25");
    const hours = (Date.parse(range.toIso) - Date.parse(range.fromIso)) / 3_600_000;

    expect(hours).toBe(25);
  });

  it("plasserer et kveldssalg på salgsdagen, ikke dagen etter", () => {
    // 14. august kl. 23:30 norsk tid = 21:30 UTC samme dag.
    const paidAt = "2026-08-14T21:30:00.000Z";
    const range = osloDayRange("2026-08-14");

    expect(paidAt >= range.fromIso && paidAt < range.toIso).toBe(true);
    expect(osloDateOf(paidAt)).toBe("2026-08-14");
  });

  it("plasserer et salg like etter midnatt på den nye dagen", () => {
    // 15. august kl. 00:30 norsk tid = 22:30 UTC 14. august. Et UTC-basert
    // filter ville bokført dette på 14., altså feil dag.
    const paidAt = "2026-08-14T22:30:00.000Z";

    expect(osloDateOf(paidAt)).toBe("2026-08-15");
    expect(paidAt < osloDayRange("2026-08-14").toIso).toBe(false);
  });
});

describe("buildDaybookDraft", () => {
  it("splitter en ordre i netto og mva", () => {
    const draft = buildDaybookDraft("2026-08-14", [order("a", 11400, 0)]);

    expect(draft.grossOre).toBe(1_140_000);
    expect(draft.goodsNetOre).toBe(912_000);
    expect(draft.outgoingVatOre).toBe(228_000);
  });

  it("holder frakt adskilt fra varesalg", () => {
    const draft = buildDaybookDraft("2026-08-14", [order("a", 10000, 1250)]);

    expect(draft.goodsNetOre).toBe(800_000);
    expect(draft.shippingNetOre).toBe(100_000);
    expect(draft.outgoingVatOre).toBe(225_000);
  });

  it("balanserer eksakt på skjeve beløp", () => {
    // Beløp som ikke går opp i mva-delingen. Bilaget må likevel balansere til
    // øret, ellers avviser Fiken det — eller verre, tar det imot skjevt.
    const orders = [order("a", 999, 149), order("b", 1, 0), order("c", 33333, 77)];
    const draft = buildDaybookDraft("2026-08-14", orders);

    expect(draft.goodsNetOre + draft.shippingNetOre + draft.outgoingVatOre).toBe(draft.grossOre);
  });

  it("summerer mva per ordre, ikke av dagssummen", () => {
    // Tre ordre à 3 kr: hver runder til 60 øre mva (2,40 netto). Summert per
    // ordre gir det 180 øre. Regnet av dagssummen (900 øre) ville det gitt 180
    // øre her også — men på beløp som runder ulikt spriker de to metodene, og
    // kvitteringene kunden har fått er summert per ordre.
    const draft = buildDaybookDraft("2026-08-14", [order("a", 3, 0), order("b", 3, 0), order("c", 3, 0)]);

    expect(draft.grossOre).toBe(900);
    expect(draft.outgoingVatOre).toBe(3 * (300 - Math.round(300 / 1.25)));
  });

  it("gir et tomt, balansert bilag når ingen solgte noe", () => {
    const draft = buildDaybookDraft("2026-08-14", []);

    expect(draft.orderCount).toBe(0);
    expect(draft.grossOre).toBe(0);
    expect(draft.orderIds).toEqual([]);
  });

  it("tar vare på hvilke ordre summen består av", () => {
    const draft = buildDaybookDraft("2026-08-14", [order("a", 100, 0), order("b", 200, 0)]);

    expect(draft.orderIds).toEqual(["a", "b"]);
    expect(draft.orderCount).toBe(2);
  });
});

describe("previousOsloDate", () => {
  it("gir gårsdagen i norsk tid", () => {
    expect(previousOsloDate(new Date("2026-08-14T10:00:00.000Z"))).toBe("2026-08-13");
  });

  it("regner døgnskillet i norsk tid, ikke UTC", () => {
    // 22:30 UTC 14. august er allerede 15. august i Norge, så gårsdagen er 14.
    expect(previousOsloDate(new Date("2026-08-14T22:30:00.000Z"))).toBe("2026-08-14");
  });

  it("krysser månedsskiftet", () => {
    expect(previousOsloDate(new Date("2026-09-01T10:00:00.000Z"))).toBe("2026-08-31");
  });
});
