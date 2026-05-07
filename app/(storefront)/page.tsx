import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";

import { AddToMaterialListButton } from "@/app/_components/storefront/add-to-material-list-button";
import { AddToCartButton } from "@/app/_components/storefront/add-to-cart-button";
import { StorefrontMobileControls } from "@/app/_components/storefront/storefront-mobile-controls";
import { StorefrontProfileTracker } from "@/app/_components/storefront/storefront-profile-tracker";
import { StorefrontProductImage } from "@/app/_components/storefront/storefront-product-image";
import { StorefrontViewControls } from "@/app/_components/storefront/storefront-view-controls";
import { getByggmakkerAvailabilityBatch, type ByggmakkerAvailability } from "@/lib/byggmakker-availability";
import {
  getStorefrontImageUrl,
  getStorefrontProducts,
  getStorefrontProductsByNobb,
  queryStorefrontProducts,
} from "@/lib/storefront";
import { parseStorefrontUserProfileCookie, STOREFRONT_USER_PROFILE_COOKIE } from "@/lib/storefront-user-profile";
import type { StorefrontProduct, StorefrontSortOption } from "@/lib/storefront-types";
import { formatCurrency } from "@/lib/utils";

type StockStatus = "in-stock" | "backorder" | "unknown";
type ProductStockInfo = {
  status: StockStatus;
  label: string;
  detail?: string;
};

const UNKNOWN_PRODUCT_STOCK: ProductStockInfo = {
  status: "unknown",
  label: "Sjekk lager",
};

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

// Curated visual categories shown on the landing hero. Labels og match-arrays
// speiler de ekte kategorinavnene i prislistens Varekategori-felt, som er
// autoritativ kilde. `match` sammenlignes case-insensitivt med substring mot
// de faktiske kategoriene, så korte nøkkelord fanger flere relaterte kategorier
// (f.eks. "verktøy" matcher både Elverktøy og Håndverktøy).
const FEATURED_CATEGORIES: Array<{
  label: string;
  match: string[];
  tone: string;
}> = [
  {
    label: "Konstruksjonsvirke",
    match: ["konstruksjonsvirke", "limtre"],
    tone: "from-[#c48a4d] to-[#8a5c2b]",
  },
  {
    label: "Isolasjon",
    match: ["isolasjon"],
    tone: "from-[#d9b779] to-[#b08a42]",
  },
  {
    label: "Gips og plater",
    match: ["gips og plater"],
    tone: "from-[#7c9474] to-[#3f5c3a]",
  },
  {
    label: "Festemidler",
    match: ["festemidler"],
    tone: "from-[#8796a6] to-[#445566]",
  },
  {
    label: "Maling",
    match: ["maling", "overflatebehandling"],
    tone: "from-[#b15b47] to-[#7a3523]",
  },
  {
    label: "Verktøy",
    match: ["verktøy"],
    tone: "from-[#8a6a3b] to-[#4d3818]",
  },
  {
    label: "Tak",
    match: ["takbeslag", "taktekking"],
    tone: "from-[#5c6b57] to-[#2e3a2a]",
  },
  {
    label: "Kledning",
    match: ["kledning"],
    tone: "from-[#4a7fa7] to-[#234a6c]",
  },
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
  const { products: allProducts } = showLanding
    ? await getStorefrontProducts()
    : { products: [] as StorefrontProduct[] };
  const featuredDeals = showLanding ? await getStorefrontProductsByNobb(MOST_POPULAR_NOBB) : [];
  const featuredCategories = showLanding
    ? resolveFeaturedCategories(result.categories, allProducts)
    : [];

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
  const stockRankingCandidates = shouldPrioritizeNetStock
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
  const stockCandidateItems = stockFilterCandidates?.items ?? stockRankingCandidates?.items ?? [];

  // Batch-resolve real stock status for all products that may be rendered or
  // filtered using EANs sourced directly from the price list.
  const visibleEans = new Set<string>();
  for (const product of result.items) {
    if (product.ean) visibleEans.add(product.ean);
  }
  for (const product of stockCandidateItems) {
    if (product.ean) visibleEans.add(product.ean);
  }
  for (const product of featuredDeals) {
    if (product.ean) visibleEans.add(product.ean);
  }
  const availabilityMap = visibleEans.size
    ? await getByggmakkerAvailabilityBatch(visibleEans)
    : new Map();
  const stockByEan = new Map<string, ProductStockInfo>();
  for (const [ean, info] of availabilityMap) {
    stockByEan.set(ean, buildProductStockInfo(info));
  }
  const stockFilteredItems = inStockOnly
    ? stockCandidateItems.filter((product) => product.ean && isProductInStock(stockByEan.get(product.ean)))
    : shouldPrioritizeNetStock
      ? prioritizeNetStock(stockCandidateItems, stockByEan)
      : result.items;
  const stockAdjustedPaging = inStockOnly || shouldPrioritizeNetStock;
  const filteredTotal = stockAdjustedPaging ? stockFilteredItems.length : result.total;
  const filteredTotalPages = Math.max(1, Math.ceil(filteredTotal / result.pageSize));
  const filteredPage = stockAdjustedPaging ? Math.min(Math.max(1, page), filteredTotalPages) : result.page;
  const displayItems = stockAdjustedPaging
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
          {featuredCategories.length > 0 ? (
            <CategoryTiles tiles={featuredCategories} counts={result.categoryCounts} />
          ) : null}
          {featuredDeals.length > 0 ? <DealsStrip deals={featuredDeals} stockByEan={stockByEan} /> : null}
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
            categories={result.categories}
            categoryCounts={result.categoryCounts}
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
                categories={result.categories}
                categoryCounts={result.categoryCounts}
                priceRange={result.priceRange}
              />
            </StorefrontMobileControls>
          </Suspense>

          <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-[0_8px_20px_rgba(32,25,15,0.04)] sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-900">
                {q ? `Søkeresultat for "${q}"` : category || supplier || "Alle produkter"}
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
            <ActiveFilterChips q={q} category={category} supplier={supplier} sort={sort} inStockOnly={inStockOnly} cols={cols} />
          ) : null}

          {displayItems.length === 0 ? (
            <EmptyState q={q} />
          ) : (
            <div className={getGridClasses(cols)}>
              {displayItems.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  stockInfo={product.ean ? stockByEan.get(product.ean) ?? UNKNOWN_PRODUCT_STOCK : UNKNOWN_PRODUCT_STOCK}
                />
              ))}
            </div>
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

