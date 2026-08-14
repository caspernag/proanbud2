import { VAT_RATE } from "@/lib/material-order";

/**
 * Dagsoppgjør: summen av ett døgns salg, klar til å bokføres som ett bilag.
 *
 * Denne filen inneholder BARE ren regning — ingen database, ingen Fiken. Det er
 * med vilje: bokføringstall må kunne testes uten å røre noe eksternt, og
 * avrundings- og tidssonelogikken under er nettopp det som går galt i stillhet.
 */

/** Bokføringsdøgnet følger norsk tid, ikke UTC. Se osloDayRange. */
export const ACCOUNTING_TIME_ZONE = "Europe/Oslo";

/* ── Tidssone ───────────────────────────────────────────────────────────── */

/**
 * Hvor mange millisekunder tidssonen ligger foran UTC på et gitt tidspunkt.
 * Leses ut av Intl framfor å hardkodes, fordi Norge bytter mellom +01 og +02.
 */
function zoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  const asIfUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour % 24,
    values.minute,
    values.second,
  );

  return asIfUtc - at.getTime();
}

/**
 * UTC-tidspunktet for midnatt norsk tid på en gitt dato.
 *
 * To runder: offset avhenger av tidspunktet, og tidspunktet avhenger av offset.
 * Første gjetning bruker UTC-midnatt for å slå opp offset, andre runde retter
 * seg selv. Det tar høyde for sommertidsskiftene, der en dag er 23 eller 25
 * timer lang.
 */
function zonedMidnightUtcMs(isoDate: string, timeZone: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  const wallClock = Date.UTC(year, month - 1, day, 0, 0, 0);

  let utcMs = wallClock;
  for (let i = 0; i < 2; i += 1) {
    utcMs = wallClock - zoneOffsetMs(timeZone, new Date(utcMs));
  }

  return utcMs;
}

/**
 * Døgnet `isoDate` som et halvåpent UTC-intervall [from, to).
 *
 * Hele poenget: en ordre betalt 14. august kl. 23:30 norsk tid er 14. august
 * kl. 21:30 UTC — men en ordre betalt kl. 00:30 natt til 15. er 14. august
 * 22:30 UTC. Filtrerer man på UTC-døgn, havner kveldssalg på feil bokføringsdag,
 * og bilagene stemmer ikke mot noe som helst.
 */
export function osloDayRange(isoDate: string): { fromIso: string; toIso: string } {
  const from = zonedMidnightUtcMs(isoDate, ACCOUNTING_TIME_ZONE);
  const [year, month, day] = isoDate.split("-").map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const nextIsoDate = nextDay.toISOString().slice(0, 10);
  const to = zonedMidnightUtcMs(nextIsoDate, ACCOUNTING_TIME_ZONE);

  return { fromIso: new Date(from).toISOString(), toIso: new Date(to).toISOString() };
}

