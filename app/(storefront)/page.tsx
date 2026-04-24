import Link from "next/link";
import { Suspense } from "react";

import { AddToCartButton } from "@/app/_components/storefront/add-to-cart-button";
import { StorefrontProductImage } from "@/app/_components/storefront/storefront-product-image";
import { StorefrontViewControls } from "@/app/_components/storefront/storefront-view-controls";
import { getByggmakkerAvailabilityBatch } from "@/lib/byggmakker-availability";
import {
  getStorefrontImageUrl,
  getStorefrontProducts,
  getStorefrontProductsByNobb,
  queryStorefrontProducts,
} from "@/lib/storefront";
import type { StorefrontProduct, StorefrontSortOption } from "@/lib/storefront-types";
import { formatCurrency } from "@/lib/utils";

type StockStatus = "in-stock" | "stores" | "backorder" | "unknown";

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
  const q = typeof resolvedSearchParams.q === "string" ? resolvedSearchParams.q : "";
  const category = typeof resolvedSearchParams.category === "string" ? resolvedSearchParams.category : "";
  const supplier = typeof resolvedSearchParams.supplier === "string" ? resolvedSearchParams.supplier : "";
  const sort = normalizeSortOption(typeof resolvedSearchParams.sort === "string" ? resolvedSearchParams.sort : "");
  const page = typeof resolvedSearchParams.page === "string" ? Number.parseInt(resolvedSearchParams.page, 10) : 1;
  const cols = normalizeGridColumns(typeof resolvedSearchParams.cols === "string" ? resolvedSearchParams.cols : "");

  const result = await queryStorefrontProducts({
    q,
    category,
    supplier,
    sort,
    page: Number.isFinite(page) ? page : 1,
  });

  const hasFilters = Boolean(q || category || supplier);
  const showLanding = !hasFilters && result.page === 1;
  const { products: allProducts } = showLanding
    ? await getStorefrontProducts()
    : { products: [] as StorefrontProduct[] };
  const featuredDeals = showLanding ? await getStorefrontProductsByNobb(MOST_POPULAR_NOBB) : [];
  const featuredCategories = showLanding
    ? resolveFeaturedCategories(result.categories, allProducts)
    : [];
  const heroHighlights = showLanding ? pickHeroHighlights(featuredDeals, allProducts) : [];

  // Batch-resolve real stock status for all visible products using the
  // Byggmakker availability API with EANs sourced directly from the price list.
  const visibleEans = new Set<string>();
  for (const product of result.items) {
    if (product.ean) visibleEans.add(product.ean);
  }
  for (const product of featuredDeals) {
    if (product.ean) visibleEans.add(product.ean);
  }
  const availabilityMap = visibleEans.size
    ? await getByggmakkerAvailabilityBatch(visibleEans)
    : new Map();
  const stockByEan = new Map<string, StockStatus>();
  for (const [ean, info] of availabilityMap) {
    const status: StockStatus = info.netAvailable
      ? "in-stock"
      : info.storeAvailable
        ? "stores"
        : "backorder";
    stockByEan.set(ean, status);
  }

  return (
    <div className="space-y-6">
      {showLanding ? (
        <>
          <HeroSection total={result.total} highlights={heroHighlights} />
          {featuredCategories.length > 0 ? (
            <CategoryTiles tiles={featuredCategories} counts={result.categoryCounts} />
          ) : null}
          {featuredDeals.length > 0 ? <DealsStrip deals={featuredDeals} /> : null}
          <ValuePropsBand />
        </>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-[168px] lg:self-start">
          <FilterPanel
            q={q}
            category={category}
            supplier={supplier}
            sort={sort}
            cols={cols}
            categories={result.categories}
            suppliers={result.suppliers}
            categoryCounts={result.categoryCounts}
            supplierCounts={result.supplierCounts}
            priceRange={result.priceRange}
          />

          <TrustCard />
        </aside>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-[0_8px_20px_rgba(32,25,15,0.05)] sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-900">
                {q ? `Søkeresultat for "${q}"` : category || supplier || "Alle produkter"}
              </p>
              <p className="text-sm text-stone-500">
                {result.total.toLocaleString("nb-NO")} produkter
                {result.source === "vector_store" ? (
                  <span className="ml-2 inline-flex items-center gap-1 rounded bg-[#15452d]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#15452d]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#15452d]" /> AI-katalog
                  </span>
                ) : null}
              </p>
            </div>

            <Suspense><StorefrontViewControls initialSort={sort} initialCols={cols} /></Suspense>
          </div>

          {hasFilters ? (
            <ActiveFilterChips q={q} category={category} supplier={supplier} sort={sort} cols={cols} />
          ) : null}

          {result.items.length === 0 ? (
            <EmptyState q={q} />
          ) : (
            <div className={getGridClasses(cols)}>
              {result.items.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  stockStatus={product.ean ? stockByEan.get(product.ean) ?? "unknown" : "unknown"}
                />
              ))}
            </div>
          )}

          {result.totalPages > 1 ? (
            <Pagination
              q={q}
              category={category}
              supplier={supplier}
              sort={sort}
              cols={cols}
              page={result.page}
              totalPages={result.totalPages}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function HeroSection({ total, highlights }: { total: number; highlights: StorefrontProduct[] }) {
  return (
    <section className="relative overflow-hidden rounded-xl border border-[#0f321f]/20 bg-gradient-to-br from-[#0f321f] via-[#15452d] to-[#1d5a3b] text-white shadow-[0_20px_48px_rgba(18,36,25,0.28)]">
      {/* Decorative pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, #d9ff7a 0, #d9ff7a 1px, transparent 1px, transparent 22px)",
        }}
      />
      <div
        className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(217,255,122,0.3), transparent 60%)" }}
      />
      <div
        className="pointer-events-none absolute -left-20 bottom-0 h-80 w-80 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(196,138,77,0.25), transparent 60%)" }}
      />

      <div className="relative grid gap-6 px-6 py-7 sm:px-10 sm:py-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:gap-10">
        {/* Left copy */}
        <div className="flex flex-col justify-center">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded bg-[#d9ff7a] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[#0f321f]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#0f321f]" /> Partnerpris
            </span>
            <span className="rounded bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-50">
              En innkjøpskanal
            </span>
            <span className="rounded bg-[#d9ff7a]/20 border border-[#d9ff7a]/40 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#d9ff7a]">
              Gratis frakt over 15 000 kr
            </span>
          </div>
          <h1 className="mt-4 text-3xl font-semibold leading-[1.07] sm:text-4xl lg:text-[2.75rem]">
            Byggevarer til <span className="bg-[#d9ff7a] px-2 text-[#0f321f]">proffpris</span>
            <span className="block mt-1 text-emerald-50/90">gjennom Proanbuds partneravtale.</span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-7 text-emerald-50/75">
            Proanbud bruker en ferdigforhandlet partnerprisliste, legger på kontrollert margin og gir deg sluttpris som fortsatt ligger under veiledende pris. {total.toLocaleString("nb-NO")} varer er tilgjengelig akkurat nå.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link
              href="/?sort=price_asc"
              className="inline-flex items-center gap-2 rounded-md bg-[#d9ff7a] px-5 py-2.5 text-sm font-bold text-black! shadow-[0_8px_24px_rgba(217,255,122,0.3)] transition hover:bg-white"
            >
              Se partnerprisene
              <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5"><path d="M3 8h9.59L9 4.41 10.41 3l6 6-6 6L9 13.59 12.59 10H3z" /></svg>
            </Link>
            <Link
              href="#kategorier"
              className="inline-flex items-center gap-2 rounded-md border border-white/25 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Utforsk kategorier
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-50/70">
            <HeroMini label="Prisnivå" value="Under veil." />
            <HeroMini label="Varer" value={total.toLocaleString("nb-NO")} />
            <HeroMini label="Levering" value="24-48t" />
          </div>
        </div>

        {/* Right product collage */}
        <div className="relative hidden lg:block">
          <ProductCollage products={highlights} />
        </div>
      </div>

      {/* Mobile collage (horizontal strip) */}
      <div className="relative mt-2 border-t border-white/10 bg-white/[0.04] px-6 py-4 lg:hidden">
        <MobileHighlightStrip products={highlights} />
      </div>
    </section>
  );
}

function HeroMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-center backdrop-blur">
      <p className="text-lg font-bold normal-case text-white sm:text-xl">{value}</p>
      <p className="mt-0.5 text-[10px] text-emerald-50/70">{label}</p>
    </div>
  );
}

function ProductCollage({ products }: { products: StorefrontProduct[] }) {
  if (products.length === 0) {
    return null;
  }

  const main = products[0];
  const secondary = products[1];
  const tertiary = products[2];
  const quaternary = products[3];
  const mainDiscount = main && main.listPriceNok > main.unitPriceNok
    ? Math.round(((main.listPriceNok - main.unitPriceNok) / main.listPriceNok) * 100)
    : 35;

  return (
    <div className="relative h-[380px]">
      {/* Big main card */}
      {main ? (
        <Link
          href={`/${main.slug}`}
          className="absolute left-6 top-4 h-[260px] w-[240px] rotate-[-4deg] overflow-hidden rounded-xl border border-white/20 bg-white p-4 shadow-[0_20px_48px_rgba(0,0,0,0.32)] transition hover:rotate-[-2deg]"
        >
          <span className="absolute left-3 top-3 z-10 inline-flex items-center rounded-full bg-[#c03a2b] px-2.5 py-1 text-[11px] font-bold text-white shadow">
            -{mainDiscount}%
          </span>
          <StorefrontProductImage
            src={getStorefrontImageUrl(main)}
            alt={main.productName}
            className="h-full w-full object-contain"
          />
        </Link>
      ) : null}
      {/* Top-right small card */}
      {secondary ? (
        <Link
          href={`/${secondary.slug}`}
          className="absolute right-2 top-0 h-[140px] w-[140px] rotate-[5deg] overflow-hidden rounded-xl border border-white/20 bg-white p-2 shadow-[0_16px_40px_rgba(0,0,0,0.28)] transition hover:rotate-[3deg]"
        >
          <StorefrontProductImage
            src={getStorefrontImageUrl(secondary)}
            alt={secondary.productName}
            className="h-full w-full object-contain"
          />
        </Link>
      ) : null}
      {/* Middle-right card */}
      {tertiary ? (
        <Link
          href={`/${tertiary.slug}`}
          className="absolute right-10 top-[130px] h-[130px] w-[160px] rotate-[-2deg] overflow-hidden rounded-xl border border-white/20 bg-white p-2 shadow-[0_16px_40px_rgba(0,0,0,0.28)] transition hover:rotate-0"
        >
          <StorefrontProductImage
            src={getStorefrontImageUrl(tertiary)}
            alt={tertiary.productName}
            className="h-full w-full object-contain"
          />
        </Link>
      ) : null}
      {/* Bottom-right price tag */}
      {quaternary ? (
        <Link
          href={`/${quaternary.slug}`}
          className="absolute bottom-2 right-4 h-[120px] w-[150px] rotate-[6deg] overflow-hidden rounded-xl border border-white/20 bg-white p-2 shadow-[0_16px_40px_rgba(0,0,0,0.28)] transition hover:rotate-[4deg]"
        >
          <StorefrontProductImage
            src={getStorefrontImageUrl(quaternary)}
            alt={quaternary.productName}
            className="h-full w-full object-contain"
          />
        </Link>
      ) : null}
      {/* Floating "save" badge */}
      <div className="absolute bottom-[108px] left-[10px] flex h-20 w-20 rotate-[-8deg] flex-col items-center justify-center rounded-full bg-[#d9ff7a] text-[#0f321f] shadow-[0_12px_28px_rgba(217,255,122,0.3)]">
        <span className="text-[10px] font-bold uppercase tracking-wider">Pris</span>
        <span className="text-lg font-bold">Under veil.</span>
      </div>
    </div>
  );
}

function MobileHighlightStrip({ products }: { products: StorefrontProduct[] }) {
  if (products.length === 0) return null;
  return (
    <div className="flex gap-3 overflow-x-auto scrollbar-none">
      {products.slice(0, 6).map((product) => (
        <Link
          key={product.id}
          href={`/${product.slug}`}
          className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-white/20 bg-white p-1.5"
        >
          <StorefrontProductImage
            src={getStorefrontImageUrl(product)}
            alt={product.productName}
            className="h-full w-full object-contain"
          />
        </Link>
      ))}
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
      <div className="mb-4 flex items-end justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#c03a2b]">Byggevarekategorier</p>
          <h2 className="mt-1 text-xl font-semibold text-stone-900 sm:text-2xl">Handle etter kategori</h2>
        </div>
        <Link href="/?sort=price_asc" className="hidden text-sm font-semibold text-[#15452d] hover:underline sm:inline">
          Alle varer →
        </Link>
      </div>

      <div className="-mx-4 flex gap-3 overflow-x-auto scroll-smooth px-4 scrollbar-none sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {tiles.map((tile, i) => (
          <CategoryTile key={tile.label} tile={tile} count={counts[tile.category] ?? 0} featured={i === 0} priority={i < 2} />
        ))}
      </div>
    </section>
  );
}

