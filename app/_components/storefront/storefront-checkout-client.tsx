"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { useStorefront } from "@/app/_components/storefront/storefront-provider";
import { StorefrontProductImage } from "@/app/_components/storefront/storefront-product-image";
import { buildStorefrontNobbImagePath, isAllowedStorefrontImageUrl, STORE_IMAGE_FALLBACK_URL } from "@/lib/storefront-image";
import type { StorefrontProduct } from "@/lib/storefront-types";
import { formatCurrency } from "@/lib/utils";

function resolveImageUrl(product: Pick<StorefrontProduct, "imageUrl" | "nobbNumber">): string {
  if (product.imageUrl && isAllowedStorefrontImageUrl(product.imageUrl)) return product.imageUrl;
  if (product.nobbNumber) return buildStorefrontNobbImagePath(product.nobbNumber);
  return STORE_IMAGE_FALLBACK_URL;
}

type CheckoutProductsResponse = {
  items?: StorefrontProduct[];
};

export function StorefrontCheckoutClient({ paymentCancelled }: { paymentCancelled: boolean }) {
  const { items, updateQuantity, removeItem } = useStorefront();
  const [products, setProducts] = useState<StorefrontProduct[]>([]);
  const productCacheRef = useRef<Map<string, StorefrontProduct>>(new Map());
  const [loading, setLoading] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [notes, setNotes] = useState("");
  const [checkoutFlow, setCheckoutFlow] = useState<"pay_now" | "klarna">("pay_now");

  useEffect(() => {
    if (items.length === 0) {
      setProducts([]);
      return;
    }

    const cache = productCacheRef.current;
    const wantedIds = items.map((item) => item.productId);
    const missingIds = wantedIds.filter((id) => !cache.has(id));

    // All products already cached — update immediately without a network call
    if (missingIds.length === 0) {
      setProducts(wantedIds.map((id) => cache.get(id)!).filter(Boolean));
      return;
    }

    const abortController = new AbortController();

    startTransition(() => {
      setLoading(true);
      setMessage("");
    });

    void (async () => {
      try {
        const ids = missingIds.join(",");
        const response = await fetch(`/api/store/products?ids=${encodeURIComponent(ids)}`, {
          signal: abortController.signal,
        });
        const payload = (await response.json()) as CheckoutProductsResponse;

        if (!response.ok || !Array.isArray(payload.items)) {
          setProducts([]);
          setMessage("Kunne ikke hente produktene i handlekurven akkurat nå.");
          return;
        }

        // Populate cache with newly fetched products
        for (const product of payload.items) {
          cache.set(product.id, product);
        }

        // Build full product list from cache (includes previously cached + new)
        setProducts(wantedIds.map((id) => cache.get(id)!).filter(Boolean));
      } catch {
        if (!abortController.signal.aborted) {
          setProducts([]);
          setMessage("Kunne ikke hente produktene i handlekurven akkurat nå.");
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [items]);

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const lineItems = useMemo(() => {
    return items.flatMap((item) => {
      const product = productById.get(item.productId);

      if (!product) {
        return [];
      }

      return [
        {
          product,
          quantity: item.quantity,
          lineTotalNok: product.unitPriceNok * item.quantity,
          lineListNok: product.listPriceNok * item.quantity,
          savingsNok: Math.max(0, (product.listPriceNok - product.unitPriceNok) * item.quantity),
        },
      ];
    });
  }, [items, productById]);

  const subtotalNok = lineItems.reduce((sum, item) => sum + item.lineTotalNok, 0);
  const totalSavingsNok = lineItems.reduce((sum, item) => sum + item.savingsNok, 0);
  const shippingNok = subtotalNok > 0 ? Math.max(199, Math.min(999, Math.round(subtotalNok * 0.035))) : 0;
  const freeShipping = subtotalNok >= 5000;
  const effectiveShippingNok = freeShipping ? 0 : shippingNok;
  const totalNok = subtotalNok + effectiveShippingNok;
  const vatNok = Math.round(totalNok * 0.2);

  async function submitCheckout() {
    if (lineItems.length === 0) {
      setMessage("Handlekurven er tom.");
      return;
    }

    if (!email.trim() || !fullName.trim() || !phone.trim() || !addressLine1.trim() || !postalCode.trim() || !city.trim()) {
      setMessage("Fyll inn kontakt- og leveringsinformasjon før betaling.");
      return;
    }

    startTransition(() => {
      setCheckoutPending(true);
      setMessage("");
    });

    try {
      const response = await fetch("/api/store/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer: {
            email,
            fullName,
            phone,
            addressLine1,
            postalCode,
            city,
            notes,
          },
          checkoutFlow,
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        }),
      });
      const payload = (await response.json()) as { error?: string; url?: string };

      if (!response.ok || !payload.url) {
        setMessage(payload.error ?? "Kunne ikke starte checkout.");
        setCheckoutPending(false);
        return;
      }

      window.location.href = payload.url;
    } catch {
      setMessage("Nettverksfeil under betaling.");
      setCheckoutPending(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="space-y-4">
        {/* Header with progress */}
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-gradient-to-br from-[#0f321f] to-[#15452d] p-6 text-white shadow-[0_20px_40px_rgba(18,36,25,0.15)]">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-[#d9ff7a] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#0f321f]">
              Partnerpris
            </span>
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-emerald-50/70">Din handlekurv</span>
          </div>
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Fullfør bestillingen din</h1>
          {totalSavingsNok > 0 ? (
            <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold">
              <span className="text-[#d9ff7a]">✓</span>
              Du sparer totalt <span className="text-[#d9ff7a]">{formatCurrency(totalSavingsNok)}</span> mot veiledende pris!
            </p>
          ) : null}

          {/* Progress steps */}
          <div className="mt-5 flex items-center gap-2 text-xs font-semibold">
            <ProgressStep num={1} label="Handlekurv" active />
            <div className="h-px flex-1 bg-white/20" />
            <ProgressStep num={2} label="Levering" active />
            <div className="h-px flex-1 bg-white/20" />
            <ProgressStep num={3} label="Betaling" />
          </div>

          {paymentCancelled ? (
            <p className="mt-4 rounded-xl border border-amber-300/40 bg-amber-400/15 px-3 py-2 text-sm text-amber-100">
              ⚠︎ Betalingen ble avbrutt. Handlekurven er fortsatt lagret.
            </p>
          ) : null}
        </div>

        {/* Line items */}
        <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_14px_32px_rgba(32,25,15,0.06)] sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-stone-900">Varer i handlekurven</h2>
              <p className="text-xs text-stone-500">{lineItems.length} {lineItems.length === 1 ? "vare" : "varer"}</p>
            </div>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-full border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:border-[#15452d] hover:text-[#15452d]"
            >
              ← Fortsett å handle
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-stone-500">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-[#15452d]" />
                Henter handlekurven...
              </div>
            ) : lineItems.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50 px-4 py-10 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-3xl">🛒</div>
                <div>
                  <p className="text-base font-semibold text-stone-900">Handlekurven er tom</p>
                  <p className="mt-1 text-sm text-stone-500">Legg til varer for å fortsette.</p>
                </div>
                <Link
                  href="/"
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#15452d] px-5 py-2.5 text-sm font-semibold text-white! transition hover:bg-[#0f321f]"
                >
                  Utforsk varer →
                </Link>
              </div>
            ) : (
              lineItems.map((lineItem) => {
                const hasLineDiscount = lineItem.savingsNok > 0;
                return (
                  <article
                    key={lineItem.product.id}
                    className="grid grid-cols-[80px_minmax(0,1fr)] gap-3 rounded-2xl border border-stone-200 bg-white p-3 transition hover:border-stone-300 sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:items-center sm:p-4"
                  >
                    <Link
                      href={`/${lineItem.product.slug}`}
                      className="flex h-20 items-center justify-center overflow-hidden rounded-xl border border-stone-200 bg-gradient-to-br from-white to-stone-50 p-1.5 sm:h-24"
                    >
                      <StorefrontProductImage
                        src={resolveImageUrl(lineItem.product)}
                        alt={lineItem.product.productName}
                        className="h-full w-full object-contain"
                      />
                    </Link>

                    <div className="min-w-0">
                      <Link
                        href={`/${lineItem.product.slug}`}
                        className="line-clamp-2 text-sm font-semibold text-stone-900 hover:text-[#15452d] sm:text-base"
                      >
                        {lineItem.product.productName}
                      </Link>
                      <p className="mt-0.5 text-xs text-stone-500">
                        {lineItem.product.brand ? `${lineItem.product.brand} · ` : ""}Art.nr {lineItem.product.nobbNumber}
                      </p>
                      <div className="mt-1.5 flex items-baseline gap-2">
                        <span className={`text-sm font-bold ${hasLineDiscount ? "text-[#c03a2b]" : "text-stone-900"}`}>
                          {formatCurrency(lineItem.product.unitPriceNok)}
                        </span>
                        {hasLineDiscount ? (
                          <span className="text-xs text-stone-400 line-through">
                            {formatCurrency(lineItem.product.listPriceNok)}
                          </span>
                        ) : null}
                        <span className="text-xs text-stone-500">/ {lineItem.product.unit.toLowerCase() || "stk"}</span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-3 sm:hidden">
                        <QuantityStepper
                          value={lineItem.quantity}
                          onChange={(next) => updateQuantity(lineItem.product.id, next)}
                        />
                        <button
                          type="button"
                          onClick={() => removeItem(lineItem.product.id)}
                          className="text-xs font-semibold text-stone-500 transition hover:text-[#c03a2b]"
                        >
                          Fjern
                        </button>
                        <span className="ml-auto text-sm font-bold text-stone-900">
                          {formatCurrency(lineItem.lineTotalNok)}
                        </span>
                      </div>
                    </div>

                    <div className="hidden items-center gap-4 sm:flex">
                      <QuantityStepper
                        value={lineItem.quantity}
                        onChange={(next) => updateQuantity(lineItem.product.id, next)}
                      />
                      <div className="min-w-[90px] text-right">
                        <p className="text-sm font-bold text-stone-900">{formatCurrency(lineItem.lineTotalNok)}</p>
                        {hasLineDiscount ? (
                          <p className="text-[11px] font-semibold text-[#c03a2b]">
                            -{formatCurrency(lineItem.savingsNok)}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => removeItem(lineItem.product.id)}
                          aria-label="Fjern vare"
                          className="mt-1 text-[11px] font-semibold text-stone-500 transition hover:text-[#c03a2b]"
                        >
                          Fjern
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          {/* Free shipping bar */}
          {subtotalNok > 0 ? (
            <div className="mt-4 rounded-xl border border-stone-200 bg-gradient-to-r from-stone-50 to-white p-3">
              {freeShipping ? (
                <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                  <span>🎉</span> Du får gratis frakt på bestillingen!
                </p>
              ) : (
                <div>
                  <p className="text-xs font-medium text-stone-700">
                    Handle for <strong className="text-[#15452d]">{formatCurrency(5000 - subtotalNok)}</strong> til for gratis frakt
                  </p>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#15452d] to-[#d9ff7a] transition-all"
                      style={{ width: `${Math.min(100, (subtotalNok / 5000) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Contact + delivery */}
        <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_14px_32px_rgba(32,25,15,0.06)] sm:p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#15452d] text-xs font-bold text-white">2</span>
            <h2 className="text-base font-semibold text-stone-900">Kontakt og levering</h2>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <FieldInput label="E-post" type="email" value={email} onChange={setEmail} />
            <FieldInput label="Fullt navn" value={fullName} onChange={setFullName} />
            <FieldInput label="Telefon" value={phone} onChange={setPhone} />
            <FieldInput label="Adresse" value={addressLine1} onChange={setAddressLine1} className="sm:col-span-2" />
            <FieldInput label="Postnummer" value={postalCode} onChange={setPostalCode} />
            <FieldInput label="By" value={city} onChange={setCity} />
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-stone-700 sm:col-span-2">
              Kommentar til bestillingen
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                placeholder="Portkode, leveringsinstruks, byggeplass-adresse…"
                className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-normal text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-[#15452d] focus:ring-2 focus:ring-[#15452d]/20"
              />
            </label>
          </div>
        </div>
      </section>

      {/* Sticky summary sidebar */}
      <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
        <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_16px_36px_rgba(18,36,25,0.1)]">
          <div className="bg-gradient-to-br from-[#0f321f] to-[#15452d] px-5 py-4 text-white">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#d9ff7a]">Oppsummering</p>
            <p className="mt-1 text-2xl font-bold">{formatCurrency(totalNok)}</p>
            {totalSavingsNok > 0 ? (
              <p className="mt-0.5 text-xs font-semibold text-[#d9ff7a]">
                Du sparer {formatCurrency(totalSavingsNok)}
              </p>
            ) : null}
          </div>

          <div className="px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-stone-500">Velg betaling</p>
            <div className="mt-2 grid gap-2">
              <PaymentOption
                active={checkoutFlow === "pay_now"}
                onClick={() => setCheckoutFlow("pay_now")}
                title="Kort"
                subtitle="Visa, Mastercard, Apple Pay"
                badge="Raskest"
              />
              <PaymentOption
                active={checkoutFlow === "klarna"}
                onClick={() => setCheckoutFlow("klarna")}
                title="Klarna"
                subtitle="Faktura eller delbetaling"
              />
            </div>

            <div className="mt-4 space-y-1.5 border-t border-stone-200 pt-4 text-sm">
              <SummaryLine label="Varer" value={formatCurrency(subtotalNok)} />
              {totalSavingsNok > 0 ? (
                <SummaryLine label="Din besparelse" value={`-${formatCurrency(totalSavingsNok)}`} accent />
              ) : null}
              <SummaryLine
                label="Frakt"
                value={freeShipping ? "Gratis" : formatCurrency(shippingNok)}
                strikeThrough={freeShipping}
              />
              <SummaryLine label="Herav MVA" value={formatCurrency(vatNok)} muted />
            </div>

            <div className="mt-3 flex items-baseline justify-between rounded-xl bg-stone-100 px-3 py-2.5">
              <span className="text-sm font-semibold text-stone-900">Totalt</span>
              <span className="text-xl font-bold text-[#0f321f]">{formatCurrency(totalNok)}</span>
            </div>

            <button
              type="button"
              onClick={() => {
                void submitCheckout();
              }}
              disabled={checkoutPending || lineItems.length === 0}
              className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#15452d] px-5 text-sm font-bold text-white shadow-[0_10px_26px_rgba(21,69,45,0.3)] transition hover:bg-[#0f321f] disabled:cursor-not-allowed disabled:bg-stone-400 disabled:shadow-none"
            >
              {checkoutPending ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Sender deg videre...
                </>
              ) : checkoutFlow === "klarna" ? (
                <>Fortsett med Klarna →</>
              ) : (
                <>Gå til sikker betaling →</>
              )}
            </button>

            {message ? (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{message}</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-4">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-base">🔒</span>
              <span className="font-medium text-stone-700">Sikker betaling</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base">🚚</span>
              <span className="font-medium text-stone-700">24-48t levering</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base">↩︎</span>
              <span className="font-medium text-stone-700">30 dagers retur</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base">✓</span>
              <span className="font-medium text-stone-700">NOBB-sertifisert</span>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}

function QuantityStepper({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit(raw: string) {
    const parsed = parseInt(raw, 10);
    setDraft(null);
    if (!isNaN(parsed) && parsed >= 1) {
      onChange(parsed);
    }
  }

  return (
    <div className="inline-flex h-9 items-center rounded-full border border-stone-300 bg-white">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={value <= 1}
        className="flex h-9 w-9 items-center justify-center text-stone-600 transition hover:text-[#15452d] disabled:opacity-40"
        aria-label="Reduser antall"
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setDraft(String(value));
          e.target.select();
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setDraft(null); e.currentTarget.blur(); }
        }}
        className="h-9 w-10 border-x border-stone-200 bg-transparent text-center text-sm font-bold text-stone-900 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#15452d]"
        aria-label="Antall"
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className="flex h-9 w-9 items-center justify-center text-stone-600 transition hover:text-[#15452d]"
        aria-label="Øk antall"
      >
        +
      </button>
    </div>
  );
}

function ProgressStep({ num, label, active = false }: { num: number; label: string; active?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
          active ? "bg-[#d9ff7a] text-[#0f321f]" : "bg-white/15 text-white/70"
        }`}
      >
        {num}
      </span>
      <span className={active ? "text-white" : "text-white/60"}>{label}</span>
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  type = "text",
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-xs font-semibold text-stone-700 ${className}`}>
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-stone-300 bg-white px-3 text-sm font-normal text-stone-900 outline-none transition focus:border-[#15452d] focus:ring-2 focus:ring-[#15452d]/20"
      />
    </label>
  );
}

function PaymentOption({
  active,
  onClick,
  title,
  subtitle,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition ${
        active
          ? "border-[#15452d] bg-[#15452d]/5"
          : "border-stone-200 bg-white hover:border-stone-400"
      }`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          active ? "border-[#15452d] bg-[#15452d]" : "border-stone-300 bg-white"
        }`}
      >
        {active ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-stone-900">{title}</p>
          {badge ? (
            <span className="rounded bg-[#d9ff7a] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#0f321f]">
              {badge}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-stone-500">{subtitle}</p>
      </div>
    </button>
  );
}

function SummaryLine({
  label,
  value,
  strong = false,
  muted = false,
  accent = false,
  strikeThrough = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  accent?: boolean;
  strikeThrough?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${muted ? "text-stone-400" : "text-stone-600"}`}>{label}</span>
      <span
        className={`text-sm tabular-nums ${
          accent
            ? "font-bold text-[#c03a2b]"
            : strong
              ? "font-bold text-stone-900"
              : strikeThrough
                ? "font-bold text-emerald-600"
                : muted
                  ? "text-stone-400"
                  : "font-semibold text-stone-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