/** Datoen et tidspunkt tilhører i norsk tid, som `YYYY-MM-DD`. */
export function osloDateOf(instant: Date | string): string {
  const at = typeof instant === "string" ? new Date(instant) : instant;

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ACCOUNTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/* ── Beregning ──────────────────────────────────────────────────────────── */

export type DaybookOrderInput = {
  id: string;
  /** Varesum inkl. mva, i hele kroner. */
  subtotalNok: number;
  /** Frakt fakturert kunden inkl. mva, i hele kroner. */
  shippingNok: number;
  /** Totalbeløp belastet kunden inkl. mva, i hele kroner. */
  totalNok: number;
};

export type DaybookDraft = {
  bookingDate: string;
  orderCount: number;
  orderIds: string[];
  /** Totalbeløp inkl. mva. Debiteres Stripe-mellomkontoen. */
  grossOre: number;
  /** Varesalg inkl. mva. Krediteres salgskontoen med mva-kode. */
  goodsGrossOre: number;
  /** Frakt inkl. mva. Krediteres fraktinntektskontoen med mva-kode. */
  shippingGrossOre: number;
  /** Netto og mva regnes ut her for kontroll og visning — Fiken splitter selv. */
  goodsNetOre: number;
  shippingNetOre: number;
  outgoingVatOre: number;
};

function toOre(nok: number): number {
  return Math.round(nok * 100);
}

/**
 * Netto (eks. mva) av et mva-inklusivt ørebeløp, avrundet til hele øre.
 */
function netOfVatOre(grossOre: number): number {
  return Math.round(grossOre / (1 + VAT_RATE));
}

/**
 * Bygger dagsoppgjøret av ordrene som hører til døgnet.
 *
 * AVRUNDING: mva regnes per ordre og summeres etterpå — ikke av dagssummen.
 * Kunden har allerede fått en kvittering med et mva-beløp på seg, og bilaget må
 * stemme mot summen av de kvitteringene. Regner man mva av dagens totalsum, kan
 * bilaget avvike med noen øre fra kvitteringene, og da er det kvitteringene som
 * er feil i ettertid — ikke noe du kan rette.
 *
 * Mva utledes som rest (brutto − varenetto − fraktnetto) slik at bilaget alltid
 * balanserer eksakt, uansett hvordan avrundingen faller på de to nettolinjene.
 */
export function buildDaybookDraft(bookingDate: string, orders: DaybookOrderInput[]): DaybookDraft {
  let grossOre = 0;
  let goodsGrossOre = 0;
  let shippingGrossOre = 0;
  let goodsNetOre = 0;
  let shippingNetOre = 0;
  let outgoingVatOre = 0;

  for (const order of orders) {
    const orderGoodsGrossOre = toOre(order.subtotalNok);
    const orderShippingGrossOre = toOre(order.shippingNok);
    const orderGrossOre = toOre(order.totalNok);
    const orderGoodsNetOre = netOfVatOre(orderGoodsGrossOre);
    const orderShippingNetOre = netOfVatOre(orderShippingGrossOre);
    const orderVatOre = orderGrossOre - orderGoodsNetOre - orderShippingNetOre;

    grossOre += orderGrossOre;
    goodsGrossOre += orderGoodsGrossOre;
    shippingGrossOre += orderShippingGrossOre;
    goodsNetOre += orderGoodsNetOre;
    shippingNetOre += orderShippingNetOre;
    outgoingVatOre += orderVatOre;
  }

  const draft: DaybookDraft = {
    bookingDate,
    orderCount: orders.length,
    orderIds: orders.map((order) => order.id),
    grossOre,
    goodsGrossOre,
    shippingGrossOre,
    goodsNetOre,
    shippingNetOre,
    outgoingVatOre,
  };

  assertBalanced(draft);

  return draft;
}

/**
 * Et ubalansert bilag skal aldri nå Fiken. Kommer det inn der, må det
 * tilbakeføres manuelt — det er langt dyrere enn å feile her.
 */
export function assertBalanced(draft: DaybookDraft): void {
  const sum = draft.goodsNetOre + draft.shippingNetOre + draft.outgoingVatOre;

  if (sum !== draft.grossOre) {
    throw new Error(
      `Dagsoppgjør ${draft.bookingDate} balanserer ikke: ` +
        `netto ${draft.goodsNetOre} + frakt ${draft.shippingNetOre} + mva ${draft.outgoingVatOre} = ${sum}, ` +
        `men brutto er ${draft.grossOre}.`,
    );
  }

  // Fanger opp at totalen ikke lenger er varer + frakt — f.eks. hvis det
  // innføres rabatt eller gavekort uten at bokføringen får en egen linje for det.
  const grossParts = draft.goodsGrossOre + draft.shippingGrossOre;

  if (grossParts !== draft.grossOre) {
    throw new Error(
      `Dagsoppgjør ${draft.bookingDate}: varer ${draft.goodsGrossOre} + frakt ${draft.shippingGrossOre} ` +
        `= ${grossParts}, men totalen er ${draft.grossOre}. Mangler bokføringen en linje?`,
    );
  }
}

/** Gårsdagen i norsk tid — døgnet cron-jobben normalt skal bokføre. */
export function previousOsloDate(now: Date = new Date()): string {
  const today = osloDateOf(now);
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}
