import Link from "next/link";
import { Suspense } from "react";

import { StorefrontCartReset } from "@/app/_components/storefront/storefront-cart-reset";
import { isUuid, SHOP_ORDER_STATUS_LABELS, SHOP_ORDER_TRANSPORT_LABELS, type ShopOrderStatus, type ShopOrderTransportStatus } from "@/lib/shop-order";
import { withResolvedShopOrderUnits } from "@/lib/shop-order-units";
import { getStripe } from "@/lib/stripe";
import { reconcileCheckoutSession } from "@/lib/stripe-checkout-reconciliation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";

type SuccessPageProps = {
  searchParams: Promise<{
    slug?: string;
    session_id?: string;
    order_id?: string;
    shop_order_token?: string;
    shop_order_slug?: string;
  }>;
};

type ShopOrderSummary = {
  id: string;
  public_token: string;
  slug: string | null;
  status: ShopOrderStatus;
  transport_status: ShopOrderTransportStatus;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  shipping_address_line1: string;
  shipping_postal_code: string;
  shipping_city: string;
  subtotal_nok: number;
  shipping_nok: number;
  vat_nok: number;
  total_nok: number;
  created_at: string;
  paid_at: string | null;
};

type ShopOrderItemSummary = {
  id: string;
  product_id: string;
  product_name: string;
  supplier_name: string;
  quantity: number;
  unit: string;
  line_total_nok: number;
};

type MaterialOrderSummary = {
  id: string;
  delivery_mode: string;
  delivery_address_line1: string | null;
  delivery_postal_code: string | null;
  delivery_city: string | null;
  subtotal_nok: number;
  delivery_fee_nok: number;
  vat_nok: number;
  total_nok: number;
};

type MaterialOrderItemSummary = {
  id: string;
  product_name: string;
  supplier_label: string;
  quantity: number;
  unit: string;
  total_price_nok: number;
};

