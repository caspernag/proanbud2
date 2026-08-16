import { netOfVat } from "@/lib/order-economics";

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
  const discountPct = cost === null || list === null || list <= 0 ? null : ((list - cost) / list) * 100;

  return { netPriceExVatNok, contributionNok, marginPct, discountPct };
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
