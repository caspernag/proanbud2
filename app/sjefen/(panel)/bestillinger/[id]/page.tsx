import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { requireAdminUser } from "@/lib/admin-auth";
import {
  isShopOrderStatus,
  isShopOrderTransportStatus,
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

type PageProps = {
  params: Promise<{ id: string }>;
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
  checkout_session_id: string | null;
  payment_intent_id: string | null;
  created_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
};

type ShopItem = {
  id: string;
  product_id: string;
  product_name: string;
  supplier_name: string;
  nobb_number: string;
  quantity: number;
  unit: string;
  unit_price_nok: number;
  line_total_nok: number;
};

type ShopMessage = {
  id: string;
  author_type: "customer" | "admin";
  author_name: string;
  body: string;
  created_at: string;
};

type ShopEvent = {
  id: string;
  event_type: string;
  actor_type: "system" | "admin" | "customer";
  actor_label: string | null;
  message: string;
  payload: Record<string, unknown>;
  is_customer_visible: boolean;
  created_at: string;
};

const STATUS_OPTIONS: ShopOrderStatus[] = ["draft", "pending_payment", "paid", "fulfilled", "cancelled", "failed"];
const TRANSPORT_OPTIONS: ShopOrderTransportStatus[] = ["pending", ...SHOP_ORDER_TRANSPORT_STEPS, "cancelled"];

export default async function SjefenBestillingDetaljPage({ params }: PageProps) {
  await requireAdminUser();

  const { id } = await params;
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return <div className="p-8 text-sm text-stone-600">Database ikke konfigurert.</div>;
  }

  const { data: order } = await supabase
    .from("shop_orders")
    .select("id, public_token, slug, status, transport_status, carrier, tracking_number, tracking_url, estimated_delivery_date, shipped_at, delivered_at, last_status_note, customer_email, customer_name, customer_phone, shipping_address_line1, shipping_postal_code, shipping_city, customer_note, subtotal_nok, shipping_nok, vat_nok, total_nok, checkout_session_id, payment_intent_id, created_at, paid_at, fulfilled_at")
    .eq("id", id)
    .maybeSingle<ShopOrderRow>();

  if (!order) {
    notFound();
  }

  async function updateOrder(formData: FormData) {
    "use server";

    await requireAdminUser();
    const admin = createSupabaseAdminClient();
    if (!admin) return;

    const orderId = String(formData.get("orderId") ?? "").trim();
    const statusRaw = String(formData.get("status") ?? "").trim();
    const transportRaw = String(formData.get("transportStatus") ?? "").trim();
    const carrier = nullIfBlank(formData.get("carrier"));
    const trackingNumber = nullIfBlank(formData.get("trackingNumber"));
    const trackingUrl = nullIfBlank(formData.get("trackingUrl"));
    const estimatedDeliveryDate = nullIfBlank(formData.get("estimatedDeliveryDate"));
    const statusNote = String(formData.get("statusNote") ?? "").trim();

    if (!orderId || !isShopOrderStatus(statusRaw) || !isShopOrderTransportStatus(transportRaw)) return;

    const timestamp = new Date().toISOString();
    const nextStatus = transportRaw === "delivered" ? "fulfilled" : transportRaw === "cancelled" ? "cancelled" : statusRaw;
    const update: {
      status: ShopOrderStatus;
      transport_status: ShopOrderTransportStatus;
      carrier: string | null;
      tracking_number: string | null;
      tracking_url: string | null;
      estimated_delivery_date: string | null;
      last_status_note: string;
      shipped_at?: string;
      delivered_at?: string;
      fulfilled_at?: string;
    } = {
      status: nextStatus,
      transport_status: transportRaw,
      carrier,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      estimated_delivery_date: estimatedDeliveryDate,
      last_status_note: statusNote,
    };

    if (transportRaw === "shipped" || transportRaw === "out_for_delivery" || transportRaw === "delivered") {
      update.shipped_at = timestamp;
    }

    if (transportRaw === "delivered") {
      update.delivered_at = timestamp;
      update.fulfilled_at = timestamp;
    }

    const { error } = await admin.from("shop_orders").update(update).eq("id", orderId);
    if (error) return;

    await logShopOrderEvent(admin, {
      orderId,
      eventType: "admin_order_updated",
      actorType: "admin",
      actorLabel: "Sjefen",
      message: statusNote || `Status oppdatert til ${SHOP_ORDER_TRANSPORT_LABELS[transportRaw]}.`,
      payload: {
        status: nextStatus,
        transportStatus: transportRaw,
        carrier,
        trackingNumber,
        estimatedDeliveryDate,
      },
    });

    revalidatePath(`/sjefen/bestillinger/${orderId}`);
    revalidatePath("/sjefen/bestillinger");
  }

  async function sendAdminMessage(formData: FormData) {
    "use server";

    await requireAdminUser();
    const admin = createSupabaseAdminClient();
    if (!admin) return;

    const orderId = String(formData.get("orderId") ?? "").trim();
    const body = String(formData.get("message") ?? "").trim();

    if (!orderId || body.length < 2 || body.length > 2000) return;

    await admin.from("shop_order_messages").insert({
      order_id: orderId,
      author_type: "admin",
      author_name: "ProAnbud support",
      author_email: null,
      body,
    });

    await logShopOrderEvent(admin, {
      orderId,
      eventType: "admin_message_created",
      actorType: "admin",
      actorLabel: "ProAnbud support",
      message: "Support svarte kunden.",
      payload: { messageLength: body.length },
    });

    revalidatePath(`/sjefen/bestillinger/${orderId}`);
  }

  const [{ data: items }, { data: messages }, { data: events }] = await Promise.all([
    supabase
      .from("shop_order_items")
      .select("id, product_id, product_name, supplier_name, nobb_number, quantity, unit, unit_price_nok, line_total_nok")
      .eq("order_id", order.id)
      .order("supplier_name")
      .returns<ShopItem[]>(),
    supabase
      .from("shop_order_messages")
      .select("id, author_type, author_name, body, created_at")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true })
      .returns<ShopMessage[]>(),
    supabase
      .from("shop_order_events")
      .select("id, event_type, actor_type, actor_label, message, payload, is_customer_visible, created_at")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<ShopEvent[]>(),
  ]);

  const resolvedItems = await withResolvedShopOrderUnits(items ?? []);

  const orderKey = order.slug ?? order.public_token;
  const activeIndex = transportStepState(order.transport_status);

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link href="/sjefen/bestillinger?type=shop" className="text-xs font-semibold text-stone-500 hover:text-stone-900">
            Tilbake til bestillinger
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-stone-900">Butikkordre #{order.id.slice(0, 8)}</h1>
          <p className="mt-1 text-sm text-stone-500">{order.customer_name} · {order.customer_email}</p>
        </div>
        <Link href={`/ordre/${encodeURIComponent(orderKey)}`} className="inline-flex h-10 items-center justify-center rounded-lg border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 hover:border-stone-900">
          Åpne kundeside
        </Link>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        <Metric label="Ordrestatus" value={SHOP_ORDER_STATUS_LABELS[order.status]} />
        <Metric label="Transport" value={SHOP_ORDER_TRANSPORT_LABELS[order.transport_status]} />
        <Metric label="Total" value={formatCurrency(order.total_nok)} />
        <Metric label="Betalt" value={order.paid_at ? formatDate(order.paid_at) : "Ikke betalt"} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-stone-900">Transport</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-5">
              {SHOP_ORDER_TRANSPORT_STEPS.map((step, index) => (
                <div key={step} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
                  <div className={`mb-2 h-1 rounded-full ${activeIndex >= index ? "bg-emerald-500" : "bg-stone-200"}`} />
                  <p className="text-[11px] font-semibold text-stone-700">{SHOP_ORDER_TRANSPORT_LABELS[step]}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-stone-900">Varer</h2>
            <div className="mt-3 divide-y divide-stone-100">
              {resolvedItems.map((item) => (
                <div key={item.id} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_110px_120px] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-stone-900">{item.product_name}</p>
                    <p className="text-xs text-stone-500">{item.supplier_name} · {item.nobb_number}</p>
                  </div>
                  <p className="text-sm text-stone-600">{item.quantity} {item.unit}</p>
                  <p className="text-right text-sm font-semibold text-stone-900">{formatCurrency(item.line_total_nok)}</p>
                </div>
              ))}
            </div>
          </div>

          <SupportThread orderId={order.id} messages={messages ?? []} action={sendAdminMessage} />
          <EventLog events={events ?? []} />
        </div>

        <aside className="space-y-6">
          <form action={updateOrder} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <input type="hidden" name="orderId" value={order.id} />
            <h2 className="text-sm font-semibold text-stone-900">Oppdater ordre</h2>
            <div className="mt-4 space-y-3">
              <SelectField name="status" label="Ordrestatus" defaultValue={order.status} options={STATUS_OPTIONS.map((status) => ({ value: status, label: SHOP_ORDER_STATUS_LABELS[status] }))} />
              <SelectField name="transportStatus" label="Transportstatus" defaultValue={order.transport_status} options={TRANSPORT_OPTIONS.map((status) => ({ value: status, label: SHOP_ORDER_TRANSPORT_LABELS[status] }))} />
              <TextField name="carrier" label="Transportør" defaultValue={order.carrier ?? ""} />
              <TextField name="trackingNumber" label="Sporingsnummer" defaultValue={order.tracking_number ?? ""} />
              <TextField name="trackingUrl" label="Sporingslenke" defaultValue={order.tracking_url ?? ""} />
              <TextField name="estimatedDeliveryDate" label="Estimert levering" type="date" defaultValue={order.estimated_delivery_date ?? ""} />
              <label className="block text-xs font-semibold text-stone-600">
                Statusnotat
                <textarea name="statusNote" rows={3} defaultValue={order.last_status_note} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-normal text-stone-900 outline-none focus:border-stone-900" />
              </label>
              <button type="submit" className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-stone-900 px-4 text-sm font-semibold text-white hover:bg-stone-800">
                Lagre status
              </button>
            </div>
          </form>

          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-stone-900">Kunde og levering</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <InfoRow label="Navn" value={order.customer_name} />
              <InfoRow label="E-post" value={order.customer_email} />
              <InfoRow label="Telefon" value={order.customer_phone ?? "-"} />
              <InfoRow label="Adresse" value={order.shipping_address_line1} />
              <InfoRow label="Sted" value={`${order.shipping_postal_code} ${order.shipping_city}`} />
              <InfoRow label="Stripe session" value={order.checkout_session_id ?? "-"} />
              <InfoRow label="Payment intent" value={order.payment_intent_id ?? "-"} />
            </dl>
          </div>
        </aside>
      </section>
    </div>
  );
}