function CategoryTile({
  tile,
  count,
  featured = false,
  priority = false,
}: {
  tile: { label: string; category: string; tone: string; imageUrl: string };
  count: number;
  featured?: boolean;
  priority?: boolean;
}) {
  return (
    <Link
      href={`/?category=${encodeURIComponent(tile.category)}`}
      className={`group relative shrink-0 overflow-hidden rounded-xl border border-stone-200 bg-gradient-to-br ${tile.tone} shadow-[0_10px_24px_rgba(32,25,15,0.1)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(21,69,45,0.18)] ${
        featured ? "h-52 w-68 sm:h-56 sm:w-80" : priority ? "h-48 w-60 sm:h-52 sm:w-68" : "h-44 w-56 sm:h-48 sm:w-64"
      }`}
    >
      {/* Background product image */}
      <div className="absolute inset-0 flex items-center justify-end pr-4 opacity-90 mix-blend-luminosity transition group-hover:opacity-100 group-hover:mix-blend-normal">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={tile.imageUrl}
          alt=""
          className="h-36 w-auto object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.25)] transition duration-500 group-hover:scale-[1.05] sm:h-44"
          loading="lazy"
        />
      </div>
      {/* Dark overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-black/15 to-transparent" />

      <div className="relative z-10 flex h-full flex-col justify-between p-4 text-white sm:p-5">
        <div>
          <span className="inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] backdrop-blur">
            {count} varer
          </span>
          <p className={`mt-2 font-semibold leading-tight ${featured ? "text-xl sm:text-2xl" : "text-base sm:text-lg"}`}>
            {tile.label}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
          Handle nå
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 transition group-hover:translate-x-0.5"><path d="M3 8h9.59L9 4.41 10.41 3l6 6-6 6L9 13.59 12.59 10H3z" /></svg>
        </div>
      </div>
    </Link>
  );
}

function ValuePropsBand() {
  const props = [
    {
      title: "Gratis frakt over 15 000 kr",
      body: "Bestil over 15 000 kr og vi sender gratis til din bygge- eller leveringsadresse.",
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
      body: "Pris bygget på partneravtale og kontrollert margin, fortsatt under veil. pris.",
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
      body: "Hele kjøpsreisen går gjennom den samme partnerkanalen fra prisgrunnlag til levering.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <path d="M12 3l8 4v6c0 5-3.5 7.5-8 8-4.5-0.5-8-3-8-8V7z" />
          <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      title: "Rask levering",
      body: "Fra sentrallager rett til byggeplass — 24-48 timer.",
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
      body: "Lag materialliste med KI og gjør den om til bestilling uten ekstra mellomledd.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18" />
        </svg>
      ),
    },
  ];
  return (
    <section className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-[0_10px_24px_rgba(32,25,15,0.05)] sm:grid-cols-2 lg:grid-cols-5">
      {props.map((prop) => (
        <div key={prop.title} className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#15452d]/10 text-[#15452d]">
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

function DealsStrip({ deals }: { deals: StorefrontProduct[] }) {
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
          <p className="text-sm text-stone-500">De byggevarene privatpersoner kjøper mest – til partnerpris.</p>
        </div>
        <Link href="/?sort=price_asc" className="text-sm font-semibold text-[#15452d] hover:underline">
          Se alle varer →
        </Link>
      </div>
      <div className="-mx-4 flex gap-3 overflow-x-auto scroll-smooth px-4 scrollbar-none sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {deals.map((product) => {
          const hasDiscount = product.listPriceNok > product.unitPriceNok;
          const discountPct = hasDiscount
            ? Math.round(((product.listPriceNok - product.unitPriceNok) / product.listPriceNok) * 100)
            : 0;
          return (
            <Link
              key={product.id}
              href={`/${product.slug}`}
              className="group relative w-44 shrink-0 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-[0_8px_20px_rgba(32,25,15,0.06)] transition hover:-translate-y-0.5 hover:border-[#15452d] sm:w-52"
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
              <div className="flex h-32 items-center justify-center p-3">
                <StorefrontProductImage
                  src={getStorefrontImageUrl(product)}
                  alt={product.productName}
                  className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.04]"
                />
              </div>
              <div className="space-y-1 border-t border-stone-100 px-3 py-2.5">
                <p className="line-clamp-2 text-[13px] font-semibold leading-4 text-stone-900">{product.productName}</p>
                <div className="flex items-end gap-1.5">
                  <p className={`text-sm font-semibold ${hasDiscount ? "text-[#c03a2b]" : "text-stone-900"}`}>{formatCurrency(product.unitPriceNok)}</p>
                  {hasDiscount ? <p className="pb-0.5 text-[11px] text-stone-400 line-through">{formatCurrency(product.listPriceNok)}</p> : null}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function ProductCard({ product, stockStatus }: { product: StorefrontProduct; stockStatus: StockStatus }) {
  const hasDiscount = product.listPriceNok > product.unitPriceNok;
  const discountPct = hasDiscount
    ? Math.round(((product.listPriceNok - product.unitPriceNok) / product.listPriceNok) * 100)
    : 0;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-[0_6px_16px_rgba(32,25,15,0.05)] transition hover:-translate-y-0.5 hover:border-[#15452d] hover:shadow-[0_14px_28px_rgba(21,69,45,0.1)]">
      {hasDiscount ? (
        <span className="absolute left-3 top-3 z-10 inline-flex items-center rounded bg-[#c03a2b] px-2 py-0.5 text-[11px] font-semibold text-white shadow">
          -{discountPct}%
        </span>
      ) : null}

      <Link href={`/${product.slug}`} className="block">
        <div className="flex h-44 items-center justify-center bg-gradient-to-b from-white to-stone-50 p-4">
          <StorefrontProductImage
            src={getStorefrontImageUrl(product)}
            alt={product.productName}
            className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.05]"
          />
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-2 border-t border-stone-100 p-3.5">
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
            <p className={`text-xl font-semibold ${hasDiscount ? "text-[#c03a2b]" : "text-stone-900"}`}>
              {formatCurrency(product.unitPriceNok)}
            </p>
            {hasDiscount ? (
              <p className="pb-1 text-xs text-stone-500 line-through">{formatCurrency(product.listPriceNok)}</p>
            ) : null}
          </div>
          <p className="text-[11px] text-stone-500">
            per {product.unit.toLowerCase() || "stk"} · Varenr. {product.nobbNumber}
          </p>

          <div className="flex items-center justify-between gap-2">
            <StockChip status={stockStatus} />
            <AddToCartButton productId={product.id} />
          </div>
        </div>
      </div>
    </article>
  );
}

function StockChip({ status }: { status: StockStatus }) {
  if (status === "in-stock") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        På lager
      </span>
    );
  }
  if (status === "stores") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Utvalgte butikker
      </span>
    );
  }
  if (status === "backorder") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-600 ring-1 ring-stone-200">
        <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
        Ikke på lager
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-stone-500">
      <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
      Sjekk levering
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
  cols,
}: {
  q: string;
  category: string;
  supplier: string;
  sort: StorefrontSortOption;
  cols: number;
}) {
  const chips: Array<{ label: string; href: string }> = [];
  if (q) chips.push({ label: `Søk: ${q}`, href: buildStoreHref({ category, supplier, sort, cols }) });
  if (category) chips.push({ label: `Kategori: ${category}`, href: buildStoreHref({ q, supplier, sort, cols }) });
  if (supplier) chips.push({ label: `Leverandør: ${supplier}`, href: buildStoreHref({ q, category, sort, cols }) });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 shadow-[0_6px_16px_rgba(32,25,15,0.04)]">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Aktive filtre</span>
      {chips.map((chip) => (
        <Link
          key={chip.label}
          href={chip.href}
          className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-700 transition hover:border-[#c03a2b] hover:text-[#c03a2b]"
        >
          {chip.label}
          <span aria-hidden>×</span>
        </Link>
      ))}
      <Link
        href={buildStoreHref({ sort, cols })}
        className="ml-auto text-xs font-semibold text-[#15452d] hover:underline"
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
  cols,
  categories,
  suppliers,
  categoryCounts,
  supplierCounts,
  priceRange,
}: {
  q: string;
  category: string;
  supplier: string;
  sort: StorefrontSortOption;
  cols: number;
  categories: string[];
  suppliers: string[];
  categoryCounts: Record<string, number>;
  supplierCounts: Record<string, number>;
  priceRange: { min: number; max: number };
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-[0_8px_20px_rgba(32,25,15,0.06)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-900">Filtrer varer</p>
        {q || category || supplier ? (
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
          buildHref={(value) => buildStoreHref({ q, category: value, supplier, sort, cols })}
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
                href={buildStoreHref({ q, category, supplier, sort: preset.sort, cols })}
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
      body: "Bestil over 15 000 kr og få gratis levering.",
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
      body: "Fra sentrallager til byggeplass innen 24-48 timer.",
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
  cols,
  page,
  totalPages,
}: {
  q: string;
  category: string;
  supplier: string;
  sort: StorefrontSortOption;
  cols: number;
  page: number;
  totalPages: number;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-[0_8px_20px_rgba(32,25,15,0.06)] sm:flex-row sm:items-center sm:justify-between">
      {page > 1 ? (
        <Link
          href={buildStoreHref({ q, category, supplier, sort, page: page - 1, cols })}
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
          href={buildStoreHref({ q, category, supplier, sort, page: page + 1, cols })}
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

function pickHeroHighlights(
  deals: StorefrontProduct[],
  products: StorefrontProduct[],
): StorefrontProduct[] {
  const withImages = (list: StorefrontProduct[]) =>
    list.filter((p) => Boolean(getStorefrontImageUrl(p)));
  const primary = withImages(deals);
  if (primary.length >= 4) return primary.slice(0, 4);
  const fallback = withImages(products).slice(0, 4 - primary.length);
  return [...primary, ...fallback];
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
      return "grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
    case 6:
      return "grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6";
    default:
      return "grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4";
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
