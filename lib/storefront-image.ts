export const STORE_IMAGE_FALLBACK_URL = "https://www.svgrepo.com/show/372737/unknown-status.svg";

export function buildStorefrontNobbImagePath(nobbNumber: string) {
  return `/api/storefront-images/${encodeURIComponent(nobbNumber)}`;
}

export function isAllowedStorefrontImageUrl(value?: string | null) {
  if (!value || value.trim().length === 0) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "export.byggtjeneste.no" || url.hostname === "www.svgrepo.com");
  } catch {
    return false;
  }
}
