import type { StorefrontProduct } from "@/lib/storefront-types";

export const STOREFRONT_USER_PROFILE_COOKIE = "proanbud_storefront_profile_v1";

const MAX_PROFILE_SIGNALS = 16;
const MAX_RECENT_NOBBS = 24;
const PROFILE_COOKIE_TARGET_LENGTH = 3600;
const PROFILE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

type WeightedSignal = {
  key: string;
  score: number;
};

export type StorefrontUserProfile = {
  v: 1;
  updatedAt: number;
  views: number;
  recentNobbs: string[];
  categories: WeightedSignal[];
  suppliers: WeightedSignal[];
  brands: WeightedSignal[];
  terms: WeightedSignal[];
  queries: WeightedSignal[];
};

export type StorefrontProfileProductInput = Pick<
  StorefrontProduct,
  "nobbNumber" | "productName" | "category" | "sectionTitle" | "supplierName" | "brand"
>;

export type StorefrontProfileSearchInput = {
  q?: string;
  category?: string;
  supplier?: string;
};

export function createEmptyStorefrontUserProfile(): StorefrontUserProfile {
  return {
    v: 1,
    updatedAt: Date.now(),
    views: 0,
    recentNobbs: [],
    categories: [],
    suppliers: [],
    brands: [],
    terms: [],
    queries: [],
  };
}

export function parseStorefrontUserProfileCookie(raw: string | undefined | null): StorefrontUserProfile {
  if (!raw) return createEmptyStorefrontUserProfile();

  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded) as Partial<StorefrontUserProfile>;

    if (!parsed || parsed.v !== 1) {
      return createEmptyStorefrontUserProfile();
    }

    return compactStorefrontUserProfile({
      v: 1,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      views: typeof parsed.views === "number" ? Math.max(0, Math.round(parsed.views)) : 0,
      recentNobbs: normalizeRecentNobbs(parsed.recentNobbs),
      categories: normalizeSignals(parsed.categories),
      suppliers: normalizeSignals(parsed.suppliers),
      brands: normalizeSignals(parsed.brands),
      terms: normalizeSignals(parsed.terms),
      queries: normalizeSignals(parsed.queries),
    });
  } catch {
    return createEmptyStorefrontUserProfile();
  }
}

export function serializeStorefrontUserProfileCookie(profile: StorefrontUserProfile) {
  let compactProfile = compactStorefrontUserProfile(profile);
  let encoded = encodeURIComponent(JSON.stringify(compactProfile));

  for (const limit of [12, 10, 8, 6]) {
    if (encoded.length <= PROFILE_COOKIE_TARGET_LENGTH) break;
    compactProfile = trimProfileSignals(compactProfile, limit);
    encoded = encodeURIComponent(JSON.stringify(compactProfile));
  }

  return encoded;
}

