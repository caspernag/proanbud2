import { netOfVat, toVatInclusiveNok } from "@/lib/vat";

/**
 * Dekningsbidrag per produkt i katalogen.
 *
 * SAMME MVA-REGEL SOM I lib/order-economics: butikkprisen
 * (`storefront_products.unit_price_nok`) er lagret INKLUSIVE mva, mens prisene
 * fra prisfilen — innkjøpspris og veiledende pris — er EKSKLUSIVE mva. Marginen
 * må regnes eks. mva på begge sider, ellers ser hver vare ~25 % mer lønnsom ut
 * enn den er.
 */

export type ProductMarginInput = {
  /** Utsalgspris inkl. mva, slik den ligger i katalogen. */
  unitPriceNok: number;
  /** Innkjøpspris eks. mva fra prisfilen. null = ukjent. */
  costPriceExVatNok: number | string | null;
  /** Leverandørens veiledende pris eks. mva fra prisfilen. null = ukjent. */
  listPriceExVatNok: number | string | null;
};

export type ProductMargin = {
  /** Salgspris eks. mva — det eneste tallet som er sammenlignbart med innkjøpsprisen. */
  netPriceExVatNok: number;
  /** Dekningsbidrag i kroner per enhet, eks. mva. null når innkjøpsprisen er ukjent. */
  contributionNok: number | null;
  /** Dekningsgrad i prosent av netto salgspris. null når innkjøpsprisen er ukjent. */
  marginPct: number | null;
  /**
   * Påslag i prosent AV INNKJØPSPRISEN — samme størrelse som
   * `supplier_markups.markup_percentage`. 25 % påslag = 20 % dekningsgrad, så
   * de to tallene må aldri forveksles.
   */
  markupPct: number | null;
  /**
   * Innkjøpsrabatten fra prisfilen: hvor mye under veiledende pris vi kjøper.
   * Negativ verdi betyr at vi betaler mer enn veiledende — da er det ingen
   * rabatt å skjule, og tallet skal vises som det er.
   */
  discountPct: number | null;
};

export function calculateProductMargin(input: ProductMarginInput): ProductMargin {
  const netPriceExVatNok = netOfVat(toPositiveNumber(input.unitPriceNok) ?? 0);
  const cost = toPositiveNumber(input.costPriceExVatNok);
  const list = toPositiveNumber(input.listPriceExVatNok);

  const contributionNok = cost === null ? null : netPriceExVatNok - cost;
  const marginPct =
    contributionNok === null || netPriceExVatNok <= 0
      ? null
      : (contributionNok / netPriceExVatNok) * 100;
  const markupPct = contributionNok === null || cost === null || cost <= 0 ? null : (contributionNok / cost) * 100;
  const discountPct = cost === null || list === null || list <= 0 ? null : ((list - cost) / list) * 100;

  return { netPriceExVatNok, contributionNok, marginPct, markupPct, discountPct };
}

/**
 * Utsalgspris inkl. mva som gir ønsket DEKNINGSGRAD (andel av salgsprisen).
 *
 * 100 % dekningsgrad krever uendelig pris, så alt fra 100 og oppover er
 * umulig — da returneres null i stedet for et tall som ser gyldig ut.
 * Resultatet rundes til hele kroner fordi `unit_price_nok` er en integer-kolonne;
 * den faktiske dekningsgraden etter avrunding kan avvike litt, og skal leses av
 * `calculateProductMargin` på den avrundede prisen.
 */
export function priceInclVatFromMarginPct(costExVatNok: number, marginPct: number): number | null {
  if (!Number.isFinite(costExVatNok) || costExVatNok <= 0) return null;
  if (!Number.isFinite(marginPct) || marginPct >= 100) return null;

  return Math.max(0, Math.round(toVatInclusiveNok(costExVatNok / (1 - marginPct / 100))));
}

/** Utsalgspris inkl. mva som gir ønsket PÅSLAG (prosent av innkjøpsprisen). */
export function priceInclVatFromMarkupPct(costExVatNok: number, markupPct: number): number | null {
  if (!Number.isFinite(costExVatNok) || costExVatNok <= 0) return null;
  if (!Number.isFinite(markupPct) || markupPct <= -100) return null;

  return Math.max(0, Math.round(toVatInclusiveNok(costExVatNok * (1 + markupPct / 100))));
}

/** Formaterer prosent med ett desimal, norsk stil. `null` blir «—». */
export function pctNo(value: number | null, fractionDigits = 1) {
  if (value === null || !Number.isFinite(value)) return "—";

  return `${new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)} %`;
}

/** Kroner med to desimaler — innkjøpspriser har ører som forsvinner i vanlig `nok()`. */
export function nokExact(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";

  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Fargekode for dekningsgrad. Grensene er satt lavt med vilje: en byggevare med
 * under 5 % dekning tåler ikke frakt og betalingsgebyr, og skal skille seg ut.
 */
export function marginTone(marginPct: number | null): "unknown" | "loss" | "thin" | "ok" {
  if (marginPct === null || !Number.isFinite(marginPct)) return "unknown";
  if (marginPct < 0) return "loss";
  if (marginPct < 5) return "thin";
  return "ok";
}

function toPositiveNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}