function CategoryTiles({
  tiles,
  counts,
}: {
  tiles: Array<{ label: string; category: string; tone: string; imageUrl: string }>;
  counts: Record<string, number>;
}) {
  return (
    <section id="kategorier">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#15452d]">Kategorier</p>
          <h2 className="mt-1 text-xl font-semibold text-stone-900">Finn riktig varegruppe</h2>
        </div>
        <Link href="/?sort=price_asc" className="hidden text-sm font-semibold text-[#15452d] hover:underline sm:inline">
          Alle varer →
        </Link>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <CategoryTile key={tile.label} tile={tile} count={counts[tile.category] ?? 0} />
        ))}
      </div>
    </section>
  );
}

function CategoryTile({
  tile,
  count,
}: {
  tile: { label: string; category: string; tone: string; imageUrl: string };
  count: number;
}) {
  return (
    <Link
      href={`/?category=${encodeURIComponent(tile.category)}`}
      className="group grid min-h-[126px] grid-cols-[minmax(0,1fr)_112px] overflow-hidden rounded-md border border-stone-200 bg-white shadow-[0_3px_12px_rgba(32,25,15,0.03)] transition hover:border-[#15452d] hover:shadow-[0_8px_18px_rgba(21,69,45,0.08)]"
    >
      <div className="flex flex-col justify-between p-3.5">
        <div>
          <span className="inline-flex items-center rounded-sm bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-600">
            {count} varer
          </span>
          <p className="mt-2 text-base font-semibold leading-tight text-stone-950">
            {tile.label}
          </p>
        </div>
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#15452d]">
          Åpne kategori
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 transition group-hover:translate-x-0.5"><path d="M3 8h9.59L9 4.41 10.41 3l6 6-6 6L9 13.59 12.59 10H3z" /></svg>
        </span>
      </div>
      <div className="flex items-center justify-center border-l border-stone-100 bg-stone-50 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={tile.imageUrl}
          alt=""
          className="h-full max-h-28 w-full object-contain transition duration-300 group-hover:scale-[1.04]"
          loading="lazy"
        />
      </div>
    </Link>
  );
}