export function buildStorefrontUserProfileCookie(value: string) {
  return `${STOREFRONT_USER_PROFILE_COOKIE}=${value}; Path=/; Max-Age=${PROFILE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function trackStorefrontProductView(
  profile: StorefrontUserProfile,
  product: StorefrontProfileProductInput,
  weight = 4,
) {
  const next = cloneProfile(profile);
  next.views += 1;
  next.updatedAt = Date.now();
  next.recentNobbs = addRecentNobb(next.recentNobbs, product.nobbNumber);

  addSignal(next.categories, product.category, weight);
  addSignal(next.categories, product.sectionTitle, weight * 0.35);
  addSignal(next.suppliers, product.supplierName, weight * 0.55);
  addSignal(next.brands, product.brand, weight * 0.5);
  for (const term of extractProfileTerms(product.productName)) {
    addSignal(next.terms, term, weight * 0.55);
  }

  return compactStorefrontUserProfile(next);
}

export function trackStorefrontProductImpressions(
  profile: StorefrontUserProfile,
  products: StorefrontProfileProductInput[],
) {
  let next = cloneProfile(profile);

  for (const product of products.slice(0, 12)) {
    next = trackStorefrontProductView(next, product, 0.45);
  }

  return compactStorefrontUserProfile(next);
}

export function trackStorefrontSearch(profile: StorefrontUserProfile, search: StorefrontProfileSearchInput) {
  const q = (search.q ?? "").trim();
  const category = (search.category ?? "").trim();
  const supplier = (search.supplier ?? "").trim();

  if (!q && !category && !supplier) {
    return profile;
  }

  const next = cloneProfile(profile);
  next.updatedAt = Date.now();

  if (q) {
    addSignal(next.queries, q, 3.25);
    for (const term of extractProfileTerms(q)) {
      addSignal(next.terms, term, 2.25);
    }
  }
  addSignal(next.categories, category, 2.5);
  addSignal(next.suppliers, supplier, 1.75);

  return compactStorefrontUserProfile(next);
}

export function scoreStorefrontProductForUserProfile(product: StorefrontProduct, profile?: StorefrontUserProfile | null) {
  if (!profile || profile.views === 0) {
    return 0;
  }

  let score = 0;
  score += signalScore(profile.categories, product.category) * 9;
  score += signalScore(profile.categories, product.sectionTitle) * 3;
  score += signalScore(profile.suppliers, product.supplierName) * 4;
  score += signalScore(profile.brands, product.brand) * 4;

  const haystack = [product.productName, product.description, product.category, product.sectionTitle, product.brand]
    .join(" ")
    .toLowerCase();
  for (const signal of profile.terms) {
    if (signal.key && haystack.includes(signal.key)) {
      score += signal.score * 2.5;
    }
  }

  const recentIndex = profile.recentNobbs.indexOf(product.nobbNumber);
  if (recentIndex >= 0) {
    score += Math.max(0, 9 - recentIndex * 0.65);
  }

  return score;
}

export function hasStorefrontUserProfile(profile?: StorefrontUserProfile | null) {
  return Boolean(profile && (profile.views > 0 || profile.queries.length > 0));
}

function compactStorefrontUserProfile(profile: StorefrontUserProfile): StorefrontUserProfile {
  return {
    ...profile,
    updatedAt: Math.round(profile.updatedAt || Date.now()),
    views: Math.min(9999, Math.max(0, Math.round(profile.views || 0))),
    recentNobbs: normalizeRecentNobbs(profile.recentNobbs),
    categories: compactSignals(profile.categories),
    suppliers: compactSignals(profile.suppliers),
    brands: compactSignals(profile.brands),
    terms: compactSignals(profile.terms),
    queries: compactSignals(profile.queries),
  };
}

function trimProfileSignals(profile: StorefrontUserProfile, limit: number): StorefrontUserProfile {
  return {
    ...profile,
    recentNobbs: profile.recentNobbs.slice(0, Math.max(8, limit)),
    categories: profile.categories.slice(0, limit),
    suppliers: profile.suppliers.slice(0, limit),
    brands: profile.brands.slice(0, limit),
    terms: profile.terms.slice(0, limit),
    queries: profile.queries.slice(0, limit),
  };
}

function cloneProfile(profile: StorefrontUserProfile): StorefrontUserProfile {
  return {
    ...profile,
    recentNobbs: [...profile.recentNobbs],
    categories: profile.categories.map((signal) => ({ ...signal })),
    suppliers: profile.suppliers.map((signal) => ({ ...signal })),
    brands: profile.brands.map((signal) => ({ ...signal })),
    terms: profile.terms.map((signal) => ({ ...signal })),
    queries: profile.queries.map((signal) => ({ ...signal })),
  };
}

function addSignal(signals: WeightedSignal[], value: string | undefined, score: number) {
  const key = normalizeSignalKey(value);
  if (!key || score <= 0) return;

  const existing = signals.find((signal) => signal.key === key);
  if (existing) {
    existing.score = Math.min(99, existing.score + score);
    return;
  }

  signals.push({ key, score });
}

function signalScore(signals: WeightedSignal[], value: string | undefined) {
  const key = normalizeSignalKey(value);
  if (!key) return 0;

  return signals.find((signal) => signal.key === key)?.score ?? 0;
}

function compactSignals(signals: WeightedSignal[]) {
  const byKey = new Map<string, number>();
  for (const signal of signals) {
    const key = normalizeSignalKey(signal.key);
    if (!key || !Number.isFinite(signal.score) || signal.score <= 0) continue;
    byKey.set(key, Math.min(99, (byKey.get(key) ?? 0) + signal.score));
  }

  return Array.from(byKey, ([key, score]) => ({ key, score: Math.round(score * 10) / 10 }))
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key, "nb-NO"))
    .slice(0, MAX_PROFILE_SIGNALS);
}

function normalizeSignals(value: unknown) {
  if (!Array.isArray(value)) return [];

  return compactSignals(
    value.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const signal = entry as Partial<WeightedSignal>;
      return typeof signal.key === "string" && typeof signal.score === "number" ? [signal as WeightedSignal] : [];
    }),
  );
}

function addRecentNobb(current: string[], nobbNumber: string | undefined) {
  const normalized = (nobbNumber ?? "").replace(/\D/g, "");
  if (!normalized) return current;

  return [normalized, ...current.filter((value) => value !== normalized)].slice(0, MAX_RECENT_NOBBS);
}

function normalizeRecentNobbs(value: unknown) {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.replace(/\D/g, ""))
        .filter(Boolean),
    ),
  ).slice(0, MAX_RECENT_NOBBS);
}

function normalizeSignalKey(value: string | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function extractProfileTerms(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9æøå]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !PROFILE_STOPWORDS.has(term) && !/^\d+$/.test(term))
    .slice(0, 8);
}

const PROFILE_STOPWORDS = new Set([
  "med",
  "uten",
  "for",
  "til",
  "som",
  "stk",
  "pak",
  "sett",
  "set",
  "ubh",
  "obh",
  "m2",
  "mm",
  "cm",
]);