async function SuccessPageContent({ searchParams }: SuccessPageProps) {
  const resolvedSearchParams = await searchParams;
  let slug = resolvedSearchParams.slug?.trim() || "";
  const orderIdFromQuery = resolvedSearchParams.order_id?.trim() || "";
  let shopOrderToken = resolvedSearchParams.shop_order_token?.trim() || "";
  let shopOrderSlug = resolvedSearchParams.shop_order_slug?.trim() || "";
  const sessionId = resolvedSearchParams.session_id;
  const stripe = getStripe();
  let paymentStatus = "ubekreftet";
  let isMaterialOrder = false;
  let isShopOrder = Boolean(shopOrderToken || shopOrderSlug);
  let materialOrderId = "";
  let shopOrderId = "";
  let shopOrder: ShopOrderSummary | null = null;
  let shopOrderItems: ShopOrderItemSummary[] = [];
  let materialOrder: MaterialOrderSummary | null = null;
  let materialOrderItems: MaterialOrderItemSummary[] = [];

  if (stripe && sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      paymentStatus = session.payment_status;
      isMaterialOrder = session.metadata?.kind === "material_order" || Boolean(session.metadata?.orderId);
      isShopOrder = session.metadata?.kind === "shop_order" || Boolean(session.metadata?.shopOrderId);
      materialOrderId = (session.metadata?.orderId ?? orderIdFromQuery).trim();
      shopOrderId = (session.metadata?.shopOrderId ?? "").trim();
      shopOrderToken = (session.metadata?.shopOrderToken ?? shopOrderToken).trim();
      shopOrderSlug = (session.metadata?.shopOrderSlug ?? shopOrderSlug).trim();
      if (!slug) {
        slug = (session.metadata?.projectSlug ?? session.metadata?.slug ?? "").trim();
      }
      await reconcileCheckoutSession(session);
    } catch {
      paymentStatus = "ukjent";
    }
  }

  if (isShopOrder && (shopOrderId || shopOrderSlug || shopOrderToken)) {
    const supabase = createSupabaseAdminClient();

    if (supabase) {
      const orderSelect = "id, public_token, slug, status, transport_status, customer_name, customer_email, customer_phone, shipping_address_line1, shipping_postal_code, shipping_city, subtotal_nok, shipping_nok, vat_nok, total_nok, created_at, paid_at";
      const orderKey = shopOrderId || shopOrderSlug || shopOrderToken;
      const orderQuery = supabase.from("shop_orders").select(orderSelect);
      const { data: orderData } = shopOrderId
        ? await orderQuery.eq("id", shopOrderId).maybeSingle<ShopOrderSummary>()
        : await orderQuery
            .or(isUuid(orderKey) ? `public_token.eq.${orderKey},slug.eq.${orderKey}` : `slug.eq.${orderKey}`)
            .maybeSingle<ShopOrderSummary>();

      const { data: itemData } = orderData
        ? await supabase
            .from("shop_order_items")
            .select("id, product_id, product_name, supplier_name, quantity, unit, line_total_nok")
            .eq("order_id", orderData.id)
            .order("supplier_name")
            .limit(6)
            .returns<ShopOrderItemSummary[]>()
        : { data: [] as ShopOrderItemSummary[] };

      shopOrder = orderData ?? null;
      shopOrderItems = await withResolvedShopOrderUnits(itemData ?? []);
      shopOrderSlug = shopOrder?.slug ?? shopOrderSlug;
      shopOrderToken = shopOrder?.public_token ?? shopOrderToken;
    }
  }

  if (isMaterialOrder && materialOrderId) {
    const supabase = createSupabaseAdminClient();
    if (supabase) {
      const { data: moData } = await supabase
        .from("material_orders")
        .select("id, delivery_mode, delivery_address_line1, delivery_postal_code, delivery_city, subtotal_nok, delivery_fee_nok, vat_nok, total_nok")
        .eq("id", materialOrderId)
        .maybeSingle<MaterialOrderSummary>();

      const { data: moItems } = moData
        ? await supabase
            .from("material_order_items")
            .select("id, product_name, supplier_label, quantity, unit, total_price_nok")
            .eq("order_id", moData.id)
            .eq("is_included", true)
            .order("supplier_label")
            .limit(6)
            .returns<MaterialOrderItemSummary[]>()
        : { data: [] as MaterialOrderItemSummary[] };

      materialOrder = moData ?? null;
      materialOrderItems = moItems ?? [];
    }
  }

  const shopOrderKey = shopOrderSlug || shopOrderToken || shopOrderId;
  const shopOrderHref = shopOrderKey ? `/min-side/bestillinger/${encodeURIComponent(shopOrderKey)}` : "/min-side/bestillinger";
  const orderStatusLabel = shopOrder ? SHOP_ORDER_STATUS_LABELS[shopOrder.status] : paymentStatus;
  const transportStatusLabel = shopOrder ? SHOP_ORDER_TRANSPORT_LABELS[shopOrder.transport_status] : "Klargjøres";

  return (
    <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-8 sm:px-6 lg:px-8">
      {isShopOrder && paymentStatus === "paid" ? <StorefrontCartReset /> : null}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-stone-500">
        <Link href="/min-side" className="hover:text-stone-900">Min side</Link>
        <span>/</span>
        <Link href="/min-side/bestillinger" className="hover:text-stone-900">Bestillinger</Link>
        <span>/</span>
        <span className="text-stone-900">Bekreftelse</span>
      </div>

      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_12px_34px_rgba(32,25,15,0.06)]">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
          <div className="bg-[#15452d] p-6 text-white sm:p-8">
            <div className="inline-flex rounded-md bg-[#d9ff7a] px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-[#0f321f] ring-1 ring-[#d9ff7a]/40">
              Betaling bekreftet
            </div>
            <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
              {isShopOrder ? "Ordre mottatt — vi har fått bestillingen din." : isMaterialOrder ? "Bestillingen er registrert." : "Prosjektet er klart."}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-[#e8f2ea] sm:text-base">
              {isShopOrder
                ? "Ordrebekreftelse er sendt på e-post. Du kan spore betaling og transport nedenfor — ingen innlogging nødvendig."
                : isMaterialOrder
                  ? "Materialbestillingen sendes videre for behandling når betalingen er bekreftet."
                  : "Materialliste, PDF og bestilling er tilgjengelig fra prosjektet ditt."}
            </p>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <StatusTile label="Ordre" value={isShopOrder ? (shopOrder?.slug ?? shopOrderKey ?? "Ukjent") : slug || "Ukjent"} dark />
              <StatusTile label="Status" value={orderStatusLabel} dark />
              <StatusTile label="Transport" value={isShopOrder ? transportStatusLabel : "Behandles"} dark />
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              {isShopOrder ? (
                <>
                  <Link
                    href={shopOrderKey ? `/ordre/${encodeURIComponent(shopOrderKey)}` : "/"}
                    className="inline-flex h-11 items-center justify-center rounded-md bg-[#d9ff7a] px-5 text-sm font-bold text-[#0f321f]! transition hover:bg-[#c9f15c]"
                  >
                    Spor bestillingen →
                  </Link>
                  <Link
                    href={shopOrderHref}
                    className="inline-flex h-11 items-center justify-center rounded-md border border-white/25 px-5 text-sm font-semibold text-white transition hover:border-white/45 hover:bg-white/10"
                  >
                    Min side
                  </Link>
                </>
              ) : isMaterialOrder ? (
                <Link
                  href={
                    slug
                      ? `/min-side/materiallister/${slug}/bestilling${
                          materialOrderId ? `?order=${encodeURIComponent(materialOrderId)}&paid=1` : "?paid=1"
                        }`
                      : "/min-side/materiallister"
                  }
                  className="inline-flex h-11 items-center justify-center rounded-md bg-[#d9ff7a] px-5 text-sm font-bold text-[#0f321f] transition hover:bg-[#c9f15c]"
                >
                  Åpne bestilling
                </Link>
              ) : (
                <Link href={slug ? `/min-side/materiallister/${slug}` : "/min-side/materiallister"} className="inline-flex h-11 items-center justify-center rounded-md bg-[#d9ff7a] px-5 text-sm font-bold text-[#0f321f] transition hover:bg-[#c9f15c]">
                  Åpne prosjektet
                </Link>
              )}
              <Link href={isShopOrder ? "/" : "/min-side/materiallister"} className="inline-flex h-11 items-center justify-center rounded-md border border-white/25 px-5 text-sm font-semibold text-white transition hover:border-white/45 hover:bg-white/10">
                {isShopOrder ? "Fortsett å handle" : "Tilbake til oversikt"}
              </Link>
            </div>
          </div>

          <aside className="bg-[#faf8f3] p-6 sm:p-8">
            <h2 className="text-sm font-semibold text-stone-900">Ordresammendrag</h2>
            <div className="mt-4 space-y-3">
              {shopOrder ? (
                <>
                  <SummaryRow label="Kunde" value={shopOrder.customer_name} />
                  <SummaryRow label="E-post" value={shopOrder.customer_email} />
                  {shopOrder.customer_phone ? <SummaryRow label="Telefon" value={shopOrder.customer_phone} /> : null}
                  <SummaryRow label="Levering" value={`${shopOrder.shipping_address_line1}, ${shopOrder.shipping_postal_code} ${shopOrder.shipping_city}`} />
                  <div className="border-t border-stone-200 pt-3">
                    <SummaryRow label="Varer" value={formatCurrency(shopOrder.subtotal_nok)} />
                    <SummaryRow label="Frakt" value={shopOrder.shipping_nok === 0 ? "Gratis" : formatCurrency(shopOrder.shipping_nok)} />
                    <SummaryRow label="MVA inkl." value={formatCurrency(shopOrder.vat_nok)} />
                    <SummaryRow label="Totalt" value={formatCurrency(shopOrder.total_nok)} strong />
                  </div>
                </>
              ) : materialOrder ? (
                <>
                  {materialOrder.delivery_mode === "delivery" && materialOrder.delivery_address_line1 ? (
                    <SummaryRow label="Levering" value={`${materialOrder.delivery_address_line1}, ${materialOrder.delivery_postal_code ?? ""} ${materialOrder.delivery_city ?? ""}`} />
                  ) : materialOrder.delivery_mode === "pickup" ? (
                    <SummaryRow label="Levering" value="Henting i varehus" />
                  ) : null}
                  <div className="border-t border-stone-200 pt-3">
                    <SummaryRow label="Varer" value={formatCurrency(materialOrder.subtotal_nok)} />
                    <SummaryRow label="Frakt" value={materialOrder.delivery_fee_nok === 0 ? "Gratis" : formatCurrency(materialOrder.delivery_fee_nok)} />
                    <SummaryRow label="MVA inkl." value={formatCurrency(materialOrder.vat_nok)} />
                    <SummaryRow label="Totalt" value={formatCurrency(materialOrder.total_nok)} strong />
                  </div>
                </>
              ) : (
                <>
                  <SummaryRow label="Betalingsstatus" value={paymentStatus} strong />
                  <SummaryRow label="Referanse" value={slug || materialOrderId || "Ukjent"} />
                </>
              )}
            </div>
          </aside>
        </div>
      </section>

      {isMaterialOrder && materialOrderItems.length > 0 ? (
        <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-stone-900">Varer i bestillingen</h2>
              <Link
                href={slug ? `/min-side/materiallister/${slug}/bestilling${materialOrderId ? `?order=${encodeURIComponent(materialOrderId)}&paid=1` : "?paid=1"}` : "/min-side/materiallister"}
                className="text-xs font-semibold text-stone-600 hover:text-stone-950"
              >
                Se full bestilling
              </Link>
            </div>
            <div className="mt-3 divide-y divide-stone-100">
              {materialOrderItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-stone-900">{item.product_name}</p>
                    <p className="mt-0.5 text-xs text-stone-500">{item.supplier_label} · {item.quantity} {item.unit}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-stone-900">{formatCurrency(item.total_price_nok)}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-stone-900">Neste steg</h2>
            <div className="mt-4 space-y-3">
              <StepLine done label="Betaling registrert" />
              <StepLine done label="Ordren videresendes" />
              <StepLine done={false} label="Behandles av leverandør" />
              <StepLine done={false} label="Leveres til deg" />
            </div>
          </div>
        </section>
      ) : null}

      {isShopOrder ? (
        <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-stone-900">Varer i ordren</h2>
              <Link href={shopOrderHref} className="text-xs font-semibold text-stone-600 hover:text-stone-950">Se full ordre</Link>
            </div>
            <div className="mt-3 divide-y divide-stone-100">
              {shopOrderItems.length > 0 ? shopOrderItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-stone-900">{item.product_name}</p>
                    <p className="mt-0.5 text-xs text-stone-500">{item.supplier_name} · {item.quantity} {item.unit}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-stone-900">{formatCurrency(item.line_total_nok)}</p>
                </div>
              )) : (
                <p className="py-3 text-sm text-stone-500">Varelinjene vises på ordresiden når ordren er ferdig lagret.</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-stone-900">Neste steg</h2>
            <div className="mt-4 space-y-3">
              <StepLine done label="Betaling registrert" />
              <StepLine done={shopOrder?.transport_status !== "pending"} label="Ordren bekreftes" />
              <StepLine done={false} label="Plukk og pakking" />
              <StepLine done={false} label="Sendes til deg" />
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function StatusTile({ label, value, dark = false }: { label: string; value: string; dark?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-3 ${dark ? "border-white/15 bg-white/10" : "border-stone-200 bg-white"}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${dark ? "text-[#cce6d3]" : "text-stone-500"}`}>{label}</p>
      <p className={`mt-1 truncate text-sm font-semibold ${dark ? "text-white" : "text-stone-900"}`}>{value}</p>
    </div>
  );
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="shrink-0 text-stone-500">{label}</span>
      <span className={`text-right ${strong ? "font-bold text-stone-950" : "font-medium text-stone-900"}`}>{value}</span>
    </div>
  );
}

function StepLine({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-emerald-500 text-white" : "bg-stone-100 text-stone-400"}`}>
        {done ? "✓" : ""}
      </span>
      <span className={`text-sm font-medium ${done ? "text-stone-900" : "text-stone-500"}`}>{label}</span>
    </div>
  );
}

export default function PaymentSuccessPage(props: SuccessPageProps) {
  return (
    <Suspense fallback={null}>
      <SuccessPageContent {...props} />
    </Suspense>
  );
}
