import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import {
  isUuid,
  logShopOrderEvent,
  SHOP_ORDER_TRANSPORT_LABELS,
  SHOP_ORDER_TRANSPORT_STEPS,
  transportStepState,
  type ShopOrderTransportStatus,
} from "@/lib/shop-order";
import { withResolvedShopOrderUnits } from "@/lib/shop-order-units";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";

type PageProps = { params: Promise<{ slug: string }> };

type MatOrder = {
  id: string;
  project_id: string;
  status: "draft" | "pending_payment" | "paid" | "submitted" | "cancelled" | "failed";
  total_nok: number;
  subtotal_nok: number;
  delivery_fee_nok: number;
  vat_nok: number;
  delivery_mode: "delivery" | "pickup";
  created_at: string;
  paid_at: string | null;
  submitted_at: string | null;
  earliest_delivery_date: string | null;
  latest_delivery_date: string | null;
};

type MatItem = {
  id: string;
  product_name: string;
  supplier_label: string;
  quantity: number;
  unit_price_nok: number;
  total_price_nok: number;
  unit: string;
  is_included: boolean;
};

type ShopOrder = {
  id: string;
  public_token: string;
  slug: string | null;
  status: "draft" | "pending_payment" | "paid" | "fulfilled" | "cancelled" | "failed";
  transport_status: ShopOrderTransportStatus;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  estimated_delivery_date: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  last_status_note: string;
  total_nok: number;
  subtotal_nok: number;
  shipping_nok: number;
  vat_nok: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  shipping_address_line1: string;
  shipping_postal_code: string;
  shipping_city: string;
  customer_note: string;
  created_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
};

type ShopItem = {
  id: string;
  product_id: string;
  product_name: string;
  supplier_name: string;
  quantity: number;
  unit_price_nok: number;
  line_total_nok: number;
  unit: string;
  nobb_number: string;
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
  actor_label: string | null;
  message: string;
  created_at: string;
};

function fmtDate(v: string) {
  return new Date(v).toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
}

const MAT_STATUS: Record<MatOrder["status"], { label: string; cls: string }> = {
  draft:           { label: "Kladd",          cls: "bg-stone-100 text-stone-700" },
  pending_payment: { label: "Venter betaling", cls: "bg-amber-100 text-amber-800" },
  paid:            { label: "Betalt",          cls: "bg-emerald-100 text-emerald-800" },
  submitted:       { label: "Sendt",           cls: "bg-sky-100 text-sky-800" },
  cancelled:       { label: "Avbrutt",         cls: "bg-rose-100 text-rose-800" },
  failed:          { label: "Feilet",          cls: "bg-red-100 text-red-800" },
};

const SHOP_STATUS: Record<ShopOrder["status"], { label: string; cls: string }> = {
  draft:           { label: "Kladd",          cls: "bg-stone-100 text-stone-700" },
  pending_payment: { label: "Venter betaling", cls: "bg-amber-100 text-amber-800" },
  paid:            { label: "Betalt",          cls: "bg-emerald-100 text-emerald-800" },
  fulfilled:       { label: "Levert",          cls: "bg-emerald-100 text-emerald-800" },
  cancelled:       { label: "Avbrutt",         cls: "bg-rose-100 text-rose-800" },
  failed:          { label: "Feilet",          cls: "bg-red-100 text-red-800" },
};

const STEP_LABELS = ["Mottatt", "Betalt", "Sendt", "Levert"];

