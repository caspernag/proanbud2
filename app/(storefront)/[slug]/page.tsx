import Link from "next/link";
import { notFound } from "next/navigation";

import { AddToCartButton } from "@/app/_components/storefront/add-to-cart-button";
import { StorefrontProductImage } from "@/app/_components/storefront/storefront-product-image";
import { getByggmakkerAvailability } from "@/lib/byggmakker-availability";
import { getStorefrontImageUrl, getStorefrontProductBySlug, queryStorefrontProducts } from "@/lib/storefront";
import { formatCurrency } from "@/lib/utils";

type StorefrontProductPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function StorefrontProductPage({ params }: StorefrontProductPageProps) {
  const { slug } = await params;
  const product = await getStorefrontProductBySlug(slug);

  if (!product) {
    notFound();
  }

  const isByggmakkerProduct = product.supplierName.toLowerCase().includes("byggmakker");

  const related = await queryStorefrontProducts({
    category: product.category,
    sort: "relevance",
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
  const isVerifiedNetAvailable = Boolean(byggmakkerAvailability?.netAvailable);
  const isStoreOnlyAvailable =
    !isVerifiedNetAvailable && Boolean(byggmakkerAvailability?.storeAvailable);

  return (
    <div className="space-y-5">
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

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_520px]">
        {/* Image panel */}
        <div className="relative overflow-hidden rounded-3xl border border-stone-200 bg-gradient-to-br from-white via-stone-50 to-stone-100 shadow-[0_14px_32px_rgba(32,25,15,0.06)]">
          {hasDiscount ? (
            <div className="absolute left-5 top-5 z-10 flex flex-col gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-[#c03a2b] px-3 py-1.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(192,58,43,0.35)]">
                <span className="text-xs font-medium uppercase tracking-wider opacity-80">Spar</span>
                -{discountPct}%
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-[#d9ff7a] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#0f321f]">
                Partnerpris
              </span>
            </div>
          ) : null}
          <div className="flex items-center justify-center p-6">
            <StorefrontProductImage
              src={getStorefrontImageUrl(product)}
              alt={product.productName}
              className="aspect-square w-full max-h-[480px] object-contain drop-shadow-[0_8px_22px_rgba(0,0,0,0.12)]"
            />
          </div>
        </div>

        {/* Info panel */}
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
            <span className="rounded-md bg-[#15452d]/8 px-2 py-1 text-[#15452d]">{product.category}</span>
            {product.brand ? (
              <span className="rounded-md bg-stone-100 px-2 py-1 text-stone-600">{product.brand}</span>
            ) : null}
            <span className="rounded-md bg-stone-100 px-2 py-1 text-stone-600">Art.nr {product.nobbNumber}</span>
          </div>

          <div>
            <h1 className="text-2xl font-semibold leading-tight text-stone-900 sm:text-3xl">{product.productName}</h1>
            <p className="mt-2 text-sm leading-6 text-stone-600">{product.description}</p>
          </div>

          {/* Price block */}
          <div className="rounded-2xl border-2 border-[#15452d]/15 bg-gradient-to-br from-[#f7fef0] via-white to-white p-5 shadow-[0_10px_24px_rgba(21,69,45,0.08)]">
            <div className="flex items-end gap-3">
              <p className={`text-4xl font-bold leading-none sm:text-5xl ${hasDiscount ? "text-[#c03a2b]" : "text-[#0f321f]"}`}>
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
              Pris inkl. mva · per {product.unit.toLowerCase() || "stk"}
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="min-w-[200px] flex-1">
                <AddToCartButton productId={product.id} />
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
          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#15452d]">Levering hjem til deg</p>
            <div className="mt-2 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#15452d]/10 text-lg">🚚</div>
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
            <InfoCard label="Selges som" value={product.unit} />
            <InfoCard label="Varenummer" value={product.nobbNumber} />
          </div>

          {product.technicalDetails.length > 0 ? (
            <div className="rounded-2xl border border-stone-200 bg-white p-4">
              <p className="text-sm font-semibold text-stone-900">Tekniske detaljer</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {product.technicalDetails.map((detail) => (
                  <span key={detail} className="rounded-lg bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700">
                    {detail}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_14px_32px_rgba(32,25,15,0.06)]">
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

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  className="group overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:-translate-y-0.5 hover:border-[#15452d] hover:shadow-[0_16px_34px_rgba(21,69,45,0.12)]"
                >
                  <div className="relative flex h-36 items-center justify-center border-b border-stone-100 bg-gradient-to-br from-white to-stone-50 p-3">
                    {hasRelDiscount ? (
                      <span className="absolute left-2 top-2 inline-flex items-center rounded-md bg-[#c03a2b] px-1.5 py-0.5 text-[10px] font-bold text-white">
                        -{relDiscount}%
                      </span>
                    ) : null}
                    <StorefrontProductImage
                      src={getStorefrontImageUrl(relatedProduct)}
                      alt={relatedProduct.productName}
                      className="h-full w-full object-contain transition group-hover:scale-[1.03]"
                    />
                  </div>
                  <div className="p-3">
                    <p className="line-clamp-2 text-sm font-semibold text-stone-900">{relatedProduct.productName}</p>
                    <p className="mt-1 text-xs text-stone-500">{relatedProduct.brand || relatedProduct.category}</p>
                    <div className="mt-2 flex items-baseline gap-2">
                      <p className={`text-lg font-bold ${hasRelDiscount ? "text-[#c03a2b]" : "text-stone-900"}`}>
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

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-stone-900">{value}</p>
    </div>
  );
}

function TrustItem({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white p-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#15452d]/10 text-sm text-[#15452d]">
        {icon}
      </span>
      <div>
        <p className="text-xs font-semibold text-stone-900">{title}</p>
        <p className="text-[10px] text-stone-500">{subtitle}</p>
      </div>
    </div>
  );
}
