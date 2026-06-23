/**
 * Shopper-facing category taxonomy for the storefront.
 *
 * The catalog already derives a precise leaf `category` per product from the
 * Byggmakker product-group codes (see lib/price-lists.ts `CATEGORY_BY_CODE`).
 * That gives ~38 leaf categories — too many for a top-level menu and too flat
 * to browse. This module groups those leaves into a small set of shopper-facing
 * DEPARTMENTS (hovedkategorier), mirroring how Byggmakker / Montér / Maxbo /
 * Obs BYGG structure their webshops.
 *
 * Design notes:
 * - Two clean levels: department → leaf category. We intentionally do NOT expose
 *   the 7-digit Byggmakker subgroup codes as a third level: they carry no
 *   human-readable labels, so a derived third level would be noisy.
 * - This is a pure presentation layer over the existing `category` field — no DB
 *   migration, no change to pricing or the `sectionTitle` (which stays
 *   project-phase oriented for AI material lists).
 * - Filtering resolves a URL value to an EXACT set of leaf categories, so we
 *   filter on the indexed `category` column instead of fragile substring/ILIKE
 *   matching (which mis-filed e.g. "tak" into "kontakt"/"taklist").
 *
 * No "server-only" import: this is shared by server pages and client components.
 */

export type StorefrontDepartment = {
  /** URL-safe ascii slug used in `?category=<slug>`. */
  slug: string;
  /** Norwegian display label. */
  label: string;
  /** lucide-react icon name (reserved for future icon rendering). */
  icon: string;
  /** Leaf categories (exact `product.category` values) that belong here. */
  categories: string[];
  /**
   * Default ordering weight (lower = earlier) used only as a stable tiebreaker.
   * The UI orders departments dynamically by live product count.
   */
  defaultOrder: number;
};

/**
 * The 11 departments, with the full set of leaf categories produced by
 * `CATEGORY_BY_CODE`. Order here is a sensible default for a tool/hardware/paint
 * heavy assortment; the UI re-sorts by actual counts.
 */
export const STOREFRONT_DEPARTMENTS: StorefrontDepartment[] = [
  {
    slug: "festemidler-og-beslag",
    label: "Festemidler og beslag",
    icon: "bolt",
    defaultOrder: 1,
    categories: ["Festemidler", "Jernvarer"],
  },
  {
    slug: "verktoy-og-maskiner",
    label: "Verktøy og maskiner",
    icon: "drill",
    defaultOrder: 2,
    categories: ["Elverktøy", "Håndverktøy", "Tilbehør"],
  },
  {
    slug: "maling-og-overflate",
    label: "Maling og overflate",
    icon: "paint-roller",
    defaultOrder: 3,
    categories: ["Maling", "Overflatebehandling", "Pensler og ruller", "Sparkel", "Tapet og vegg"],
  },
  {
    slug: "lim-fuge-og-tetting",
    label: "Lim, fuge og tetting",
    icon: "droplets",
    defaultOrder: 4,
    categories: ["Lim og fuge", "Tetting og fukt"],
  },
  {
    slug: "tak-og-takrenner",
    label: "Tak og takrenner",
    icon: "house",
    defaultOrder: 5,
    categories: ["Takbeslag", "Taktekking"],
  },
  {
    slug: "trelast-og-byggevarer",
    label: "Trelast og byggevarer",
    icon: "construction",
    defaultOrder: 6,
    categories: [
      "Konstruksjonsvirke",
      "Limtre",
      "Terrasse",
      "Kledning",
      "Gips og plater",
      "Isolasjon",
      "Armering",
      "Stålprofiler",
      "Gjerde og stolper",
      "Innvendig panel",
      "Spileplater og akustikk",
    ],
  },
  {
    slug: "gulv-og-listverk",
    label: "Gulv og listverk",
    icon: "layout-grid",
    defaultOrder: 7,
    categories: ["Gulv", "Gulvbelegg", "Lister"],
  },
  {
    slug: "mur-og-betong",
    label: "Mur og betong",
    icon: "brick-wall",
    defaultOrder: 8,
    categories: ["Mur og betong"],
  },
  {
    slug: "kjokken-og-bad",
    label: "Kjøkken og bad",
    icon: "bath",
    defaultOrder: 9,
    categories: ["Innredning", "Baderom"],
  },
  {
    slug: "dor-og-vindu",
    label: "Dør og vindu",
    icon: "door-open",
    defaultOrder: 10,
    categories: ["Dører", "Vinduer", "Garasjeport", "Ventilasjon"],
  },
  {
    slug: "sikkerhet-og-forbruk",
    label: "Sikkerhet og forbruk",
    icon: "shield-check",
    defaultOrder: 11,
    // Real categories + the catch-all home for clearance / fallback values
    // ("Generelt", "Diverse") so every product has a canonical department.
    categories: ["Sikkerhet", "Forbruksvarer", "Tilbud og restesalg", "Generelt", "Diverse"],
  },
];

/** Department that absorbs any leaf category not explicitly mapped above. */
const FALLBACK_DEPARTMENT = STOREFRONT_DEPARTMENTS[STOREFRONT_DEPARTMENTS.length - 1];

const DEPARTMENT_BY_SLUG = new Map(STOREFRONT_DEPARTMENTS.map((d) => [d.slug, d]));
const DEPARTMENT_BY_LABEL = new Map(STOREFRONT_DEPARTMENTS.map((d) => [d.label.toLowerCase(), d]));
const DEPARTMENT_BY_CATEGORY = new Map<string, StorefrontDepartment>();
for (const department of STOREFRONT_DEPARTMENTS) {
  for (const category of department.categories) {
    DEPARTMENT_BY_CATEGORY.set(category.toLowerCase(), department);
  }
}

