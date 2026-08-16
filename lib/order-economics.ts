import { netOfVat, vatWithin } from "@/lib/vat";

/**
 * Dekningsbidrag per butikkordre.
 *
 * MVA-REGELEN SOM STYRER ALT HER: kundeprisene i butikken er lagret og belastet
 * INKLUSIVE 25 % mva (`storefront_products.unit_price_nok` er allerede påslag +
 * mva, se lib/storefront-catalog-refresh). Prisene fra Byggmakker-prislisten er
 * EKSKLUSIVE mva. Utgående mva er penger vi skylder staten, og inngående mva på
 * varekjøp får vi fradrag for — derfor er begge deler gjennomstrømning, og
 * dekningsbidraget MÅ regnes eks. mva på begge sider.
 *
 * Panelet sammenlignet tidligere omsetning inkl. mva mot varekost eks. mva.
 * Det overvurderer dekningsbidraget med hele mva-beløpet: en ordre på 11 400 kr
 * ble målt som 11 400 i inntekt, mens den reelle inntekten er 9 120.
 */

// Selve mva-regnestykket bor i lib/vat.ts, som er importfri og dermed trygg å
// bruke fra klientkomponenter. Re-eksporteres her fordi panelene henter den herfra.
export { VAT_SHARE_OF_GROSS, netOfVat, vatWithin } from "@/lib/vat";

/**
 * Stripe-gebyr. Belastes av bruttobeløpet kunden betaler (altså inkl. mva), og
 * er unntatt mva som finansiell tjeneste — vi får ikke fradrag, så hele
 * gebyret er en reell kostnad.
 *
 * Satsene er Stripes standard for norske konti med EØS-kort. Endres de, eller
 * hvis du forhandler egne satser, er dette eneste stedet å rette.
 */
export const STRIPE_PERCENT_FEE = 0.015;
export const STRIPE_FIXED_FEE_NOK = 1.8;

export function paymentFeeNok(grossChargedNok: number): number {
  if (!Number.isFinite(grossChargedNok) || grossChargedNok <= 0) return 0;
  return grossChargedNok * STRIPE_PERCENT_FEE + STRIPE_FIXED_FEE_NOK;
}

/* ── Inndata ────────────────────────────────────────────────────────────── */

export type EconomicsLineInput = {
  id: string;
  nobbNumber: string;
  productName: string;
  quantity: number;
  unit: string;
  /** Linjesum slik kunden betalte den — INKL. mva. */
  lineTotalNok: number;
  /** Innkjøpspris per enhet fra prislisten — EKS. mva. null = ukjent. */
  unitCostExVatNok: number | null;
};

export type EconomicsOrderInput = {
  /** Varesum inkl. mva. */
  subtotalNok: number;
  /** Frakt fakturert kunden, inkl. mva. */
  shippingNok: number;
  /** Totalbeløp belastet kunden, inkl. mva. */
  totalNok: number;
  /**
   * Faktisk varekost eks. mva for hele ordren. Overstyrer summen fra
   * prislisten når den er satt — prislisten kan være utdatert, og
   * leverandørfakturaen er fasit.
   */
  goodsCostOverrideExVatNok?: number | null;
  /** Faktisk fraktkostnad eks. mva. null = ikke registrert. */
  freightCostExVatNok: number | null;
  /** Andre direkte kostnader eks. mva. */
  otherCostExVatNok: number | null;
};

/* ── Resultat ───────────────────────────────────────────────────────────── */

export type EconomicsLine = {
  id: string;
  nobbNumber: string;
  productName: string;
  quantity: number;
  unit: string;
  grossRevenueNok: number;
  netRevenueNok: number;
  unitCostExVatNok: number | null;
  costNok: number;
  contributionNok: number;
  /** Dekningsgrad i prosent av netto salgsinntekt. null når kostnaden er ukjent. */
  marginPct: number | null;
  costKnown: boolean;
};

export type OrderEconomics = {
  /* Inntekt */
  grossRevenueNok: number;
  netRevenueNok: number;
  outgoingVatNok: number;
  goodsNetRevenueNok: number;
  shippingNetRevenueNok: number;

  /* Kostnader, alle eks. mva bortsett fra gebyret */
  goodsCostNok: number;
  freightCostNok: number;
  otherCostNok: number;
  paymentFeeNok: number;
  totalCostNok: number;

  /* Resultat */
  contributionNok: number;
  contributionPct: number | null;

  /* Datakvalitet — tallene skal ikke framstå sikrere enn de er */
  lines: EconomicsLine[];
  linesWithKnownCost: number;
  totalLines: number;
  freightCostRegistered: boolean;
  /** true når varekosten kommer fra leverandørfaktura, ikke fra prislisten. */
  goodsCostFromInvoice: boolean;
  /** true bare når varekosten er kjent for alle linjer og frakt er registrert. */
  complete: boolean;
};