function nullIfBlank(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-stone-900">{value}</p>
    </div>
  );
}

function SelectField({ name, label, defaultValue, options }: { name: string; label: string; defaultValue: string; options: { value: string; label: string }[] }) {
  return (
    <label className="block text-xs font-semibold text-stone-600">
      {label}
      <select name={name} defaultValue={defaultValue} className="mt-1 h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm font-normal text-stone-900 outline-none focus:border-stone-900">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function TextField({ name, label, defaultValue, type = "text" }: { name: string; label: string; defaultValue: string; type?: string }) {
  return (
    <label className="block text-xs font-semibold text-stone-600">
      {label}
      <input name={name} type={type} defaultValue={defaultValue} className="mt-1 h-10 w-full rounded-lg border border-stone-300 px-3 text-sm font-normal text-stone-900 outline-none focus:border-stone-900" />
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-stone-100 pb-2 last:border-0 last:pb-0">
      <dt className="text-stone-500">{label}</dt>
      <dd className="max-w-[220px] text-right font-medium text-stone-900 break-words">{value}</dd>
    </div>
  );
}

function SupportThread({ orderId, messages, action }: { orderId: string; messages: ShopMessage[]; action: (formData: FormData) => Promise<void> }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-stone-900">Support</h2>
      <div className="mt-3 space-y-2">
        {messages.length === 0 ? <p className="rounded-xl bg-stone-50 px-3 py-3 text-sm text-stone-500">Ingen meldinger.</p> : null}
        {messages.map((message) => (
          <article key={message.id} className={`rounded-xl border px-3 py-2 ${message.author_type === "admin" ? "border-emerald-200 bg-emerald-50" : "border-stone-200 bg-stone-50"}`}>
            <div className="flex items-center justify-between gap-3 text-xs text-stone-500">
              <span className="font-semibold text-stone-700">{message.author_name}</span>
              <span>{new Date(message.created_at).toLocaleString("nb-NO")}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-stone-700">{message.body}</p>
          </article>
        ))}
      </div>
      <form action={action} className="mt-4 space-y-2">
        <input type="hidden" name="orderId" value={orderId} />
        <textarea name="message" required minLength={2} maxLength={2000} rows={3} className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900" placeholder="Svar kunden." />
        <button type="submit" className="inline-flex h-9 items-center rounded-lg bg-stone-900 px-4 text-xs font-semibold text-white hover:bg-stone-800">
          Send svar
        </button>
      </form>
    </div>
  );
}

function EventLog({ events }: { events: ShopEvent[] }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-stone-900">Logg</h2>
      <div className="mt-3 space-y-2">
        {events.length === 0 ? <p className="rounded-xl bg-stone-50 px-3 py-3 text-sm text-stone-500">Ingen hendelser.</p> : null}
        {events.map((event) => (
          <article key={event.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-stone-900">{event.message || event.event_type}</p>
              <p className="text-xs text-stone-500">{new Date(event.created_at).toLocaleString("nb-NO")}</p>
            </div>
            <p className="mt-1 text-xs text-stone-500">
              {event.actor_label ?? event.actor_type} · {event.is_customer_visible ? "Synlig for kunde" : "Intern"}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
}