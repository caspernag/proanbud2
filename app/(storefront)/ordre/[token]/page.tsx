import Link from "next/link";
import { notFound } from "next/navigation";

import { StorefrontCartReset } from "@/app/_components/storefront/storefront-cart-reset";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";

type StorefrontOrderPageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ShopOrderRow = {
  id: string;
  public_token: string;
  status: "draft" | "pending_payment" | "paid" | "fulfilled" | "cancelled" | "failed";
  customer_email: string;
  customer_name: string;
  customer_phone: string | null;
  shipping_address_line1: string;
  shipping_postal_code: string;
  shipping_city: string;
  customer_note: string;
  subtotal_nok: number;
  shipping_nok: number;
  vat_nok: number;
  total_nok: number;
  created_at: string;
  paid_at: string | null;
};

type ShopOrderItemRow = {
  id: string;
  product_name: string;
  supplier_name: string;
  nobb_number: string;
  category: string;
  unit: string;
  quantity: number;
  unit_price_nok: number;
  line_total_nok: number;
};

export default async function StorefrontOrderPage({ params, searchParams }: StorefrontOrderPageProps) {
  const { token } = await params;
  const resolvedSearchParams = await searchParams;
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return (
      <div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-6 text-stone-800">
        Ordresiden er ikke tilgjengelig akkurat nå.
      </div>
    );
  }

  const { data: order } = await supabase
    .from("shop_orders")
    .select("*")
    .eq("public_token", token)
    .maybeSingle<ShopOrderRow>();

  if (!order) {
    notFound();
  }

  const { data: items } = await supabase
    .from("shop_order_items")
    .select("*")
    .eq("order_id", order.id)
    .returns<ShopOrderItemRow[]>();

  const paidInReturn = resolvedSearchParams.paid === "1" || resolvedSearchParams.test_mode === "1";
  const shouldResetCart = paidInReturn || order.status === "paid" || order.status === "fulfilled";

  return (
    <div className="space-y-4">
      {shouldResetCart ? <StorefrontCartReset /> : null}
      <section className="rounded-[1rem] border border-stone-200 bg-white p-5 shadow-[0_14px_32px_rgba(32,25,15,0.06)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8a5c2b]">Ordrebekreftelse</p>
        <h1 className="mt-2 text-3xl font-semibold text-stone-900 sm:text-4xl">Takk for bestillingen.</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
          {paidInReturn || order.status === "paid" || order.status === "fulfilled"
            ? "Vi har mottatt betalingen, og bestillingen din behandles nå."
            : "Bestillingen er registrert. Du får oppdatert status så snart betalingen er bekreftet."}
        </p>

        <div className="mt-4 grid gap-2.5 md:grid-cols-4">
          <MetricCard label="Ordrestatus" value={translateOrderStatus(order.status)} />
          <MetricCard label="Ordretotal" value={formatCurrency(order.total_nok)} />
          <MetricCard label="Kunde" value={order.customer_name} />
          <MetricCard label="E-post" value={order.customer_email} />
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="rounded-[1rem] border border-stone-200 bg-white p-4 shadow-[0_14px_32px_rgba(32,25,15,0.06)]">
          <h2 className="text-lg font-semibold text-stone-900">Bestilte varer</h2>
          <div className="mt-3 space-y-2.5">
            {(items ?? []).map((item) => (
              <article key={item.id} className="grid gap-2 rounded-[0.9rem] border border-stone-200 bg-stone-50 p-3 md:grid-cols-[minmax(0,1fr)_110px_110px] md:items-center">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-stone-900">{item.product_name}</p>
                  <p className="mt-1 text-xs text-stone-500">
                    {item.category} · Varenr. {item.nobb_number}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Antall</p>
                  <p className="mt-1 text-sm font-semibold text-stone-900">{item.quantity} {item.unit}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Linjesum</p>
                  <p className="mt-1 text-sm font-semibold text-stone-900">{formatCurrency(item.line_total_nok)}</p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="space-y-4">
          <section className="rounded-[1rem] border border-stone-900 bg-stone-900 p-4 text-white shadow-[0_16px_36px_rgba(18,18,18,0.24)]">
            <p className="text-sm font-semibold">Oppsummering</p>
            <div className="mt-4 space-y-2">
              <SummaryLine label="Varer" value={formatCurrency(order.subtotal_nok)} />
              <SummaryLine label="Frakt" value={formatCurrency(order.shipping_nok)} />
              <SummaryLine label="MVA inkludert" value={formatCurrency(order.vat_nok)} />
              <SummaryLine label="Total" value={formatCurrency(order.total_nok)} strong />
            </div>
          </section>

          <section className="rounded-[1rem] border border-stone-200 bg-white p-4 shadow-[0_14px_32px_rgba(32,25,15,0.06)]">
            <p className="text-sm font-semibold text-stone-900">Leveringsinformasjon</p>
            <p className="mt-3 text-sm leading-6 text-stone-600">
              {order.customer_name}<br />
              {order.shipping_address_line1}<br />
              {order.shipping_postal_code} {order.shipping_city}
            </p>
            {order.customer_phone ? (
              <p className="mt-3 text-sm text-stone-600">Telefon: {order.customer_phone}</p>
            ) : null}
            {order.customer_note ? (
              <p className="mt-3 rounded-[0.8rem] border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
                {order.customer_note}
              </p>
            ) : null}
          </section>

          <Link
            href="/"
            className="inline-flex w-full items-center justify-center rounded-lg border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-800 transition hover:border-stone-900 hover:text-stone-900"
          >
            Tilbake til nettbutikken
          </Link>
        </aside>
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[0.8rem] border border-stone-200 bg-stone-50 p-3">
      <p className="text-xs uppercase tracking-[0.14em] text-stone-500">{label}</p>
      <p className="mt-2 text-base font-semibold text-stone-900">{value}</p>
    </div>
  );
}

function SummaryLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-[0.8rem] px-3 py-2 ${strong ? "bg-white text-stone-900" : "bg-white/6 text-white"}`}>
      <span className={`text-xs ${strong ? "text-stone-500" : "text-stone-300"}`}>{label}</span>
      <span className={`font-mono text-sm ${strong ? "font-semibold" : "font-medium"}`}>{value}</span>
    </div>
  );
}

function translateOrderStatus(status: ShopOrderRow["status"]) {
  switch (status) {
    case "pending_payment":
      return "Venter på betaling";
    case "paid":
      return "Betalt";
    case "fulfilled":
      return "Fullført";
    case "cancelled":
      return "Kansellert";
    case "failed":
      return "Feilet";
    default:
      return "Klargjort";
  }
}
