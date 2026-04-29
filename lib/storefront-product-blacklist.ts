import type { StorefrontProduct } from "@/lib/storefront-types";

export type StorefrontProductBlacklistEntry = {
  id?: string;
  slug?: string;
  nobbNumber?: string;
  ean?: string;
  productName?: string;
  reason?: string;
};

// Legg produkter som skal skjules fra nettbutikken her. NOBB-nummer er tryggest.
export const STOREFRONT_PRODUCT_BLACKLIST: StorefrontProductBlacklistEntry[] = [
  // { nobbNumber: "12345678", reason: "Eksempel" },
];

export function filterStorefrontBlacklistedProducts(products: StorefrontProduct[]) {
  return products.filter((product) => !isStorefrontProductBlacklisted(product));
}

export function isStorefrontProductBlacklisted(product: StorefrontProduct) {
  const entries = getStorefrontProductBlacklistEntries();

  return entries.some((entry) => matchesBlacklistEntry(product, entry));
}

export function getStorefrontProductBlacklistEntries() {
  return [...STOREFRONT_PRODUCT_BLACKLIST, ...parseRuntimeBlacklist(process.env.STOREFRONT_PRODUCT_BLACKLIST ?? "")];
}

function matchesBlacklistEntry(product: StorefrontProduct, entry: StorefrontProductBlacklistEntry) {
  const id = normalizeText(entry.id);
  const slug = normalizeText(entry.slug);
  const nobbNumber = normalizeDigits(entry.nobbNumber);
  const ean = normalizeDigits(entry.ean);
  const productName = normalizeText(entry.productName);

  if (id && normalizeText(product.id) === id) return true;
  if (slug && normalizeText(product.slug) === slug) return true;
  if (nobbNumber && normalizeDigits(product.nobbNumber) === nobbNumber) return true;
  if (ean && normalizeDigits(product.ean) === ean) return true;
  if (productName && normalizeText(product.productName).includes(productName)) return true;

  return false;
}

function parseRuntimeBlacklist(raw: string): StorefrontProductBlacklistEntry[] {
  return raw
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      if (/^nobb:/i.test(value)) return { nobbNumber: value.replace(/^nobb:/i, "") };
      if (/^ean:/i.test(value)) return { ean: value.replace(/^ean:/i, "") };
      if (/^id:/i.test(value)) return { id: value.replace(/^id:/i, "") };
      if (/^slug:/i.test(value)) return { slug: value.replace(/^slug:/i, "") };
      if (/^name:/i.test(value)) return { productName: value.replace(/^name:/i, "") };

      return /^\d+$/.test(value) ? { nobbNumber: value } : { slug: value };
    });
}

function normalizeDigits(value: string | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

function normalizeText(value: string | undefined) {
  return (value ?? "").trim().toLowerCase();
}