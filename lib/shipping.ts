/**
 * Fraktreglene for butikken, samlet ett sted.
 *
 * Terskelen lå tidligere hardkodet som `5000` i checkout-API-et, i
 * checkout-klienten og i topplinjen på butikken. Da må tre steder endres i takt
 * for at kunden ikke skal se ett løfte og bli fakturert noe annet.
 * Serverberegningen i /api/store/checkout er fasit — klienten viser kun det
 * samme regnestykket på forhånd.
 */

/** Ordre fra og med denne summen (eks. frakt) sendes fraktfritt. */
export const FREE_SHIPPING_THRESHOLD_NOK = 30_000;

/** Standard fraktpris for ordre under terskelen. */
export const STANDARD_SHIPPING_NOK = 1_000;

/**
 * Frakten som vises og belastes er et standardbeløp. Store kvanta, lange
 * avstander og spesialtransport kan koste mer, og det avklares med kunden før
 * levering — derfor dette forbeholdet overalt hvor frakt oppgis.
 */
export const SHIPPING_DISCLAIMER =
  "Ekstra fraktkostnad kan forekomme ved store kvanta, lange avstander eller spesialtransport. Vi tar kontakt før levering hvis det gjelder din ordre.";

/** Kort variant til trange flater som topplinje og oppsummeringsrader. */
export const SHIPPING_DISCLAIMER_SHORT = "Ekstra fraktkostnad kan forekomme.";

/** Terskelen formatert for løpende tekst, f.eks. «Gratis frakt over 30 000 kr». */
export const FREE_SHIPPING_LABEL = `${new Intl.NumberFormat("nb-NO").format(FREE_SHIPPING_THRESHOLD_NOK)} kr`;

/** Frakt for en gitt varesum. Tom handlekurv gir 0. */
export function calculateShippingNok(subtotalNok: number): number {
  if (subtotalNok <= 0) return 0;
  if (subtotalNok >= FREE_SHIPPING_THRESHOLD_NOK) return 0;
  return STANDARD_SHIPPING_NOK;
}

/** Hvor mye kunden mangler på fraktfritt kjøp. 0 når terskelen er nådd. */
export function amountUntilFreeShipping(subtotalNok: number): number {
  return Math.max(0, FREE_SHIPPING_THRESHOLD_NOK - subtotalNok);
}

/** Andel av veien til fraktfritt, 0–100. Til framdriftsindikatoren i kassen. */
export function freeShippingProgressPct(subtotalNok: number): number {
  if (subtotalNok <= 0) return 0;
  return Math.min(100, (subtotalNok / FREE_SHIPPING_THRESHOLD_NOK) * 100);
}
