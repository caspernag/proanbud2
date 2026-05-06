import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { StorefrontCartReset } from "@/app/_components/storefront/storefront-cart-reset";
import {
  isUuid,
  logShopOrderEvent,
  SHOP_ORDER_STATUS_LABELS,
  SHOP_ORDER_TRANSPORT_LABELS,
  SHOP_ORDER_TRANSPORT_STEPS,
  transportStepState,
  type ShopOrderStatus,
  type ShopOrderTransportStatus,
} from "@/lib/shop-order";
import { withResolvedShopOrderUnits } from "@/lib/shop-order-units";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";

type StorefrontOrderPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ShopOrderRow = {
  id: string;
  public_token: string;
  slug: string | null;
  status: ShopOrderStatus;
  transport_status: ShopOrderTransportStatus;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  estimated_delivery_date: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  last_status_note: string;
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
  product_id: string;
  product_name: string;
  supplier_name: string;
  nobb_number: string;
  category: string;
  unit: string;
  quantity: number;
  unit_price_nok: number;
  line_total_nok: number;
};

type ShopOrderMessageRow = {
  id: string;
  author_type: "customer" | "admin";
  author_name: string;
  body: string;
  created_at: string;
};

type ShopOrderEventRow = {
  id: string;
  event_type: string;
  actor_type: "system" | "admin" | "customer";
  actor_label: string | null;
  message: string;
  created_at: string;
};