export default async function BestillingDetaljPage({ params }: PageProps) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-stone-800">
        Database ikke konfigurert.
      </p>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/min-side/bestillinger/${slug}`)}`);

  const { data: matData } = await supabase
    .from("material_orders")
    .select(
      "id, project_id, status, total_nok, subtotal_nok, delivery_fee_nok, vat_nok, delivery_mode, created_at, paid_at, submitted_at, earliest_delivery_date, latest_delivery_date",
    )
    .eq("id", slug)
    .eq("user_id", user.id)
    .maybeSingle();

  if (matData) {
    const [{ data: projectData }, { data: itemRows }] = await Promise.all([
      supabase
        .from("projects")
        .select("id, title")
        .eq("id", (matData as MatOrder).project_id)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("material_order_items")
        .select("id, product_name, supplier_label, quantity, unit_price_nok, total_price_nok, unit, is_included")
        .eq("order_id", matData.id)
        .eq("user_id", user.id)
        .eq("is_included", true)
        .order("supplier_label"),
    ]);

    const order = matData as MatOrder;
    const project = projectData as { title: string } | null;
    const items = (itemRows ?? []) as MatItem[];
    const pill = MAT_STATUS[order.status];
    const paid = order.status === "paid" || order.status === "submitted";
    const sent = order.status === "submitted";
    const steps: (0 | 1)[] = [1, paid ? 1 : 0, sent ? 1 : 0, 0];
    const windowLabel =
      order.earliest_delivery_date && order.latest_delivery_date
        ? `${fmtDate(order.earliest_delivery_date)} \u2013 ${fmtDate(order.latest_delivery_date)}`
        : order.delivery_mode === "pickup"
          ? "Henting i butikk"
          : "Ikke satt";

    return (
      <div className="space-y-4">
        <OrderHeader
          title={project?.title ?? "Materialliste"}
          orderId={order.id}
          type="Materialliste"
          typeColor="bg-blue-100 text-blue-700"
          pill={pill}
        />
        <TrackingBar steps={steps} />
        <div className="grid gap-4 lg:grid-cols-2">
          <InfoCard title="Ordreinformasjon">
            <Row label="Ordrenummer" value={`#${order.id.slice(0, 8)}`} />
            <Row label="Opprettet" value={fmtDate(order.created_at)} />
            {order.paid_at ? <Row label="Betalt" value={fmtDate(order.paid_at)} /> : null}
            {order.submitted_at ? <Row label="Sendt til partner" value={fmtDate(order.submitted_at)} /> : null}
            <Row label="Leveringstype" value={order.delivery_mode === "delivery" ? "Levering til adresse" : "Henting i butikk"} />
            <Row label="Estimert levering" value={windowLabel} />
          </InfoCard>
          <PriceCard subtotal={order.subtotal_nok} delivery={order.delivery_fee_nok} vat={order.vat_nok} total={order.total_nok} deliveryLabel="Fraktkostnad" />
        </div>
        {items.length > 0 ? (
          <section className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
            <div className="border-b border-stone-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-stone-900">Produkter ({items.length})</h2>
            </div>
            <ul className="divide-y divide-stone-100">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-stone-900 truncate">{item.product_name}</p>
                    <p className="text-xs text-stone-500">{item.supplier_label}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-stone-900 tabular-nums">{formatCurrency(item.total_price_nok)}</p>
                    <p className="text-xs text-stone-400">{item.quantity} {item.unit} \xd7 {formatCurrency(item.unit_price_nok)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {(order.status === "paid" || order.status === "submitted") ? (
          <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-xs text-stone-600">Ønsker du å returnere noe fra denne bestillingen?</p>
            <Link href={`/min-side/retur?order=${order.id}`} className="shrink-0 inline-flex h-8 items-center rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700 hover:bg-stone-100">
              Start retur
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  const shopOrderClient = createSupabaseAdminClient() ?? supabase;
  const shopOrderFilter = isUuid(slug)
    ? `id.eq.${slug},public_token.eq.${slug},slug.eq.${slug}`
    : `slug.eq.${slug}`;
  const { data: shopData } = await shopOrderClient
    .from("shop_orders")
    .select(
      "id, public_token, slug, status, transport_status, carrier, tracking_number, tracking_url, estimated_delivery_date, shipped_at, delivered_at, last_status_note, total_nok, subtotal_nok, shipping_nok, vat_nok, customer_name, customer_email, customer_phone, shipping_address_line1, shipping_postal_code, shipping_city, customer_note, created_at, paid_at, fulfilled_at",
    )
    .or(shopOrderFilter)
    .eq("customer_email", user.email!)
    .maybeSingle();

  if (shopData) {
    const order = shopData as ShopOrder;
    const [{ data: itemRows }, { data: messageRows }, { data: eventRows }] = await Promise.all([
      supabase
        .from("shop_order_items")
        .select("id, product_id, product_name, supplier_name, quantity, unit_price_nok, line_total_nok, unit, nobb_number")
        .eq("order_id", order.id)
        .order("supplier_name"),
      supabase
        .from("shop_order_messages")
        .select("id, author_type, author_name, body, created_at")
        .eq("order_id", order.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("shop_order_events")
        .select("id, event_type, actor_label, message, created_at")
        .eq("order_id", order.id)
        .eq("is_customer_visible", true)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    async function sendSupportMessage(formData: FormData) {
      "use server";

      const body = String(formData.get("message") ?? "").trim();
      const orderId = String(formData.get("orderId") ?? "").trim();

      if (!orderId || body.length < 2 || body.length > 2000) return;

      const server = await createSupabaseServerClient();
      const admin = createSupabaseAdminClient();
      if (!server || !admin) return;

      const { data: authData } = await server.auth.getUser();
      const currentUser = authData.user;
      if (!currentUser?.email) return;

      const { data: targetOrder } = await admin
        .from("shop_orders")
        .select("id, customer_name, customer_email")
        .eq("id", orderId)
        .eq("customer_email", currentUser.email)
        .maybeSingle<{ id: string; customer_name: string; customer_email: string }>();

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

      revalidatePath(`/min-side/bestillinger/${targetOrder.id}`);
    }

    const items = await withResolvedShopOrderUnits((itemRows ?? []) as ShopItem[]);
    const messages = (messageRows ?? []) as ShopMessage[];
    const events = (eventRows ?? []) as ShopEvent[];
    const pill = SHOP_STATUS[order.status];
    const paid = order.status === "paid" || order.status === "fulfilled";
    const delivered = order.status === "fulfilled";
    const steps: (0 | 1)[] = [1, paid ? 1 : 0, paid ? 1 : 0, delivered ? 1 : 0];
    const orderKey = order.slug ?? order.public_token ?? order.id;

    return (
      <div className="space-y-4">
        <OrderHeader
          title="Nettbutikkbestilling"
          orderId={orderKey}
          type="Nettbutikk"
          typeColor="bg-violet-100 text-violet-700"
          pill={pill}
        />
        <TrackingBar steps={steps} />
        <ShopTransportCard order={order} />
        <div className="grid gap-4 lg:grid-cols-2">
          <InfoCard title="Leveringsinformasjon">
            <Row label="Mottaker" value={order.customer_name} />
            <Row label="E-post" value={order.customer_email} />
            {order.customer_phone ? <Row label="Telefon" value={order.customer_phone} /> : null}
            <Row label="Adresse" value={order.shipping_address_line1} />
            <Row label="Sted" value={`${order.shipping_postal_code} ${order.shipping_city}`} />
            {order.customer_note ? <Row label="Merknad" value={order.customer_note} /> : null}
          </InfoCard>
          <div className="space-y-4">
            <InfoCard title="Ordreinfo">
              <Row label="Ordrenummer" value={`#${order.id.slice(0, 8)}`} />
              <Row label="Opprettet" value={fmtDate(order.created_at)} />
              {order.paid_at ? <Row label="Betalt" value={fmtDate(order.paid_at)} /> : null}
              {order.fulfilled_at ? <Row label="Levert" value={fmtDate(order.fulfilled_at)} /> : null}
            </InfoCard>
            <PriceCard subtotal={order.subtotal_nok} delivery={order.shipping_nok} vat={order.vat_nok} total={order.total_nok} deliveryLabel="Frakt" />
          </div>
        </div>
        {items.length > 0 ? (
          <section className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
            <div className="border-b border-stone-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-stone-900">Produkter ({items.length})</h2>
            </div>
            <ul className="divide-y divide-stone-100">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-stone-900 truncate">{item.product_name}</p>
                    <p className="text-xs text-stone-500">{item.supplier_name} \xb7 Art.nr {item.nobb_number}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-stone-900 tabular-nums">{formatCurrency(item.line_total_nok)}</p>
                    <p className="text-xs text-stone-400">{item.quantity} {item.unit} \xd7 {formatCurrency(item.unit_price_nok)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <ShopSupportCard orderId={order.id} messages={messages} action={sendSupportMessage} />
        <ShopEventLog events={events} />
      </div>
    );
  }

  notFound();
}

function ShopTransportCard({ order }: { order: ShopOrder }) {
  const activeIndex = transportStepState(order.transport_status);
  const trackingHref = order.tracking_url?.startsWith("https://") || order.tracking_url?.startsWith("http://")
    ? order.tracking_url
    : null;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-stone-900">Transportoversikt</h2>
          <p className="mt-1 text-xs text-stone-500">{SHOP_ORDER_TRANSPORT_LABELS[order.transport_status]}</p>
        </div>
        {trackingHref ? (
          <Link href={trackingHref} className="inline-flex h-8 items-center rounded-lg bg-stone-900 px-3 text-xs font-semibold text-white hover:bg-stone-800">
            Spor sending
          </Link>
        ) : null}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-5">
        {SHOP_ORDER_TRANSPORT_STEPS.map((step, index) => {
          const done = activeIndex >= index;
          return (
            <div key={step} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
              <div className={`mb-2 h-1 w-full rounded-full ${done ? "bg-emerald-500" : "bg-stone-200"}`} />
              <p className={`text-[11px] font-semibold ${done ? "text-stone-900" : "text-stone-500"}`}>{SHOP_ORDER_TRANSPORT_LABELS[step]}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <MiniInfo label="Transportør" value={order.carrier || "Ikke satt"} />
        <MiniInfo label="Sporingsnr." value={order.tracking_number || "Ikke satt"} />
        <MiniInfo label="Estimert" value={order.estimated_delivery_date ? fmtDate(order.estimated_delivery_date) : "Ikke satt"} />
        <MiniInfo label="Sendt" value={order.shipped_at ? fmtDate(order.shipped_at) : "Ikke sendt"} />
      </div>
      {order.last_status_note ? <p className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">{order.last_status_note}</p> : null}
    </section>
  );
}

function ShopSupportCard({
  orderId,
  messages,
  action,
}: {
  orderId: string;
  messages: ShopMessage[];
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white px-5 py-4">
      <h2 className="text-sm font-semibold text-stone-900">Support</h2>
      <div className="mt-3 space-y-2">
        {messages.length === 0 ? (
          <p className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-stone-500">Ingen meldinger ennå.</p>
        ) : (
          messages.map((message) => (
            <article key={message.id} className={`rounded-xl border px-3 py-2 ${message.author_type === "admin" ? "border-emerald-200 bg-emerald-50" : "border-stone-200 bg-stone-50"}`}>
              <div className="flex items-center justify-between gap-3 text-xs text-stone-500">
                <span className="font-semibold text-stone-700">{message.author_name}</span>
                <span>{new Date(message.created_at).toLocaleString("nb-NO")}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-stone-700">{message.body}</p>
            </article>
          ))
        )}
      </div>
      <form action={action} className="mt-4 space-y-2">
        <input type="hidden" name="orderId" value={orderId} />
        <textarea name="message" required minLength={2} maxLength={2000} rows={3} className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900" placeholder="Skriv til support." />
        <button type="submit" className="inline-flex h-8 items-center rounded-lg bg-stone-900 px-3 text-xs font-semibold text-white hover:bg-stone-800">
          Send melding
        </button>
      </form>
    </section>
  );
}

function ShopEventLog({ events }: { events: ShopEvent[] }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white px-5 py-4">
      <h2 className="text-sm font-semibold text-stone-900">Logg</h2>
      <div className="mt-3 space-y-2">
        {events.length === 0 ? (
          <p className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3 text-sm text-stone-500">Ingen synlige hendelser ennå.</p>
        ) : (
          events.map((event) => (
            <article key={event.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-stone-900">{event.message || event.event_type}</p>
                <p className="text-xs text-stone-500">{new Date(event.created_at).toLocaleString("nb-NO")}</p>
              </div>
              {event.actor_label ? <p className="mt-1 text-xs text-stone-500">{event.actor_label}</p> : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function MiniInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-stone-500">{label}</p>
      <p className="mt-1 font-semibold text-stone-900">{value}</p>
    </div>
  );
}

function OrderHeader({
  title, orderId, type, typeColor, pill,
}: {
  title: string; orderId: string; type: string; typeColor: string; pill: { label: string; cls: string };
}) {
  return (
    <div>
      <Link href="/min-side/bestillinger" className="text-xs text-stone-500 hover:text-stone-700">
        \u2190 Alle bestillinger
      </Link>
      <h1 className="mt-1 text-xl font-semibold text-stone-900">{title}</h1>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${pill.cls}`}>{pill.label}</span>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${typeColor}`}>{type}</span>
        <span className="text-xs text-stone-400">#{orderId.slice(0, 8)}</span>
      </div>
    </div>
  );
}

function TrackingBar({ steps }: { steps: (0 | 1)[] }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white px-5 py-4">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-stone-500">Fraktstatus</p>
      <div className="flex items-start">
        {steps.map((done, i) => (
          <div key={i} className="flex flex-1 items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full border-2 font-bold text-xs transition-colors ${done ? "border-emerald-500 bg-emerald-500 text-white" : "border-stone-300 bg-white text-stone-400"}`}>
                {done ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : i + 1}
              </div>
              <span className="whitespace-nowrap text-[10px] font-medium text-stone-500">{STEP_LABELS[i]}</span>
            </div>
            {i < steps.length - 1 ? (
              <div className={`mb-5 h-0.5 flex-1 mx-1 ${steps[i] && steps[i + 1] ? "bg-emerald-500" : "bg-stone-200"}`} />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white px-5 py-4">
      <h2 className="mb-3 text-sm font-semibold text-stone-900">{title}</h2>
      <dl className="space-y-2">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <dt className="shrink-0 text-stone-500">{label}</dt>
      <dd className="text-right font-medium text-stone-900">{value}</dd>
    </div>
  );
}

function PriceCard({ subtotal, delivery, vat, total, deliveryLabel }: {
  subtotal: number; delivery: number; vat: number; total: number; deliveryLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white px-5 py-4">
      <h2 className="mb-3 text-sm font-semibold text-stone-900">Prissammendrag</h2>
      <dl className="space-y-2">
        <Row label="Subtotal" value={formatCurrency(subtotal)} />
        <Row label={deliveryLabel} value={delivery === 0 ? "Gratis" : formatCurrency(delivery)} />
        <Row label="MVA (inkl.)" value={formatCurrency(vat)} />
        <div className="mt-2 border-t border-stone-100 pt-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-stone-900">Totalt</span>
            <span className="font-bold tabular-nums text-stone-900">{formatCurrency(total)}</span>
          </div>
        </div>
      </dl>
    </div>
  );
}
