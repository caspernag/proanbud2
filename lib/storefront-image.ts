/**
 * Lokalt fallback-bilde. Ligger i `public/` med vilje: det gamle fallbacket
 * pekte på et tredjeparts-CDN (svgrepo.com), som ga en ekstern request per
 * produkt uten bilde — på en tjeneste vi verken kontrollerer oppetiden eller
 * responstiden til. Same-origin betyr også at `next/image` kan behandle alle
 * bildekilder likt, uten redirect ut av domenet.
 */
export const STORE_IMAGE_FALLBACK_URL = "/produktbilde-mangler.svg";

export function buildStorefrontNobbImagePath(nobbNumber: string) {
  return `/api/storefront-images/${encodeURIComponent(nobbNumber)}`;
}

export function isAllowedStorefrontImageUrl(value?: string | null) {
  if (!value || value.trim().length === 0) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "export.byggtjeneste.no";
  } catch {
    return false;
  }
}