/** Every leaf category that has an explicit home, lowercased → canonical name. */
const LEAF_CATEGORY_BY_LOWER = new Map<string, string>();
for (const department of STOREFRONT_DEPARTMENTS) {
  for (const category of department.categories) {
    LEAF_CATEGORY_BY_LOWER.set(category.toLowerCase(), category);
  }
}

/**
 * Legacy `?category=` values that predate the department model and may still
 * live in bookmarks / external links. Maps a lowercased value to a department
 * slug so old links keep resolving. (Bare leaf names like "Maling"/"Isolasjon"
 * are NOT listed here — they resolve as exact leaves and stay precise.)
 */
const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  trelast: "trelast-og-byggevarer",
  plater: "trelast-og-byggevarer",
  tak: "tak-og-takrenner",
  "verktøy": "verktoy-og-maskiner",
  verktoy: "verktoy-og-maskiner",
};

export function departmentBySlug(slug: string): StorefrontDepartment | undefined {
  return DEPARTMENT_BY_SLUG.get(slug.trim().toLowerCase());
}

/** The canonical department for a leaf category (falls back to the tail dept). */
export function departmentForCategory(category: string): StorefrontDepartment {
  return DEPARTMENT_BY_CATEGORY.get(category.trim().toLowerCase()) ?? FALLBACK_DEPARTMENT;
}

export type StorefrontCategoryFilter = {
  kind: "department" | "leaf";
  /** Exact leaf categories to match `product.category` against. */
  leaves: string[];
  /** Department context for breadcrumbs / active-state (always resolved). */
  department: StorefrontDepartment;
  /** The specific leaf, when the filter narrows to one leaf category. */
  leaf?: string;
  /** Human label for the active filter (leaf name or department label). */
  label: string;
};

/**
 * Resolves a raw `?category=` value into an exact leaf-category set plus
 * breadcrumb context. Returns null when there is no filter (browse everything).
 *
 * Resolution order (most specific first):
 *  1. empty → null
 *  2. exact leaf category (case-insensitive) → single-leaf filter
 *  3. department slug → whole-department filter
 *  4. legacy broad alias → whole-department filter
 *  5. department label → whole-department filter
 *  6. unknown → treat as a literal leaf (exact eq; yields 0 if truly unknown)
 */
export function resolveStorefrontCategoryFilter(value: string | null | undefined): StorefrontCategoryFilter | null {
  const raw = (value ?? "").trim();
  if (!raw) {
    return null;
  }
  const lower = raw.toLowerCase();

  // 2. Exact leaf category.
  const leafName = LEAF_CATEGORY_BY_LOWER.get(lower);
  if (leafName) {
    const department = departmentForCategory(leafName);
    return { kind: "leaf", leaves: [leafName], department, leaf: leafName, label: leafName };
  }

  // 3. Department slug.
  const bySlug = DEPARTMENT_BY_SLUG.get(lower);
  if (bySlug) {
    return { kind: "department", leaves: bySlug.categories, department: bySlug, label: bySlug.label };
  }

  // 4. Legacy broad alias.
  const aliasSlug = LEGACY_CATEGORY_ALIASES[lower];
  if (aliasSlug) {
    const department = DEPARTMENT_BY_SLUG.get(aliasSlug)!;
    return { kind: "department", leaves: department.categories, department, label: department.label };
  }

  // 5. Department label.
  const byLabel = DEPARTMENT_BY_LABEL.get(lower);
  if (byLabel) {
    return { kind: "department", leaves: byLabel.categories, department: byLabel, label: byLabel.label };
  }

  // 6. Unknown — literal exact match so we never crash or substring-leak.
  return { kind: "leaf", leaves: [raw], department: FALLBACK_DEPARTMENT, leaf: raw, label: raw };
}

/** Aggregates leaf-category counts into department counts. */
export function computeDepartmentCounts(categoryCounts: Record<string, number>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const department of STOREFRONT_DEPARTMENTS) {
    counts[department.slug] = 0;
  }
  for (const [category, count] of Object.entries(categoryCounts)) {
    const department = departmentForCategory(category);
    counts[department.slug] = (counts[department.slug] ?? 0) + count;
  }
  return counts;
}

/**
 * Departments ordered for display: by live count (desc), then by defaultOrder.
 * Departments with zero products are dropped unless `includeEmpty` is set.
 */
export function orderedDepartments(
  departmentCounts: Record<string, number>,
  options: { includeEmpty?: boolean } = {},
): Array<StorefrontDepartment & { count: number }> {
  return STOREFRONT_DEPARTMENTS.map((department) => ({
    ...department,
    count: departmentCounts[department.slug] ?? 0,
  }))
    .filter((department) => options.includeEmpty || department.count > 0)
    .sort((left, right) => right.count - left.count || left.defaultOrder - right.defaultOrder);
}

/**
 * Leaf categories of a department that have products, ordered by count (desc).
 * Used for the in-department drill-down (sidebar / department landing).
 */
export function leafCategoriesForDepartment(
  department: Pick<StorefrontDepartment, "categories">,
  categoryCounts: Record<string, number>,
): Array<{ category: string; count: number }> {
  return department.categories
    .map((category) => ({ category, count: categoryCounts[category] ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category, "nb-NO"));
}
