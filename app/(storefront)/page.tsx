import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";

import { AddToMaterialListButton } from "@/app/_components/storefront/add-to-material-list-button";
import { AddToCartWithQuantity } from "@/app/_components/storefront/add-to-cart-with-quantity";
import { StorefrontMobileControls } from "@/app/_components/storefront/storefront-mobile-controls";
import { StorefrontProfileTracker } from "@/app/_components/storefront/storefront-profile-tracker";
import { StorefrontProductImage } from "@/app/_components/storefront/storefront-product-image";
import { StorefrontViewControls } from "@/app/_components/storefront/storefront-view-controls";
import { getByggmakkerAvailabilityBatch, type ByggmakkerAvailability } from "@/lib/byggmakker-availability";
import {
  getStorefrontCatalogMeta,
  getStorefrontImageUrl,
  getStorefrontProductsByNobb,
  queryStorefrontProducts,
} from "@/lib/storefront";
import { parseStorefrontUserProfileCookie, STOREFRONT_USER_PROFILE_COOKIE } from "@/lib/storefront-user-profile";
import {
  computeDepartmentCounts,
  leafCategoriesForDepartment,
  orderedDepartments,
  resolveStorefrontCategoryFilter,
  type StorefrontCategoryFilter,
} from "@/lib/storefront-taxonomy";
import type { StorefrontProduct, StorefrontSortOption } from "@/lib/storefront-types";
import { formatCurrency } from "@/lib/utils";

type StockStatus = "in-stock" | "store-stock" | "backorder" | "unknown";
type ProductStockInfo = {
  status: StockStatus;
  label: string;
  detail?: string;
};

const UNKNOWN_PRODUCT_STOCK: ProductStockInfo = {
  status: "unknown",
  label: "Sjekk lager",
};

const EMPTY_STOCK_MAP = new Map<string, ProductStockInfo>();

type StorefrontPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Most popular products among private / DIY customers – curated from the Byggmakker price list.
const MOST_POPULAR_NOBB = [
  "25410978", // FURU 28X120 CUIMP TERRASSE KL1
  "23304215", // FURU 28X120 TERR ROYAL BRUN
  "11303617", // GRAN 36X148 K-VIRKE C24
  "11303641", // GRAN 48X098 K-VIRKE C24
  "11303666", // GRAN 48X148 K-VIRKE C24
  "10397701", // GIPSPLATE STD 1200X2400X12,5
  "10397735", // GIPSPLATE STD 1200X2700X12,5
  "60638110", // OSB 3 ZERO 12X2400X1220 TG2
  "60638112", // OSB 3 ZERO 18X2400X1220 TG2
  "50673624", // GLAVA PROFF 34 PLATE 10X57X120
  "56831354", // ISOLASJON EPS 100X600X1200MM
  "25411299", // FURU 36X048 CUIMP LEKT KL1
  "11302643", // G-F 36X048 LEKT/REKKE KL1
  "25386400", // FURU 19X098 REKTKLED IMP KL1
  "60137368", // VINDSPERRE BASIC 1,30X25M
  "60743886", // KONSTRUKSJONSKRUE WAF 6X40
];

