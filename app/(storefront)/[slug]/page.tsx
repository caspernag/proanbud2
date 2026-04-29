import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { AddToCartButton } from "@/app/_components/storefront/add-to-cart-button";
import { ProductUnitCalculator } from "@/app/_components/storefront/product-unit-calculator";
import { StorefrontProfileTracker } from "@/app/_components/storefront/storefront-profile-tracker";
import { StorefrontProductImage } from "@/app/_components/storefront/storefront-product-image";
import { getByggmakkerAvailability } from "@/lib/byggmakker-availability";
import { getStorefrontImageUrl, getStorefrontProductBySlug, queryStorefrontProducts } from "@/lib/storefront";
import { parseStorefrontUserProfileCookie, STOREFRONT_USER_PROFILE_COOKIE } from "@/lib/storefront-user-profile";
import { formatCurrency } from "@/lib/utils";

type StorefrontProductPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function StorefrontProductPage({ params }: StorefrontProductPageProps) {
  const { slug } = await params;
  const cookieStore = await cookies();
  const userProfile = parseStorefrontUserProfileCookie(cookieStore.get(STOREFRONT_USER_PROFILE_COOKIE)?.value);
  const product = await getStorefrontProductBySlug(slug);

  if (!product) {
    notFound();
  }

  const isByggmakkerProduct = product.supplierName.toLowerCase().includes("byggmakker");

  const related = await queryStorefrontProducts({
    category: product.category,
    sort: "relevance",
    userProfile,
    pageSize: 4,
  });

  // EAN comes straight from the price list now, no NOBB→EAN resolution needed.
  const byggmakkerAvailability =
    isByggmakkerProduct && product.ean ? await getByggmakkerAvailability(product.ean) : null;

  const hasDiscount = product.listPriceNok > product.unitPriceNok;
  const discountPct = hasDiscount
    ? Math.round(((product.listPriceNok - product.unitPriceNok) / product.listPriceNok) * 100)
    : 0;
  const savingsNok = hasDiscount ? product.listPriceNok - product.unitPriceNok : 0;
  const priceUnitLabel = formatUnitLabel(product.priceUnit ?? product.unit);
  const salesUnitLabel = formatUnitLabel(product.salesUnit ?? product.unit);
  const packagePriceNok = product.packageAreaSqm ? product.unitPriceNok * product.packageAreaSqm : 0;
  const isVerifiedNetAvailable = Boolean(byggmakkerAvailability?.netAvailable);
  const isStoreOnlyAvailable =
    !isVerifiedNetAvailable && Boolean(byggmakkerAvailability?.storeAvailable);

  return (
    <div className="space-y-5">
      <StorefrontProfileTracker product={mapProductForProfile(product)} />
      {/* Breadcrumbs */}
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-stone-500">
        <Link href="/" className="font-medium text-stone-700 hover:text-[#15452d]">
          Partnerpris
        </Link>
        <span className="text-stone-400">›</span>
        <Link
          href={`/?category=${encodeURIComponent(product.category)}`}
          className="font-medium text-stone-700 hover:text-[#15452d]"
        >
          {product.category}
        </Link>
        <span className="text-stone-400">›</span>
        <span className="truncate text-stone-500">{product.productName}</span>
      </nav>

      <section className="grid gap-5 py-3 sm:grid-cols-[minmax(50%,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(50%,1fr)_minmax(0,1fr)] lg:gap-8">
        {/* Image panel */}
        <div className="relative min-w-0 overflow-hidden rounded-md border border-stone-200 bg-white shadow-[0_3px_12px_rgba(32,25,15,0.03)]">
          {hasDiscount ? (
            <div className="absolute left-5 top-5 z-10 flex flex-col gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-sm bg-[#c03a2b] px-3 py-1.5 text-sm font-bold text-white">
                <span className="text-xs font-medium uppercase tracking-wider opacity-80">Spar</span>
                -{discountPct}%
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-sm bg-[#d9ff7a] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#0f321f]">
                Partnerpris
              </span>
            </div>
          ) : null}
          <div className="flex items-start justify-center p-2 sm:p-3">
            <StorefrontProductImage
              src={getStorefrontImageUrl(product)}
              alt={product.productName}
              className="h-auto max-h-[560px] w-full object-contain object-top lg:max-h-[680px]"
            />
          </div>
        </div>

        {/* Info panel */}
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
            <span className="rounded-sm bg-[#15452d]/8 px-2 py-1 text-[#15452d]">{product.category}</span>
            {product.brand ? (
              <span className="rounded-sm bg-stone-100 px-2 py-1 text-stone-600">{product.brand}</span>
            ) : null}
            <span className="rounded-sm bg-stone-100 px-2 py-1 text-stone-600">Art.nr {product.nobbNumber}</span>
          </div>

          <div>
            <h1 className="text-2xl font-semibold leading-tight text-stone-900 sm:text-3xl">{product.productName}</h1>
            <p className="mt-2 text-sm leading-6 text-stone-600">{product.description}</p>
          </div>

          {/* Price block */}
          <div className="rounded-md border border-stone-200 bg-[#fcfbf8] p-4 sm:p-5">
            <div className="flex flex-wrap items-end gap-2 sm:gap-3">
              <p className={`text-3xl font-bold leading-none sm:text-5xl ${hasDiscount ? "text-[#c03a2b]" : "text-[#0f321f]"}`}>
                {formatCurrency(product.unitPriceNok)}
              </p>
              {hasDiscount ? (
                <div className="flex flex-col pb-1 text-sm">
                  <span className="text-stone-400 line-through">{formatCurrency(product.listPriceNok)}</span>
                  <span className="font-bold text-[#c03a2b]">Spar {formatCurrency(savingsNok)}</span>
                </div>
              ) : null}
            </div>
            <p className="mt-1.5 text-xs text-stone-500">
              Pris inkl. mva · per {priceUnitLabel}
            </p>
            {product.packageAreaSqm ? (
              <p className="mt-1 text-xs font-medium text-stone-600">
                1 {salesUnitLabel} = {formatDecimalNo(product.packageAreaSqm)} m² · ca. {formatCurrency(packagePriceNok)} per {salesUnitLabel}
              </p>
            ) : null}

            <ProductUnitCalculator
              unitPriceNok={product.unitPriceNok}
              priceUnit={product.priceUnit}
              salesUnit={product.salesUnit ?? product.unit}
              packageAreaSqm={product.packageAreaSqm}
            />

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="min-w-full flex-1 sm:min-w-[200px]">
                <AddToCartButton productId={product.id} fullWidth />
              </div>
              <div className="flex items-center gap-4 text-xs font-medium">
                {isVerifiedNetAvailable ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-700">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    På lager
                  </span>
                ) : isStoreOnlyAvailable ? (
                  <span className="inline-flex items-center gap-1.5 text-amber-700">
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                    Bestillingsvare
                  </span>
                ) : byggmakkerAvailability ? (
                  <span className="inline-flex items-center gap-1.5 text-stone-500">
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-stone-400" />
                    Utsolgt
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-stone-500">
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-stone-400" />
                    Sjekk levering
                  </span>
                )}
                <span className="text-stone-500">
                  {isVerifiedNetAvailable
                    ? "24-48t hjemlevering"
                    : isStoreOnlyAvailable
                      ? "3-5 dagers hjemlevering"
                      : "Hjemlevering"}
                </span>
              </div>
            </div>
          </div>

          {/* Delivery promise card — replaces pickup-in-store since we deliver everything home */}
          <div className="rounded-md border border-stone-200 bg-white p-3.5">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#15452d]">Levering hjem til deg</p>
            <div className="mt-2 flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center text-lg text-[#15452d]">🚚</div>
              <div className="text-sm text-stone-700">
                {isVerifiedNetAvailable ? (
                  <>
                    <p className="font-semibold text-stone-900">24-48 timers levering</p>
                    <p className="text-xs text-stone-500">Sendes fra Proanbud-lager neste virkedag. Gratis frakt over 5 000 kr.</p>
                  </>
                ) : isStoreOnlyAvailable ? (
                  <>
                    <p className="font-semibold text-stone-900">Bestillingsvare · 3-5 virkedager</p>
                    <p className="text-xs text-stone-500">Vi klargjør varen i vårt nettverk og sender den hjem til deg.</p>
                  </>
                ) : byggmakkerAvailability ? (
                  <>
                    <p className="font-semibold text-stone-900">Restock forventet snart</p>
                    <p className="text-xs text-stone-500">Legg i handlekurv så holder vi deg oppdatert på leveringstid.</p>
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-stone-900">Vi sjekker leveringstid ved bestilling</p>
                    <p className="text-xs text-stone-500">Typisk 2-5 virkedager hjem til deg.</p>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Trust row */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <TrustItem icon="🚚" title="Gratis frakt" subtitle="over 5 000 kr" />
            <TrustItem icon="↩︎" title="30 dager" subtitle="retur" />
            <TrustItem icon="✓" title="NOBB" subtitle="sertifisert" />
            <TrustItem icon="💳" title="Faktura" subtitle="14 dager" />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <InfoCard label="Merke" value={product.brand} />
            <InfoCard label="Kategori" value={product.category} />
            <InfoCard label="Prisenhet" value={product.priceUnit ?? product.unit} />
            <InfoCard label="Selges som" value={product.salesUnit ?? product.unit} />
            {product.packageAreaSqm ? (
              <InfoCard label="Pakningsinnhold" value={`${formatDecimalNo(product.packageAreaSqm)} m²`} />
            ) : null}
            <InfoCard label="Varenummer" value={product.nobbNumber} />
          </div>

          {product.technicalDetails.length > 0 ? (
            <div className="rounded-md border border-stone-200 bg-white p-3.5">
              <p className="text-sm font-semibold text-stone-900">Tekniske detaljer</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {product.technicalDetails.map((detail) => (
                  <span key={detail} className="rounded-sm bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700">
                    {detail}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-md border border-stone-200 bg-white p-4 shadow-[0_4px_14px_rgba(32,25,15,0.03)] sm:p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#c03a2b]">Du kan også like</p>
            <h2 className="mt-1 text-lg font-semibold text-stone-900">Flere tilbud i {product.category}</h2>
          </div>
          <Link
            href={`/?category=${encodeURIComponent(product.category)}`}
            className="text-sm font-semibold text-[#15452d] hover:underline"
          >
            Se alle →
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {related.items
            .filter((relatedProduct) => relatedProduct.id !== product.id)
            .slice(0, 4)
            .map((relatedProduct) => {
              const hasRelDiscount = relatedProduct.listPriceNok > relatedProduct.unitPriceNok;
              const relDiscount = hasRelDiscount
                ? Math.round(((relatedProduct.listPriceNok - relatedProduct.unitPriceNok) / relatedProduct.listPriceNok) * 100)
                : 0;
              return (
                <Link
                  key={relatedProduct.id}
                  href={`/${relatedProduct.slug}`}
                  className="group flex min-w-0 flex-col overflow-hidden rounded-md border border-stone-200 bg-white transition hover:border-[#15452d]"
                >
                  <div className="relative flex aspect-square items-center justify-center border-b border-stone-100 bg-white p-2.5 sm:p-3">
                    {hasRelDiscount ? (
                      <span className="absolute left-2 top-2 inline-flex items-center rounded-sm bg-[#c03a2b] px-1.5 py-0.5 text-[10px] font-bold text-white">
                        -{relDiscount}%
                      </span>
                    ) : null}
                    <StorefrontProductImage
                      src={getStorefrontImageUrl(relatedProduct)}
                      alt={relatedProduct.productName}
                      className="h-full w-full object-contain transition group-hover:scale-[1.03]"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-2.5 sm:p-3">
                    <p className="line-clamp-2 text-xs font-semibold leading-4 text-stone-900 sm:text-sm">{relatedProduct.productName}</p>
                    <p className="mt-1 truncate text-[11px] text-stone-500 sm:text-xs">{relatedProduct.brand || relatedProduct.category}</p>
                    <div className="mt-auto flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 pt-2">
                      <p className={`text-base font-bold sm:text-lg ${hasRelDiscount ? "text-[#c03a2b]" : "text-stone-900"}`}>
                        {formatCurrency(relatedProduct.unitPriceNok)}
                      </p>
                      {hasRelDiscount ? (
                        <p className="text-xs text-stone-400 line-through">
                          {formatCurrency(relatedProduct.listPriceNok)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </Link>
              );
            })}
        </div>
      </section>
    </div>
  );
}

function mapProductForProfile(product: StorefrontProfileProductSource) {
  return {
    nobbNumber: product.nobbNumber,
    productName: product.productName,
    category: product.category,
    sectionTitle: product.sectionTitle,
    supplierName: product.supplierName,
    brand: product.brand,
  };
}

type StorefrontProfileProductSource = {
  nobbNumber: string;
  productName: string;
  category: string;
  sectionTitle: string;
  supplierName: string;
  brand: string;
};

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-stone-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-stone-900">{value}</p>
    </div>
  );
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

function TrustItem({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-2.5 py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center text-sm text-[#15452d]">
        {icon}
      </span>
      <div>
        <p className="text-xs font-semibold text-stone-900">{title}</p>
        <p className="text-[10px] text-stone-500">{subtitle}</p>
      </div>
    </div>
  );
}