/**
 * Regner ut dekningsbidrag for én ordre.
 *
 * Ufullstendige data gir ikke feil tall, men et markert ufullstendig svar:
 * `complete` er false, og `linesWithKnownCost` viser hvor mange linjer som
 * faktisk har innkjøpspris. En manglende kostnad teller som 0 i summen, noe som
 * gjør dekningsbidraget for høyt — derfor må UI-et vise forbeholdet.
 */
export function calculateOrderEconomics(
  order: EconomicsOrderInput,
  lineInputs: EconomicsLineInput[],
): OrderEconomics {
  const lines: EconomicsLine[] = lineInputs.map((line) => {
    const grossRevenueNok = line.lineTotalNok;
    const netRevenueNok = netOfVat(grossRevenueNok);
    const costKnown = line.unitCostExVatNok != null && Number.isFinite(line.unitCostExVatNok);
    const costNok = costKnown ? (line.unitCostExVatNok as number) * line.quantity : 0;
    const contributionNok = netRevenueNok - costNok;

    return {
      id: line.id,
      nobbNumber: line.nobbNumber,
      productName: line.productName,
      quantity: line.quantity,
      unit: line.unit,
      grossRevenueNok,
      netRevenueNok,
      unitCostExVatNok: line.unitCostExVatNok,
      costNok,
      contributionNok: costKnown ? contributionNok : 0,
      marginPct: costKnown && netRevenueNok > 0 ? (contributionNok / netRevenueNok) * 100 : null,
      costKnown,
    };
  });

  const goodsNetRevenueNok = netOfVat(order.subtotalNok);
  const shippingNetRevenueNok = netOfVat(order.shippingNok);
  const grossRevenueNok = order.totalNok;
  const netRevenueNok = netOfVat(grossRevenueNok);
  const outgoingVatNok = vatWithin(grossRevenueNok);

  const goodsCostFromPriceList = lines.reduce((sum, line) => sum + line.costNok, 0);
  const goodsCostOverride = order.goodsCostOverrideExVatNok;
  const goodsCostFromInvoice = goodsCostOverride != null && Number.isFinite(goodsCostOverride);
  const goodsCostNok = goodsCostFromInvoice ? (goodsCostOverride as number) : goodsCostFromPriceList;
  const freightCostNok = order.freightCostExVatNok ?? 0;
  const otherCostNok = order.otherCostExVatNok ?? 0;
  const fee = paymentFeeNok(grossRevenueNok);

  const totalCostNok = goodsCostNok + freightCostNok + otherCostNok + fee;
  const contributionNok = netRevenueNok - totalCostNok;

  const linesWithKnownCost = lines.filter((line) => line.costKnown).length;

  return {
    grossRevenueNok,
    netRevenueNok,
    outgoingVatNok,
    goodsNetRevenueNok,
    shippingNetRevenueNok,

    goodsCostNok,
    freightCostNok,
    otherCostNok,
    paymentFeeNok: fee,
    totalCostNok,

    contributionNok,
    contributionPct: netRevenueNok > 0 ? (contributionNok / netRevenueNok) * 100 : null,

    lines,
    linesWithKnownCost,
    totalLines: lines.length,
    freightCostRegistered: order.freightCostExVatNok != null,
    goodsCostFromInvoice,
    complete:
      (goodsCostFromInvoice || (lines.length > 0 && linesWithKnownCost === lines.length)) &&
      order.freightCostExVatNok != null,
  };
}

/** Summerer dekningsbidrag på tvers av ordre, til nøkkeltall og Økonomi-siden. */
export function sumEconomics(all: OrderEconomics[]) {
  const netRevenueNok = all.reduce((sum, e) => sum + e.netRevenueNok, 0);
  const contributionNok = all.reduce((sum, e) => sum + e.contributionNok, 0);

  return {
    orderCount: all.length,
    grossRevenueNok: all.reduce((sum, e) => sum + e.grossRevenueNok, 0),
    netRevenueNok,
    outgoingVatNok: all.reduce((sum, e) => sum + e.outgoingVatNok, 0),
    goodsCostNok: all.reduce((sum, e) => sum + e.goodsCostNok, 0),
    freightCostNok: all.reduce((sum, e) => sum + e.freightCostNok, 0),
    otherCostNok: all.reduce((sum, e) => sum + e.otherCostNok, 0),
    paymentFeeNok: all.reduce((sum, e) => sum + e.paymentFeeNok, 0),
    totalCostNok: all.reduce((sum, e) => sum + e.totalCostNok, 0),
    contributionNok,
    contributionPct: netRevenueNok > 0 ? (contributionNok / netRevenueNok) * 100 : null,
    completeCount: all.filter((e) => e.complete).length,
    invoiceBackedCount: all.filter((e) => e.goodsCostFromInvoice).length,
  };
}