export default async function StorefrontPage({ searchParams }: StorefrontPageProps) {
  const resolvedSearchParams = await searchParams;
  const cookieStore = await cookies();
  const userProfile = parseStorefrontUserProfileCookie(cookieStore.get(STOREFRONT_USER_PROFILE_COOKIE)?.value);
  const q = typeof resolvedSearchParams.q === "string" ? resolvedSearchParams.q : "";
  const category = typeof resolvedSearchParams.category === "string" ? resolvedSearchParams.category : "";
  const supplier = typeof resolvedSearchParams.supplier === "string" ? resolvedSearchParams.supplier : "";
  const sort = normalizeSortOption(typeof resolvedSearchParams.sort === "string" ? resolvedSearchParams.sort : "");
  const inStockOnly = resolvedSearchParams.inStock === "1";
  const page = typeof resolvedSearchParams.page === "string" ? Number.parseInt(resolvedSearchParams.page, 10) : 1;
  const cols = normalizeGridColumns(typeof resolvedSearchParams.cols === "string" ? resolvedSearchParams.cols : "");

  const result = await queryStorefrontProducts({
    q,
    category,
    supplier,
    sort,
    userProfile,
    page: Number.isFinite(page) ? page : 1,
  });

  const hasFilters = Boolean(q || category || supplier || inStockOnly);
  const showLanding = !hasFilters && result.page === 1;
  // Precomputed facets — category counts live in storefront_catalog_meta
  // (refreshed by the catalog job), so we never scan the full catalog per request.
  const meta = await getStorefrontCatalogMeta();
  // Department counts are derived from the per-leaf category counts (no migration,
  // always in sync). Ordering is by live count so the tile/menu order adapts to
  // whatever supplier file is loaded.
  const departmentCounts = computeDepartmentCounts(meta.categoryCounts);
  const departments = orderedDepartments(departmentCounts);
  const activeFilter = resolveStorefrontCategoryFilter(category);
  const featuredDeals = showLanding ? await getStorefrontProductsByNobb(MOST_POPULAR_NOBB) : [];

  const stockFilterCandidates = inStockOnly
    ? await queryStorefrontProducts({
        q,
        category,
        supplier,
        sort,
        userProfile,
        page: 1,
        pageSize: Math.max(result.total, 1),
        pageSizeLimit: Math.max(result.total, 1),
      })
    : null;
  const shouldPrioritizeNetStock = !inStockOnly && hasFilters;
  const stockCandidateItems = stockFilterCandidates?.items ?? [];

  // When inStockOnly, fetch stock immediately (required for filtering).
  // Otherwise, stock is streamed in lazily via Suspense in StockedDealsStrip / StockedProductGrid.
  const stockByEan = new Map<string, ProductStockInfo>();
  if (inStockOnly) {
    const candidateEans = new Set<string>();
    for (const product of stockCandidateItems) {
      if (product.ean) candidateEans.add(product.ean);
    }
    const availabilityMap = candidateEans.size
      ? await getByggmakkerAvailabilityBatch(candidateEans)
      : new Map<string, ByggmakkerAvailability>();
    for (const [ean, info] of availabilityMap) {
      stockByEan.set(ean, buildProductStockInfo(info));
    }
  }
  const stockFilteredItems = inStockOnly
    ? stockCandidateItems.filter((product) => product.ean && isProductInStock(stockByEan.get(product.ean)))
    : result.items;
  const filteredTotal = inStockOnly ? stockFilteredItems.length : result.total;
  const filteredTotalPages = Math.max(1, Math.ceil(filteredTotal / result.pageSize));
  const filteredPage = inStockOnly ? Math.min(Math.max(1, page), filteredTotalPages) : result.page;
  const displayItems = inStockOnly
    ? stockFilteredItems.slice((filteredPage - 1) * result.pageSize, filteredPage * result.pageSize)
    : result.items;

  return (
    <div className="space-y-6">
      <StorefrontProfileTracker
        search={{ q, category, supplier }}
        visibleProducts={displayItems.map(mapProductForProfile).slice(0, 12)}
      />
      {showLanding ? (
        <>
          {featuredDeals.length > 0 ? (
            <Suspense fallback={<DealsStrip deals={featuredDeals} stockByEan={EMPTY_STOCK_MAP} />}>
              <StockedDealsStrip deals={featuredDeals} />
            </Suspense>
          ) : null}
          {departments.length > 0 ? (
            <CategoryTiles departments={departments} />
          ) : null}
          <div className="hidden sm:block"><ValuePropsBand /></div>
        </>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Desktop sidebar – hidden on mobile */}
        <aside className="hidden space-y-4 lg:sticky lg:top-[168px] lg:block lg:self-start">
          <FilterPanel
            q={q}
            category={category}
            supplier={supplier}
            sort={sort}
            inStockOnly={inStockOnly}
            cols={cols}
            departments={departments}
            categoryCounts={meta.categoryCounts}
            activeFilter={activeFilter}
            priceRange={result.priceRange}
          />

          <TrustCard />
        </aside>

        <div className="space-y-4">
          <Suspense>
            <StorefrontMobileControls
              activeFiltersCount={(q ? 1 : 0) + (category ? 1 : 0) + (supplier ? 1 : 0) + (inStockOnly ? 1 : 0)}
              initialSort={sort}
              initialInStockOnly={inStockOnly}
            >
              <FilterPanel
                q={q}
                category={category}
                supplier={supplier}
                sort={sort}
                inStockOnly={inStockOnly}
                cols={cols}
                departments={departments}
                categoryCounts={meta.categoryCounts}
                activeFilter={activeFilter}
                priceRange={result.priceRange}
              />
            </StorefrontMobileControls>
          </Suspense>

          <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-[0_8px_20px_rgba(32,25,15,0.04)] sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-900">
                {q ? `Søkeresultat for "${q}"` : activeFilter ? activeFilter.label : supplier || "Alle produkter"}
              </p>
              <p className="text-sm text-stone-500">
                {filteredTotal.toLocaleString("nb-NO")} produkter
              </p>
            </div>

            <div className="hidden lg:block">
              <Suspense><StorefrontViewControls initialSort={sort} initialCols={cols} initialInStockOnly={inStockOnly} /></Suspense>
            </div>
          </div>

          {hasFilters ? (
            <ActiveFilterChips q={q} category={category} categoryLabel={activeFilter?.label ?? category} supplier={supplier} sort={sort} inStockOnly={inStockOnly} cols={cols} />
          ) : null}

          {displayItems.length === 0 ? (
            <EmptyState q={q} />
          ) : inStockOnly ? (
            <div className={getGridClasses(cols)}>
              {displayItems.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  stockInfo={product.ean ? stockByEan.get(product.ean) ?? UNKNOWN_PRODUCT_STOCK : UNKNOWN_PRODUCT_STOCK}
                />
              ))}
            </div>
          ) : (
            <Suspense
              fallback={
                <div className={getGridClasses(cols)}>
                  {displayItems.map((product) => (
                    <ProductCard key={product.id} product={product} stockInfo={UNKNOWN_PRODUCT_STOCK} />
                  ))}
                </div>
              }
            >
              <StockedProductGrid items={displayItems} shouldPrioritize={shouldPrioritizeNetStock} cols={cols} />
            </Suspense>
          )}

          {filteredTotalPages > 1 ? (
            <Pagination
              q={q}
              category={category}
              supplier={supplier}
              sort={sort}
              inStockOnly={inStockOnly}
              cols={cols}
              page={filteredPage}
              totalPages={filteredTotalPages}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

const POPULAR_CATEGORY_LIMIT = 6;

function CategoryTiles({
  departments,
}: {
  departments: Array<{ slug: string; label: string; icon: string; count: number }>;
}) {
  const popular = departments.slice(0, POPULAR_CATEGORY_LIMIT);

  return (
    <section id="kategorier">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#15452d]">Kategorier</p>
          <h2 className="mt-1 text-lg font-semibold text-stone-900 sm:text-xl">Populære kategorier</h2>
        </div>
        <Link href="/?sort=relevance" className="hidden text-sm font-semibold text-[#15452d] hover:underline sm:inline">
          Alle varer →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {popular.map((department) => (
          <CategoryTile key={department.slug} department={department} />
        ))}
      </div>
    </section>
  );
}

function CategoryTile({
  department,
}: {
  department: { slug: string; label: string; icon: string; count: number };
}) {
  return (
    <Link
      href={`/?category=${encodeURIComponent(department.slug)}`}
      className="group flex items-center gap-3 overflow-hidden rounded-md border border-stone-200 bg-white p-3 shadow-[0_3px_12px_rgba(32,25,15,0.03)] transition hover:border-[#15452d] hover:shadow-[0_8px_18px_rgba(21,69,45,0.08)] sm:flex-col sm:items-start sm:gap-2 sm:p-3.5"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#15452d]/8 text-[#15452d] transition group-hover:bg-[#15452d]/12">
        <DepartmentGlyph slug={department.slug} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight text-stone-950 group-hover:text-[#15452d]">{department.label}</span>
        <span className="mt-0.5 block text-xs font-medium text-stone-500">{department.count} varer</span>
      </span>
    </Link>
  );
}

/** Compact inline icon per department (no icon-library dependency). */
function DepartmentGlyph({ slug }: { slug: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-5 w-5",
    "aria-hidden": true,
  };
  switch (slug) {
    case "festemidler-og-beslag": // screw
      return (<svg {...common}><path d="M9 3l6 6" /><path d="M12 6l-7 7a3 3 0 104 4l7-7" /><path d="M8 11l2 2M10 9l2 2" /></svg>);
    case "verktoy-og-maskiner": // wrench
      return (<svg {...common}><path d="M15 4a4 4 0 00-5 5l-6 6 3 3 6-6a4 4 0 005-5l-2.5 2.5L13 7.5 15 5z" /></svg>);
    case "maling-og-overflate": // paint roller
      return (<svg {...common}><rect x="4" y="4" width="13" height="6" rx="1" /><path d="M17 7h2a1 1 0 011 1v2a1 1 0 01-1 1h-7a1 1 0 00-1 1v2" /><rect x="9" y="15" width="4" height="6" rx="1" /></svg>);
    case "lim-fuge-og-tetting": // droplet
      return (<svg {...common}><path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z" /></svg>);
    case "tak-og-takrenner": // roof
      return (<svg {...common}><path d="M3 11l9-7 9 7" /><path d="M5 10v9h14v-9" /><path d="M3 19h18" /></svg>);
    case "trelast-og-byggevarer": // stacked planks
      return (<svg {...common}><rect x="3" y="6" width="18" height="4" rx="1" /><rect x="3" y="14" width="18" height="4" rx="1" /><path d="M7 6v4M15 14v4" /></svg>);
    case "gulv-og-listverk": // floor grid
      return (<svg {...common}><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></svg>);
    case "mur-og-betong": // brick wall
      return (<svg {...common}><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 10h18M3 16h18M9 4v6M15 10v6M9 16v4M15 4v0" /></svg>);
    case "kjokken-og-bad": // faucet
      return (<svg {...common}><path d="M5 12h6V8a3 3 0 016 0" /><path d="M3 12h10v2a5 5 0 01-10 0z" /><path d="M8 19v2" /></svg>);
    case "dor-og-vindu": // door
      return (<svg {...common}><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M15 12h.01" /><path d="M5 21h14" /></svg>);
    case "sikkerhet-og-forbruk": // shield
      return (<svg {...common}><path d="M12 3l7 3v6c0 4-3 7-7 8-4-1-7-4-7-8V6z" /><path d="M9 12l2 2 4-4" /></svg>);
    default:
      return (<svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></svg>);
  }
}

function ValuePropsBand() {
  const props = [
    {
      title: "Gratis frakt over 5 000 kr",
      body: "Gratis levert over 5 000 kr.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
          <circle cx="7" cy="18" r="1.5" />
          <circle cx="18" cy="18" r="1.5" />
        </svg>
      ),
    },
    {
      title: "Partnerforhandlet pris",
      body: "Lavere pris via partneravtale.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <path d="M7 17L17 7" strokeLinecap="round" />
          <circle cx="8" cy="8" r="2" />
          <circle cx="16" cy="16" r="2" />
        </svg>
      ),
    },
    {
      title: "Samme byggevarehus",
      body: "Samme kanal hele veien.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <path d="M12 3l8 4v6c0 5-3.5 7.5-8 8-4.5-0.5-8-3-8-8V7z" />
          <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      title: "Rask levering",
      body: "Til byggeplass på 24-48 timer.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
          <circle cx="7" cy="18" r="1.5" />
          <circle cx="18" cy="18" r="1.5" />
        </svg>
      ),
    },
    {
      title: "KI til innkjøp",
      body: "Fra materialliste til bestilling.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18" />
        </svg>
      ),
    },
  ];
  return (
    <section className="grid gap-0 border border-stone-200 bg-white sm:grid-cols-2 lg:grid-cols-5">
      {props.map((prop) => (
        <div key={prop.title} className="flex items-start gap-3 border-b border-stone-200 p-3 last:border-b-0 sm:border-r lg:border-b-0 lg:last:border-r-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#15452d]/10 text-[#15452d]">
            {prop.icon}
          </span>
          <div>
            <p className="text-sm font-semibold text-stone-900">{prop.title}</p>
            <p className="mt-0.5 text-xs leading-5 text-stone-600">{prop.body}</p>
          </div>
        </div>
      ))}
    </section>
  );
}

function DealsStrip({ deals, stockByEan }: { deals: StorefrontProduct[]; stockByEan: Map<string, ProductStockInfo> }) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-900 sm:text-xl">
            <span className="inline-flex h-6 items-center rounded bg-[#15452d] px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
              Populære
            </span>
            Mest populære byggevarer
          </h2>
          <p className="hidden text-sm text-stone-500 sm:block">De byggevarene privatpersoner kjøper mest – til partnerpris.</p>
        </div>
        <Link href="/?sort=price_asc" className="text-sm font-semibold text-[#15452d] hover:underline">
          Se alle varer →
        </Link>
      </div>
      <div className="-mx-3 flex gap-3 overflow-x-auto scroll-smooth px-3 scrollbar-none sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {deals.map((product) => {
          const hasDiscount = product.listPriceNok > product.unitPriceNok;
          const discountPct = hasDiscount
            ? Math.round(((product.listPriceNok - product.unitPriceNok) / product.listPriceNok) * 100)
            : 0;
          return (
            <article
              key={product.id}
              className="group relative flex w-48 shrink-0 flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-[0_6px_16px_rgba(32,25,15,0.05)] transition hover:-translate-y-0.5 hover:border-[#15452d] sm:w-56"
            >
              {hasDiscount ? (
                <span className="absolute left-2 top-2 z-10 inline-flex items-center rounded bg-[#c03a2b] px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                  -{discountPct}%
                </span>
              ) : (
                <span className="absolute left-2 top-2 z-10 inline-flex items-center rounded bg-[#15452d] px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                  Populær
                </span>
              )}
              <div className="absolute right-2 top-2 z-10">
                <AddToMaterialListButton {...buildMaterialListProduct(product)} compact />
              </div>
              <Link href={`/${product.slug}`} className="block">
                <div className="flex h-32 items-center justify-center p-3">
                  <StorefrontProductImage
                    src={getStorefrontImageUrl(product)}
                    alt={product.productName}
                    className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.04]"
                  />
                </div>
              </Link>
              <div className="flex flex-1 flex-col space-y-2 border-t border-stone-100 px-3 py-2.5">
                <Link href={`/${product.slug}`} className="line-clamp-2 text-[13px] font-semibold leading-4 text-stone-900 hover:text-[#15452d]">
                  {product.productName}
                </Link>
                <div className="flex items-end gap-1.5">
                  <p className={`text-sm font-semibold ${hasDiscount ? "text-[#c03a2b]" : "text-stone-900"}`}>{formatCurrency(product.unitPriceNok)}</p>
                  {hasDiscount ? <p className="pb-0.5 text-[11px] text-stone-400 line-through">{formatCurrency(product.listPriceNok)}</p> : null}
                </div>
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-stone-500">
                  <StockChip stock={product.ean ? stockByEan.get(product.ean) ?? UNKNOWN_PRODUCT_STOCK : UNKNOWN_PRODUCT_STOCK} />
                  <span className="truncate">per {formatUnitLabel(product.salesUnit ?? product.unit)}</span>
                </div>
                <div className="mt-auto pt-1">
                  <AddToCartWithQuantity productId={product.id} compact />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProductCard({ product, stockInfo }: { product: StorefrontProduct; stockInfo: ProductStockInfo }) {
  const hasDiscount = product.listPriceNok > product.unitPriceNok;
  const discountPct = hasDiscount
    ? Math.round(((product.listPriceNok - product.unitPriceNok) / product.listPriceNok) * 100)
    : 0;
  const priceUnitLabel = formatUnitLabel(product.priceUnit ?? product.unit);
  const salesUnitLabel = formatUnitLabel(product.salesUnit ?? product.unit);
  const pricePerPriceUnitNok = product.packageAreaSqm ? product.unitPriceNok / product.packageAreaSqm : 0;

  return (
    <article className="group relative flex min-w-0 flex-col overflow-hidden rounded-md border border-stone-200 bg-white shadow-[0_3px_12px_rgba(32,25,15,0.03)] transition hover:border-[#15452d] hover:shadow-[0_8px_18px_rgba(21,69,45,0.08)]">
      {hasDiscount ? (
        <span className="absolute left-3 top-3 z-10 inline-flex items-center rounded bg-[#c03a2b] px-2 py-0.5 text-[11px] font-semibold text-white shadow">
          -{discountPct}%
        </span>
      ) : null}
      <div className="absolute right-3 top-3 z-10">
        <AddToMaterialListButton {...buildMaterialListProduct(product)} compact />
      </div>

      <Link href={`/${product.slug}`} className="block">
        <div className="flex aspect-[1.08] items-center justify-center bg-white p-3 sm:p-4">
          <StorefrontProductImage
            src={getStorefrontImageUrl(product)}
            alt={product.productName}
            className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.02]"
          />
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-2 border-t border-stone-100 p-2.5 sm:p-3.5">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">
          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-700">{product.category}</span>
          {product.brand ? <span className="text-stone-400">{product.brand}</span> : null}
        </div>

        <Link
          href={`/${product.slug}`}
          className="line-clamp-2 text-sm font-semibold leading-5 text-stone-900 hover:text-[#15452d]"
        >
          {product.productName}
        </Link>

        <div className="mt-auto space-y-2 pt-1">
          <div className="flex items-end gap-2">
            <p className={`text-lg font-semibold sm:text-xl ${hasDiscount ? "text-[#c03a2b]" : "text-stone-900"}`}>
              {formatCurrency(product.unitPriceNok)}
            </p>
            {hasDiscount ? (
              <p className="pb-1 text-xs text-stone-500 line-through">{formatCurrency(product.listPriceNok)}</p>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-stone-500">
            <StockChip stock={stockInfo} />
            <span className="truncate">per {salesUnitLabel}</span>
          </div>
          {product.packageAreaSqm ? (
            <p className="truncate text-[11px] font-medium text-stone-500">
              1 {salesUnitLabel} = {formatDecimalNo(product.packageAreaSqm)} m² · {formatCurrency(pricePerPriceUnitNok)} per {priceUnitLabel}
            </p>
          ) : null}

          <AddToCartWithQuantity productId={product.id} compact />
        </div>
      </div>
    </article>
  );
}

function buildMaterialListProduct(product: StorefrontProduct) {
  const salesUnitLabel = formatUnitLabel(product.salesUnit ?? product.unit);

  return {
    source: "catalog" as const,
    productName: product.productName,
    quantity: `1 ${salesUnitLabel}`,
    comment: "Lagt til fra nettbutikken.",
    quantityReason: "Valgt manuelt fra Prisbygg nettbutikk.",
    nobbNumber: product.nobbNumber,
    supplierName: product.supplierName,
    unitPriceNok: product.unitPriceNok,
    productUrl: `/${product.slug}`,
    imageUrl: getStorefrontImageUrl(product),
    sectionTitle: product.sectionTitle,
    category: product.category,
  };
}

function mapProductForProfile(product: StorefrontProduct) {
  return {
    nobbNumber: product.nobbNumber,
    productName: product.productName,
    category: product.category,
    sectionTitle: product.sectionTitle,
    supplierName: product.supplierName,
    brand: product.brand,
  };
}

function StockChip({ stock }: { stock: ProductStockInfo }) {
  if (stock.status === "in-stock") {
    return (
      <span className="inline-flex min-w-0 shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200" title={stock.detail ?? stock.label}>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span className="max-w-[150px] truncate">{stock.label}</span>
      </span>
    );
  }
  if (stock.status === "backorder") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold text-stone-600 ring-1 ring-stone-200" title={stock.detail ?? stock.label}>
        <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
        {stock.label}
      </span>
    );
  }
  if (stock.status === "store-stock") {
    return (
      <span className="inline-flex min-w-0 shrink-0 items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200" title={stock.detail ?? stock.label}>
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        <span className="max-w-[150px] truncate">{stock.label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-stone-500">
      <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
      {stock.label}
    </span>
  );
}

function EmptyState({ q }: { q: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center shadow-[0_6px_16px_rgba(32,25,15,0.04)]">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-stone-100 text-stone-400">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8">
          <circle cx="10" cy="10" r="7" />
          <path d="M16 16l5 5" strokeLinecap="round" />
        </svg>
      </div>
      <p className="mt-4 text-base font-semibold text-stone-900">Ingen treff {q ? `for "${q}"` : ""}</p>
      <p className="mt-1 max-w-md text-sm text-stone-500">
        Prøv et annet søkeord, fjern et filter eller bla gjennom kategoriene på forsiden.
      </p>
      <Link href="/" className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#15452d] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0f321f]">
        Nullstill og vis alle
      </Link>
    </div>
  );
}

function ActiveFilterChips({
  q,
  category,
  categoryLabel,
  supplier,
  sort,
  inStockOnly,
  cols,
}: {
  q: string;
  category: string;
  categoryLabel: string;
  supplier: string;
  sort: StorefrontSortOption;
  inStockOnly: boolean;
  cols: number;
}) {
  const chips: Array<{ label: string; href: string }> = [];
  if (q) chips.push({ label: `Søk: ${q}`, href: buildStoreHref({ category, supplier, sort, inStock: inStockOnly ? 1 : undefined, cols }) });
  if (category) chips.push({ label: `Kategori: ${categoryLabel}`, href: buildStoreHref({ q, supplier, sort, inStock: inStockOnly ? 1 : undefined, cols }) });
  if (supplier) chips.push({ label: `Leverandør: ${supplier}`, href: buildStoreHref({ q, category, sort, inStock: inStockOnly ? 1 : undefined, cols }) });
  if (inStockOnly) chips.push({ label: "På lager", href: buildStoreHref({ q, category, supplier, sort, cols }) });

  return (
    <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:rounded-xl sm:border sm:border-stone-200 sm:bg-white sm:px-3 sm:py-2 sm:shadow-[0_6px_16px_rgba(32,25,15,0.04)]">
      <span className="hidden text-xs font-semibold uppercase tracking-[0.14em] text-stone-500 sm:inline">Aktive filtre</span>
      {chips.map((chip) => (
        <Link
          key={chip.label}
          href={chip.href}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-[0_2px_8px_rgba(32,25,15,0.04)] transition hover:border-[#c03a2b] hover:text-[#c03a2b] sm:bg-stone-50 sm:py-1 sm:shadow-none"
        >
          {chip.label}
          <span aria-hidden>×</span>
        </Link>
      ))}
      <Link
        href={buildStoreHref({ sort, cols })}
        className="shrink-0 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#15452d] shadow-[0_2px_8px_rgba(32,25,15,0.04)] hover:border-[#15452d] sm:ml-auto sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none sm:hover:underline"
      >
        Nullstill alle
      </Link>
    </div>
  );
}

function FilterPanel({
  q,
  category,
  supplier,
  sort,
  inStockOnly,
  cols,
  departments,
  categoryCounts,
  activeFilter,
  priceRange,
}: {
  q: string;
  category: string;
  supplier: string;
  sort: StorefrontSortOption;
  inStockOnly: boolean;
  cols: number;
  departments: Array<{ slug: string; label: string; icon: string; count: number; categories: string[] }>;
  categoryCounts: Record<string, number>;
  activeFilter: StorefrontCategoryFilter | null;
  priceRange: { min: number; max: number };
}) {
  const totalCount = departments.reduce((sum, department) => sum + department.count, 0);
  const activeSlug = activeFilter?.department.slug ?? null;
  const activeLeaf = activeFilter?.leaf ?? null;

  return (
    <div className="bg-white lg:rounded-xl lg:border lg:border-stone-200 lg:p-4 lg:shadow-[0_8px_20px_rgba(32,25,15,0.06)]">
      <div className="flex items-center justify-end lg:justify-between">
        <p className="hidden text-sm font-semibold text-stone-900 lg:block">Filtrer varer</p>
        {q || category || supplier || inStockOnly ? (
          <Link href={buildStoreHref({ sort, cols })} className="text-xs font-semibold text-[#15452d] hover:underline">
            Nullstill
          </Link>
        ) : null}
      </div>

      <div className="mt-4 space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Kategori</p>
          <div className="mt-2 flex flex-col gap-0.5">
            <Link
              href={buildStoreHref({ q, supplier, sort, inStock: inStockOnly ? 1 : undefined, cols })}
              className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                activeFilter === null ? "bg-[#15452d] text-white!" : "text-stone-700 hover:bg-stone-100"
              }`}
            >
              <span>Alle varer</span>
              <span className={`text-xs ${activeFilter === null ? "text-white/70" : "text-stone-400"}`}>{totalCount}</span>
            </Link>

            {departments.map((department) => {
              const departmentActive = activeSlug === department.slug;
              const leaves = departmentActive ? leafCategoriesForDepartment(department, categoryCounts) : [];
              return (
                <div key={department.slug}>
                  <Link
                    href={buildStoreHref({ q, category: department.slug, supplier, sort, inStock: inStockOnly ? 1 : undefined, cols })}
                    className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                      departmentActive && !activeLeaf
                        ? "bg-[#15452d] text-white!"
                        : departmentActive
                          ? "bg-[#15452d]/8 text-stone-900"
                          : "text-stone-700 hover:bg-stone-100"
                    }`}
                  >
                    <span className="line-clamp-1">{department.label}</span>
                    <span className={`shrink-0 text-xs ${departmentActive && !activeLeaf ? "text-white/70" : "text-stone-400"}`}>
                      {department.count}
                    </span>
                  </Link>
                  {leaves.length > 1 ? (
                    <div className="mb-1 ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-stone-200 pl-2">
                      {leaves.map((leaf) => {
                        const leafActive = activeLeaf === leaf.category;
                        return (
                          <Link
                            key={leaf.category}
                            href={buildStoreHref({ q, category: leaf.category, supplier, sort, inStock: inStockOnly ? 1 : undefined, cols })}
                            className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-1 text-[13px] transition ${
                              leafActive ? "bg-[#15452d] font-semibold text-white!" : "text-stone-600 hover:bg-stone-100"
                            }`}
                          >
                            <span className="line-clamp-1">{leaf.category}</span>
                            <span className={`shrink-0 text-[11px] ${leafActive ? "text-white/70" : "text-stone-400"}`}>{leaf.count}</span>
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Prisnivå</p>
          <div className="mt-2 flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-medium text-stone-700">
            <span>{formatCurrency(priceRange.min)}</span>
            <span className="mx-2 h-px flex-1 bg-stone-300" />
            <span>{formatCurrency(priceRange.max)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              { label: "Under 500 kr", sort: "price_asc" as const },
              { label: "Lav til høy", sort: "price_asc" as const },
              { label: "Høy til lav", sort: "price_desc" as const },
            ].map((preset) => (
              <Link
                key={preset.label}
                href={buildStoreHref({ q, category, supplier, sort: preset.sort, inStock: inStockOnly ? 1 : undefined, cols })}
                className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-700 transition hover:border-[#15452d] hover:text-[#15452d]"
              >
                {preset.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrustCard() {
  const items = [
    {
      title: "Gratis frakt over 5 000 kr",
      body: "Gratis levert over 5 000 kr.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
          <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
          <circle cx="7" cy="18" r="1.5" />
          <circle cx="18" cy="18" r="1.5" />
        </svg>
      ),
    },
    {
      title: "Rask levering",
      body: "Til byggeplass på 24-48 timer.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
          <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
          <circle cx="7" cy="18" r="1.5" />
          <circle cx="18" cy="18" r="1.5" />
        </svg>
      ),
    },
    {
      title: "Partnerpris",
      body: "Ferdigforhandlet prisgrunnlag fra én innkjøpspartner, videreført til prosjektet ditt.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
          <path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-0.5z" />
        </svg>
      ),
    },
    {
      title: "Alltid oppdatert",
      body: "Priser fra vektorlager, produktdata fra NOBB.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
          <path d="M4 12a8 8 0 0114-5" />
          <path d="M20 4v4h-4" />
          <path d="M20 12a8 8 0 01-14 5" />
          <path d="M4 20v-4h4" />
        </svg>
      ),
    },
  ];
  return (
    <div className="rounded-xl border border-stone-200 bg-gradient-to-br from-[#15452d] to-[#0f321f] p-4 text-white shadow-[0_8px_20px_rgba(18,36,25,0.18)]">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#d9ff7a]">Derfor Prisbygg</p>
      <ul className="mt-3 space-y-3">
        {items.map((item) => (
          <li key={item.title} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/10 text-[#d9ff7a]">
              {item.icon}
            </span>
            <div>
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="mt-0.5 text-xs leading-4 text-emerald-50/80">{item.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pagination({
  q,
  category,
  supplier,
  sort,
  inStockOnly,
  cols,
  page,
  totalPages,
}: {
  q: string;
  category: string;
  supplier: string;
  sort: StorefrontSortOption;
  inStockOnly: boolean;
  cols: number;
  page: number;
  totalPages: number;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-[0_8px_20px_rgba(32,25,15,0.06)] sm:flex-row sm:items-center sm:justify-between">
      {page > 1 ? (
        <Link
          href={buildStoreHref({ q, category, supplier, sort, inStock: inStockOnly ? 1 : undefined, page: page - 1, cols })}
          className="inline-flex h-9 items-center justify-center rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-700 transition hover:border-[#15452d] hover:text-[#15452d]"
        >
          ← Forrige
        </Link>
      ) : (
        <span className="inline-flex h-9 items-center justify-center rounded-md border border-stone-200 bg-stone-50 px-4 text-sm font-semibold text-stone-400">
          ← Forrige
        </span>
      )}

      <p className="text-center text-sm text-stone-500">
        Side <span className="font-semibold text-stone-900">{page}</span> av {totalPages}
      </p>

      {page < totalPages ? (
        <Link
          href={buildStoreHref({ q, category, supplier, sort, inStock: inStockOnly ? 1 : undefined, page: page + 1, cols })}
          className="inline-flex h-9 items-center justify-center rounded-md bg-[#15452d] px-4 text-sm font-semibold text-white! transition hover:bg-[#0f321f]"
        >
          Neste →
        </Link>
      ) : (
        <span className="inline-flex h-9 items-center justify-center rounded-md bg-stone-200 px-4 text-sm font-semibold text-stone-500">
          Neste →
        </span>
      )}
    </div>
  );
}

function buildProductStockInfo(info: ByggmakkerAvailability): ProductStockInfo {
  if (info.netAvailable) {
    const netQuantity = typeof info.netQuantity === "number" ? formatStockQuantity(info.netQuantity) : "på lager";
    return {
      status: "in-stock",
      label: `Nettlager: ${netQuantity}`,
    };
  }

  if (info.storeAvailable) {
    const storeLabel = `${info.storeCount} butikk${info.storeCount === 1 ? "" : "er"}`;
    const topStores = info.stores.slice(0, 4).map((store) => `${store.name}: ${formatStockQuantity(store.quantity)}`).join(" · ");

    return {
      status: "store-stock",
      label: `På lager i ${storeLabel}`,
      detail: topStores || undefined,
    };
  }

  return {
    status: "backorder",
    label: "Skaffes på forespørsel",
  };
}

function isProductInStock(stock: ProductStockInfo | undefined) {
  return stock?.status === "in-stock";
}

function prioritizeNetStock(products: StorefrontProduct[], stockByEan: Map<string, ProductStockInfo>) {
  return products
    .map((product, index) => ({ product, index }))
    .sort((left, right) => {
      const leftRank = netStockRank(left.product, stockByEan);
      const rightRank = netStockRank(right.product, stockByEan);

      return leftRank - rightRank || left.index - right.index;
    })
    .map(({ product }) => product);
}

function netStockRank(product: StorefrontProduct, stockByEan: Map<string, ProductStockInfo>) {
  const stock = product.ean ? stockByEan.get(product.ean) : undefined;

  if (stock?.status === "in-stock") {
    return 0;
  }

  if (stock?.status === "store-stock") {
    return 1;
  }

  if (!stock || stock.status === "unknown") {
    return 2;
  }

  return 3;
}

function formatUnitLabel(unit: string) {
  const normalized = unit.trim().toUpperCase();

  if (normalized === "M2") return "m²";
  if (normalized === "PAK") return "pakke";
  if (normalized === "STK") return "stk";
  if (normalized === "LM") return "lm";

  return normalized.toLowerCase();
}

function formatDecimalNo(value: number) {
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(value);
}

function formatStockQuantity(quantity: number) {
  if (!Number.isFinite(quantity)) return "0";
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(Math.max(0, Math.round(quantity)));
}

function normalizeSortOption(value: string): StorefrontSortOption {
  switch (value) {
    case "price_asc":
    case "price_desc":
    case "name_asc":
    case "newest":
      return value;
    default:
      return "relevance";
  }
}

function normalizeGridColumns(value: string) {
  if (value === "5") {
    return 5;
  }

  if (value === "6") {
    return 6;
  }

  return 4;
}

function getGridClasses(cols: number) {
  switch (cols) {
    case 5:
      return "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
    case 6:
      return "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6";
    default:
      return "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4";
  }
}

function buildStoreHref(params: Record<string, string | number | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }

    const normalized = String(value).trim();

    if (normalized.length > 0) {
      searchParams.set(key, normalized);
    }
  }

  const query = searchParams.toString();
  return query ? `/?${query}` : "/";
}

async function StockedDealsStrip({ deals }: { deals: StorefrontProduct[] }) {
  const eans = new Set(deals.map((p) => p.ean).filter((e): e is string => Boolean(e)));
  const stockByEan = new Map<string, ProductStockInfo>();
  if (eans.size > 0) {
    const availabilityMap = await getByggmakkerAvailabilityBatch(eans);
    for (const [ean, info] of availabilityMap) {
      stockByEan.set(ean, buildProductStockInfo(info));
    }
  }
  return <DealsStrip deals={deals} stockByEan={stockByEan} />;
}

async function StockedProductGrid({
  items,
  shouldPrioritize,
  cols,
}: {
  items: StorefrontProduct[];
  shouldPrioritize: boolean;
  cols: number;
}) {
  const eans = new Set(items.map((p) => p.ean).filter((e): e is string => Boolean(e)));
  const stockByEan = new Map<string, ProductStockInfo>();
  if (eans.size > 0) {
    const availabilityMap = await getByggmakkerAvailabilityBatch(eans);
    for (const [ean, info] of availabilityMap) {
      stockByEan.set(ean, buildProductStockInfo(info));
    }
  }
  const displayItems = shouldPrioritize ? prioritizeNetStock(items, stockByEan) : items;
  return (
    <div className={getGridClasses(cols)}>
      {displayItems.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          stockInfo={product.ean ? stockByEan.get(product.ean) ?? UNKNOWN_PRODUCT_STOCK : UNKNOWN_PRODUCT_STOCK}
        />
      ))}
    </div>
  );
}