function ValuePropsBand() {
  const props = [
    {
      title: "Gratis frakt over 15 000 kr",
      body: "Gratis levert over 15 000 kr.",
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
                <div className="mt-auto grid grid-cols-[minmax(0,1fr)_auto] gap-2 pt-1">
                  <AddToCartButton productId={product.id} fullWidth />
                  <AddToMaterialListButton {...buildMaterialListProduct(product)} compact />
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

          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <AddToCartButton productId={product.id} fullWidth />
            <AddToMaterialListButton {...buildMaterialListProduct(product)} />
          </div>
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
    quantityReason: "Valgt manuelt fra Proanbud nettbutikk.",
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
  supplier,
  sort,
  inStockOnly,
  cols,
}: {
  q: string;
  category: string;
  supplier: string;
  sort: StorefrontSortOption;
  inStockOnly: boolean;
  cols: number;
}) {
  const chips: Array<{ label: string; href: string }> = [];
  if (q) chips.push({ label: `Søk: ${q}`, href: buildStoreHref({ category, supplier, sort, inStock: inStockOnly ? 1 : undefined, cols }) });
  if (category) chips.push({ label: `Kategori: ${category}`, href: buildStoreHref({ q, supplier, sort, inStock: inStockOnly ? 1 : undefined, cols }) });
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
  categories,
  categoryCounts,
  priceRange,
}: {
  q: string;
  category: string;
  supplier: string;
  sort: StorefrontSortOption;
  inStockOnly: boolean;
  cols: number;
  categories: string[];
  categoryCounts: Record<string, number>;
  priceRange: { min: number; max: number };
}) {
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
        <FilterGroup
          title="Kategori"
          items={categories}
          counts={categoryCounts}
          currentValue={category}
          whiteText
          buildHref={(value) => buildStoreHref({ q, category: value, supplier, sort, inStock: inStockOnly ? 1 : undefined, cols })}
        />

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
      title: "Gratis frakt over 15 000 kr",
      body: "Gratis levert over 15 000 kr.",
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
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#d9ff7a]">Derfor ProAnbud</p>
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
          className="inline-flex h-9 items-center justify-center rounded-md bg-[#15452d] px-4 text-sm font-semibold text-white transition hover:bg-[#0f321f]"
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

function resolveFeaturedCategories(
  categories: string[],
  products: StorefrontProduct[],
): Array<{ label: string; category: string; tone: string; imageUrl: string }> {
  const tiles: Array<{ label: string; category: string; tone: string; imageUrl: string }> = [];
  const lowerMap = new Map(categories.map((c) => [c.toLowerCase(), c] as const));

  const pickImageForCategory = (categoryName: string): string => {
    const candidate = products.find(
      (p) => p.category === categoryName && Boolean(getStorefrontImageUrl(p)),
    );
    if (candidate) return getStorefrontImageUrl(candidate);
    const any = products.find((p) => Boolean(getStorefrontImageUrl(p)));
    return any ? getStorefrontImageUrl(any) : "";
  };

  for (const featured of FEATURED_CATEGORIES) {
    let matched: string | undefined;
    for (const needle of featured.match) {
      for (const [lower, original] of lowerMap) {
        if (lower.includes(needle)) {
          matched = original;
          break;
        }
      }
      if (matched) break;
    }
    if (matched) {
      tiles.push({
        label: featured.label,
        category: matched,
        tone: featured.tone,
        imageUrl: pickImageForCategory(matched),
      });
    }
  }

  if (tiles.length < 4) {
    for (const category of categories) {
      if (tiles.some((tile) => tile.category === category)) continue;
      tiles.push({
        label: category,
        category,
        tone: "from-stone-500 to-stone-700",
        imageUrl: pickImageForCategory(category),
      });
      if (tiles.length >= 8) break;
    }
  }

  return tiles.slice(0, 8);
}

function buildProductStockInfo(info: ByggmakkerAvailability): ProductStockInfo {
  if (info.netAvailable) {
    const netQuantity = typeof info.netQuantity === "number" ? formatStockQuantity(info.netQuantity) : "på lager";
    return {
      status: "in-stock",
      label: `Nettlager: ${netQuantity}`,
    };
  }

  return {
    status: "backorder",
    label: "Ikke på nettlager",
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

  if (!stock || stock.status === "unknown") {
    return 1;
  }

  return 2;
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

function FilterGroup({
  title,
  items,
  counts,
  currentValue,
  whiteText = false,
  buildHref,
}: {
  title: string;
  items: string[];
  counts: Record<string, number>;
  currentValue: string;
  whiteText?: boolean;
  buildHref: (value: string) => string;
}) {
  const visibleItems = items.slice(0, 12);
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">{title}</p>
      <div className="mt-2 flex flex-col gap-1">
        <Link
          href={buildHref("")}
          className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            currentValue.length === 0
              ? "bg-[#15452d] text-white!"
              : whiteText
                ? "bg-[#15452d]/90 text-white! hover:bg-[#15452d]"
                : "text-stone-700 hover:bg-stone-100"
          }`}
        >
          <span>Alle</span>
          <span
            className={`text-xs ${
              currentValue.length === 0 ? "text-white/70" : whiteText ? "text-white/70" : "text-stone-400"
            }`}
          >
            {Object.values(counts).reduce((sum, count) => sum + count, 0)}
          </span>
        </Link>
        {visibleItems.map((item) => {
          const active = currentValue === item;
          return (
            <Link
              key={item}
              href={buildHref(item)}
              className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "bg-[#15452d] text-white!"
                  : whiteText
                    ? "text-black hover:bg-[#15452d]/10"
                    : "text-stone-700 hover:bg-stone-100"
              }`}
            >
              <span className="line-clamp-1">{item}</span>
              <span className={`text-xs ${active || whiteText ? "text-white/70" : "text-stone-400"}`}>
                {counts[item] ?? 0}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
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