export default async function StorefrontOrderPage({ params, searchParams }: StorefrontOrderPageProps) {
  const { token } = await params;
  const resolvedSearchParams = await searchParams;
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-6 text-stone-800">
        Ordresiden er ikke tilgjengelig akkurat nå.
      </div>
    );
  }

  const order = await getShopOrderByKey(supabase, token);

  if (!order) {
    notFound();
  }

  const [{ data: items }, { data: messages }, { data: events }] = await Promise.all([
    supabase
      .from("shop_order_items")
      .select("id, product_id, product_name, supplier_name, nobb_number, category, unit, quantity, unit_price_nok, line_total_nok")
      .eq("order_id", order.id)
      .order("supplier_name")
      .returns<ShopOrderItemRow[]>(),
    supabase
      .from("shop_order_messages")
      .select("id, author_type, author_name, body, created_at")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true })
      .returns<ShopOrderMessageRow[]>(),
    supabase
      .from("shop_order_events")
      .select("id, event_type, actor_type, actor_label, message, created_at")
      .eq("order_id", order.id)
      .eq("is_customer_visible", true)
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<ShopOrderEventRow[]>(),
  ]);

  const resolvedItems = await withResolvedShopOrderUnits(items ?? []);

  async function sendSupportMessage(formData: FormData) {
    "use server";

    const orderKey = String(formData.get("orderKey") ?? "").trim();
    const body = String(formData.get("message") ?? "").trim();

    if (!orderKey || body.length < 2 || body.length > 2000) {
      return;
    }

    const admin = createSupabaseAdminClient();
    if (!admin) return;

    const targetOrder = await getShopOrderIdentityByKey(admin, orderKey);
    if (!targetOrder) return;

    await admin.from("shop_order_messages").insert({
      order_id: targetOrder.id,
      author_type: "customer",
      author_name: targetOrder.customer_name,
      author_email: targetOrder.customer_email,
      body,
    });

    await logShopOrderEvent(admin, {
      orderId: targetOrder.id,
      eventType: "customer_message_created",
      actorType: "customer",
      actorLabel: targetOrder.customer_name,
      message: "Kunden sendte en melding til support.",
      payload: { messageLength: body.length },
    });

    revalidatePath(`/ordre/${orderKey}`);
  }

  const paidInReturn = resolvedSearchParams.paid === "1" || resolvedSearchParams.test_mode === "1";
  const shouldResetCart = paidInReturn || order.status === "paid" || order.status === "fulfilled";
  const orderKey = order.slug ?? order.public_token;

  return (
    <div className="space-y-4">
      {shouldResetCart ? <StorefrontCartReset /> : null}

      <section className="border border-stone-200 bg-white p-5 shadow-[0_8px_24px_rgba(32,25,15,0.06)] sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8a5c2b]">Ordre {orderKey}</p>
            <h1 className="mt-2 text-3xl font-semibold text-stone-900 sm:text-4xl">Takk for bestillingen.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
              {order.status === "paid" || order.status === "fulfilled"
                ? "Betalingen er registrert. Her kan du følge transport, meldinger og status videre."
                : "Ordren er registrert. Status oppdateres automatisk når betalingen er bekreftet."}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[360px]">
            <MetricCard label="Ordrestatus" value={SHOP_ORDER_STATUS_LABELS[order.status]} />
            <MetricCard label="Transport" value={SHOP_ORDER_TRANSPORT_LABELS[order.transport_status]} />
            <MetricCard label="Ordretotal" value={formatCurrency(order.total_nok)} />
            <MetricCard label="Kunde" value={order.customer_name} />
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <TransportOverview order={order} />

          <section className="border border-stone-200 bg-white p-4 shadow-[0_8px_24px_rgba(32,25,15,0.05)] sm:p-5">
            <h2 className="text-lg font-semibold text-stone-900">Bestilte varer</h2>
            <div className="mt-3 space-y-2.5">
              {resolvedItems.map((item) => (
                <article key={item.id} className="grid gap-2 border border-stone-200 bg-stone-50 p-3 md:grid-cols-[minmax(0,1fr)_110px_110px] md:items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-stone-900">{item.product_name}</p>
                    <p className="mt-1 text-xs text-stone-500">{item.category} · Varenr. {item.nobb_number}</p>
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
          </section>

          <SupportPanel orderKey={orderKey} messages={messages ?? []} action={sendSupportMessage} />
          <EventLog events={events ?? []} />
        </div>

        <aside className="space-y-4">
          <section className="border border-stone-900 bg-stone-900 p-4 text-white shadow-[0_12px_30px_rgba(18,18,18,0.2)]">
            <p className="text-sm font-semibold">Oppsummering</p>
            <div className="mt-4 space-y-2">
              <SummaryLine label="Varer" value={formatCurrency(order.subtotal_nok)} />
              <SummaryLine label="Frakt" value={formatCurrency(order.shipping_nok)} />
              <SummaryLine label="MVA inkludert" value={formatCurrency(order.vat_nok)} />
              <SummaryLine label="Total" value={formatCurrency(order.total_nok)} strong />
            </div>
          </section>

          <section className="border border-stone-200 bg-white p-4 shadow-[0_8px_24px_rgba(32,25,15,0.05)]">
            <p className="text-sm font-semibold text-stone-900">Leveringsinformasjon</p>
            <p className="mt-3 text-sm leading-6 text-stone-600">
              {order.customer_name}<br />
              {order.shipping_address_line1}<br />
              {order.shipping_postal_code} {order.shipping_city}
            </p>
            {order.customer_phone ? <p className="mt-3 text-sm text-stone-600">Telefon: {order.customer_phone}</p> : null}
            {order.customer_note ? (
              <p className="mt-3 border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">{order.customer_note}</p>
            ) : null}
          </section>

          <Link
            href="/"
            className="inline-flex w-full items-center justify-center rounded-md border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-800 transition hover:border-stone-900 hover:text-stone-900"
          >
            Tilbake til nettbutikken
          </Link>
        </aside>
      </section>
    </div>
  );
}

async function getShopOrderByKey(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  key: string,
) {
  const select = "id, public_token, slug, status, transport_status, carrier, tracking_number, tracking_url, estimated_delivery_date, shipped_at, delivered_at, last_status_note, customer_email, customer_name, customer_phone, shipping_address_line1, shipping_postal_code, shipping_city, customer_note, subtotal_nok, shipping_nok, vat_nok, total_nok, created_at, paid_at";

  if (isUuid(key)) {
    const { data } = await supabase.from("shop_orders").select(select).eq("public_token", key).maybeSingle<ShopOrderRow>();
    if (data) return data;
  }

  const { data } = await supabase.from("shop_orders").select(select).eq("slug", key).maybeSingle<ShopOrderRow>();
  return data ?? null;
}

async function getShopOrderIdentityByKey(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  key: string,
) {
  const select = "id, public_token, slug, customer_name, customer_email";

  if (isUuid(key)) {
    const { data } = await supabase.from("shop_orders").select(select).eq("public_token", key).maybeSingle<{
      id: string;
      public_token: string;
      slug: string | null;
      customer_name: string;
      customer_email: string;
    }>();
    if (data) return data;
  }

  const { data } = await supabase.from("shop_orders").select(select).eq("slug", key).maybeSingle<{
    id: string;
    public_token: string;
    slug: string | null;
    customer_name: string;
    customer_email: string;
  }>();
  return data ?? null;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-stone-200 bg-stone-50 p-3">
      <p className="text-xs uppercase tracking-[0.14em] text-stone-500">{label}</p>
      <p className="mt-2 text-base font-semibold text-stone-900">{value}</p>
    </div>
  );
}

function TransportOverview({ order }: { order: ShopOrderRow }) {
  const activeIndex = transportStepState(order.transport_status);
  const trackingHref = order.tracking_url?.startsWith("https://") || order.tracking_url?.startsWith("http://")
    ? order.tracking_url
    : null;

  return (
    <section className="border border-stone-200 bg-white p-4 shadow-[0_8px_24px_rgba(32,25,15,0.05)] sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Transportoversikt</h2>
          <p className="mt-1 text-sm text-stone-600">{SHOP_ORDER_TRANSPORT_LABELS[order.transport_status]}</p>
        </div>
        {trackingHref ? (
          <Link href={trackingHref} className="inline-flex h-9 items-center justify-center rounded-md bg-stone-900 px-4 text-xs font-semibold text-white">
            Spor sending
          </Link>
        ) : null}
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-5">
        {SHOP_ORDER_TRANSPORT_STEPS.map((step, index) => {
          const done = activeIndex >= index;
          return (
            <div key={step} className="border border-stone-200 bg-stone-50 p-3">
              <div className={`mb-2 h-1.5 w-full ${done ? "bg-emerald-500" : "bg-stone-200"}`} />
              <p className={`text-xs font-semibold ${done ? "text-stone-900" : "text-stone-500"}`}>{SHOP_ORDER_TRANSPORT_LABELS[step]}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <InfoPill label="Transportør" value={order.carrier || "Ikke satt"} />
        <InfoPill label="Sporingsnummer" value={order.tracking_number || "Ikke satt"} />
        <InfoPill label="Estimert levering" value={order.estimated_delivery_date ? formatDate(order.estimated_delivery_date) : "Ikke satt"} />
        <InfoPill label="Sendt" value={order.shipped_at ? formatDate(order.shipped_at) : "Ikke sendt"} />
      </div>
      {order.last_status_note ? <p className="mt-3 border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">{order.last_status_note}</p> : null}
    </section>
  );
}

function SupportPanel({
  orderKey,
  messages,
  action,
}: {
  orderKey: string;
  messages: ShopOrderMessageRow[];
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="border border-stone-200 bg-white p-4 shadow-[0_8px_24px_rgba(32,25,15,0.05)] sm:p-5">
      <h2 className="text-lg font-semibold text-stone-900">Support</h2>
      <div className="mt-3 space-y-2">
        {messages.length === 0 ? (
          <p className="border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-stone-500">Ingen meldinger ennå.</p>
        ) : (
          messages.map((message) => (
            <article key={message.id} className={`border p-3 ${message.author_type === "admin" ? "border-emerald-200 bg-emerald-50" : "border-stone-200 bg-stone-50"}`}>
              <div className="flex items-center justify-between gap-3 text-xs text-stone-500">
                <span className="font-semibold text-stone-700">{message.author_name}</span>
                <span>{formatDateTime(message.created_at)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700">{message.body}</p>
            </article>
          ))
        )}
      </div>
      <form action={action} className="mt-4 space-y-2">
        <input type="hidden" name="orderKey" value={orderKey} />
        <textarea
          name="message"
          required
          minLength={2}
          maxLength={2000}
          rows={3}
          placeholder="Skriv til support om levering, endringer eller spørsmål."
          className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-900"
        />
        <button type="submit" className="inline-flex h-9 items-center rounded-md bg-stone-900 px-4 text-xs font-semibold text-white hover:bg-stone-800">
          Send melding
        </button>
      </form>
    </section>
  );
}

function EventLog({ events }: { events: ShopOrderEventRow[] }) {
  return (
    <section className="border border-stone-200 bg-white p-4 shadow-[0_8px_24px_rgba(32,25,15,0.05)] sm:p-5">
      <h2 className="text-lg font-semibold text-stone-900">Logg</h2>
      <div className="mt-3 space-y-2">
        {events.length === 0 ? (
          <p className="border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-stone-500">Ingen synlige hendelser ennå.</p>
        ) : (
          events.map((event) => (
            <article key={event.id} className="border border-stone-200 bg-stone-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-stone-900">{event.message || event.event_type}</p>
                <p className="text-xs text-stone-500">{formatDateTime(event.created_at)}</p>
              </div>
              {event.actor_label ? <p className="mt-1 text-xs text-stone-500">{event.actor_label}</p> : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-stone-200 bg-stone-50 px-3 py-2">
      <p className="text-xs uppercase tracking-[0.12em] text-stone-500">{label}</p>
      <p className="mt-1 font-semibold text-stone-900">{value}</p>
    </div>
  );
}

function SummaryLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-3 py-2 ${strong ? "bg-white text-stone-900" : "bg-white/6 text-white"}`}>
      <span className={`text-xs ${strong ? "text-stone-500" : "text-stone-300"}`}>{label}</span>
      <span className={`font-mono text-sm ${strong ? "font-semibold" : "font-medium"}`}>{value}</span>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("nb-NO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}