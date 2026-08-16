/**
 * Mva-regelen, ett sted.
 *
 * Denne modulen har MED VILJE ingen importer: den brukes både på serveren og i
 * klientkomponenter (marginkalkulatoren i /sjefen/produkter). Ligger regelen i
 * lib/material-order eller lib/order-economics drar man med seg prislister og
 * OpenAI-klienten inn i nettleserbunten.
 *
 * Konvensjonen i basen: butikkpriser er lagret INKLUSIVE mva, prisene fra
 * leverandørens prisfil er EKSKLUSIVE mva.
 */

export const VAT_RATE = 0.25;

/** Andel av et mva-inklusivt beløp som ER mva. 25 % mva ⇒ 20 % av bruttobeløpet. */
export const VAT_SHARE_OF_GROSS = VAT_RATE / (1 + VAT_RATE);

export function toVatInclusiveNok(value: number, vatRate = VAT_RATE) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  // Rundes til øre, ikke til hele kroner.
  return Math.max(0, Math.round(value * (1 + vatRate) * 100) / 100);
}

/** Trekker mva ut av et beløp som inkluderer mva. */
export function netOfVat(grossNok: number): number {
  if (!Number.isFinite(grossNok) || grossNok === 0) return 0;
  return grossNok / (1 + VAT_RATE);
}

/** Mva-beløpet som ligger inne i et mva-inklusivt beløp. */
export function vatWithin(grossNok: number): number {
  if (!Number.isFinite(grossNok) || grossNok === 0) return 0;
  return grossNok - netOfVat(grossNok);
}
