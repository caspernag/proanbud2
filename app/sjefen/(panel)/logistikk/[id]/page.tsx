import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdminUser } from "@/lib/admin-auth";
import {
  SHOP_ORDER_STATUS_LABELS,
  SHOP_ORDER_TRANSPORT_LABELS,
  SHOP_ORDER_TRANSPORT_STEPS,
  transportStepState,
  type ShopOrderStatus,
  type ShopOrderTransportStatus,
} from "@/lib/shop-order";
import {
  CARRIERS,
  carrierLabel,
  detectOrderIssues,
  formatDateNo,
  formatDateTimeNo,
  formatHours,
  hoursInStage,
  nextTransportStatus,
  orderReference,
  resolveTrackingUrl,
  stageForTransportStatus,
  type LogisticsOrder,
} from "@/lib/shop-order-logistics";
import {
  fetchByggmakkerStates,
  LOGISTICS_ORDER_COLUMNS,
  parseByggmakkerEventType,
} from "@/lib/shop-order-logistics-admin";
import { calculateOrderEconomics } from "@/lib/order-economics";
import { getProductCostsByNobb } from "@/lib/product-costs";
import { withResolvedShopOrderUnits } from "@/lib/shop-order-units";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/utils";

import {
  advanceStageAction,
  resendByggmakkerAction,
  resendStatusEmailAction,
  saveInternalNoteAction,
  sendCustomerMessageAction,
} from "../actions";
import { ActionForm, SubmitButton } from "@/app/sjefen/_components/action-form";
import { LogisticsForm } from "../_components/logistics-form";
import { OrderEconomicsCard } from "../_components/order-economics-card";

const DETAIL_COLUMNS = `${LOGISTICS_ORDER_COLUMNS}, subtotal_nok, shipping_nok, vat_nok, checkout_session_id, payment_intent_id, fulfilled_at, customer_notified_at, goods_cost_nok, freight_cost_nok, other_cost_nok, cost_note`;

type DetailOrder = LogisticsOrder & {
  subtotal_nok: number;
  shipping_nok: number;
  vat_nok: number;
  checkout_session_id: string | null;
  payment_intent_id: string | null;
  fulfilled_at: string | null;
  customer_notified_at: string | null;
  goods_cost_nok: number | null;
  freight_cost_nok: number | null;
  other_cost_nok: number | null;
  cost_note: string;
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
  is_customer_visible: boolean;
  created_at: string;
};

const TRANSPORT_OPTIONS: ShopOrderTransportStatus[] = [
  "pending",
  ...SHOP_ORDER_TRANSPORT_STEPS,
  "cancelled",
];

const STATUS_OPTIONS: ShopOrderStatus[] = [
  "draft",
  "pending_payment",
  "paid",
  "fulfilled",
  "cancelled",
  "failed",
];

export default async function LogistikkOrdrePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminUser();

  const { id } = await params;
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return <div className="p-8 text-sm text-stone-600">Database ikke konfigurert.</div>;
  }

  const { data: order } = await supabase
    .from("shop_orders")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle<DetailOrder>();

  if (!order) {
    notFound();
  }

  const [{ data: items }, { data: messages }, { data: events }, byggmakkerStates] = await Promise.all([
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
      .select("id, event_type, actor_type, actor_label, message, is_customer_visible, created_at")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(60)
      .returns<ShopEvent[]>(),
    fetchByggmakkerStates(supabase, [order.id]),
  ]);

  const resolvedItems = await withResolvedShopOrderUnits(items ?? []);

  /* ── Lønnsomhet ──────────────────────────────────────────────────────────
   * Innkjøpsprisene leses fra katalogen (`cost_price_ex_vat_nok`) og er EKS.
   * mva, mens linjesummene på ordren er INKL. mva. calculateOrderEconomics
   * håndterer omregningen. Feiler oppslaget, vises kortet uten varekost framfor
   * at hele ordresiden feiler.                                            */
  let costByNobb = new Map<string, number>();
  try {
    costByNobb = await getProductCostsByNobb(
      supabase,
      (items ?? []).map((item) => item.nobb_number),
    );
  } catch (cause) {
    console.error("[sjefen] innkjøpspriser utilgjengelig for lønnsomhet:", cause);
  }

  const economics = calculateOrderEconomics(
    {
      subtotalNok: order.subtotal_nok,
      shippingNok: order.shipping_nok,
      totalNok: order.total_nok,
      goodsCostOverrideExVatNok: order.goods_cost_nok,
      freightCostExVatNok: order.freight_cost_nok,
      otherCostExVatNok: order.other_cost_nok,
    },
    (items ?? []).map((item) => ({
      id: item.id,
      nobbNumber: item.nobb_number,
      productName: item.product_name,
      quantity: item.quantity,
      unit: item.unit,
      lineTotalNok: item.line_total_nok,
      unitCostExVatNok: costByNobb.get(item.nobb_number) ?? null,
    })),
  );

  const now = new Date();
  const byggmakkerState = byggmakkerStates.get(order.id) ?? "none";
  const issues = detectOrderIssues(order, { byggmakkerState, now });
  const stage = stageForTransportStatus(order.transport_status);
  const hours = hoursInStage(order, now);
  const next = nextTransportStatus(order.transport_status);
  const activeIndex = transportStepState(order.transport_status);
  const trackingHref = resolveTrackingUrl({
    carrierCode: order.carrier_code,
    trackingNumber: order.tracking_number,
    trackingUrl: order.tracking_url,
  });
  const customerKey = order.slug ?? order.public_token;

  const stepTimestamps: Record<string, string | null> = {
    confirmed: order.confirmed_at,
    packing: order.packed_at,
    shipped: order.shipped_at,
    out_for_delivery: order.shipped_at,
    delivered: order.delivered_at,
  };

  return (
    <div className="space-y-6 p-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Link href="/sjefen/logistikk" className="text-xs font-semibold text-stone-500 hover:text-stone-900">
            ← Tilbake til logistikk
          </Link>
          <h1 className="mt-2 font-mono text-2xl font-bold text-stone-900">{orderReference(order)}</h1>
          <p className="mt-1 text-sm text-stone-500">
            {order.customer_name} · {order.customer_email}
            {order.customer_phone ? ` · ${order.customer_phone}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href={`/sjefen/logistikk/${order.id}/pakkseddel`}
            className="inline-flex h-10 items-center justify-center border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 hover:border-stone-900"
          >
            Pakkseddel
          </Link>
          <Link
            href={`/ordre/${encodeURIComponent(customerKey)}`}
            className="inline-flex h-10 items-center justify-center border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 hover:border-stone-900"
          >
            Kundeside
          </Link>
        </div>
      </header>

      {issues.length > 0 ? (
        <section className="space-y-2 border border-red-200 bg-red-50 p-4">
          <h2 className="text-sm font-bold text-red-800">Avvik på denne ordren</h2>
          <ul className="space-y-1.5">
            {issues.map((issue) => (
              <li key={issue.code} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    issue.severity === "high"
                      ? "bg-red-600 text-white"
                      : issue.severity === "medium"
                        ? "bg-[#d9ff7a] text-white"
                        : "bg-stone-300 text-stone-800"
                  }`}
                >
                  {issue.severity === "high" ? "Kritisk" : issue.severity === "medium" ? "Følg opp" : "Info"}
                </span>
                <span className="font-bold text-stone-900">{issue.label}</span>
                <span className="text-stone-600">{issue.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-3 md:grid-cols-5">
        <Metric label="Ordrestatus" value={SHOP_ORDER_STATUS_LABELS[order.status]} />
        <Metric label="Transport" value={SHOP_ORDER_TRANSPORT_LABELS[order.transport_status]} />
        <Metric
          label="Tid i steget"
          value={hours != null ? formatHours(hours) : "—"}
          tone={stage && hours != null && Number.isFinite(stage.slaHours) && hours > stage.slaHours ? "danger" : "neutral"}
        />
        <Metric label="Total" value={formatCurrency(order.total_nok)} />
        <Metric label="Betalt" value={order.paid_at ? formatDateNo(order.paid_at) : "Ikke betalt"} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          {/* Transportsporet */}
          <div className="border border-stone-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-stone-900">Hvor er pakken</h2>
              {next ? (
                <ActionForm action={advanceStageAction} className="flex items-center">
                  <input type="hidden" name="orderId" value={order.id} />
                  <input type="hidden" name="notifyCustomer" value="on" />
                  <SubmitButton
                    pendingLabel="Flytter …"
                    className="inline-flex h-9 items-center bg-[#d9ff7a] px-4 text-xs font-bold text-stone-900 hover:bg-[#c8f265]"
                  >
                    {stage?.actionLabel ?? "Neste steg"} →
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-5">
              {SHOP_ORDER_TRANSPORT_STEPS.map((step, index) => {
                const reached = activeIndex >= index;
                const at = stepTimestamps[step];
                return (
                  <div
                    key={step}
                    className={`border px-3 py-2.5 ${
                      activeIndex === index ? "border-stone-900 bg-stone-50" : "border-stone-200 bg-white"
                    }`}
                  >
                    <div className={`mb-2 h-1 rounded-full ${reached ? "bg-emerald-500" : "bg-stone-200"}`} />
                    <p className={`text-[11px] font-bold ${reached ? "text-stone-800" : "text-stone-400"}`}>
                      {SHOP_ORDER_TRANSPORT_LABELS[step]}
                    </p>
                    <p className="mt-0.5 text-[10px] text-stone-400">
                      {reached && at ? formatDateTimeNo(at) : reached ? "—" : "Ikke nådd"}
                    </p>
                  </div>
                );
              })}
            </div>

            <dl className="mt-4 grid gap-3 border-t border-stone-100 pt-4 sm:grid-cols-4">
              <Detail label="Transportør" value={carrierLabel(order.carrier_code, order.carrier) ?? "Ikke satt"} />
              <Detail label="Sporingsnummer" value={order.tracking_number ?? "Ikke satt"} mono />
              <Detail
                label="Estimert levering"
                value={order.estimated_delivery_date ? formatDateNo(order.estimated_delivery_date) : "Ikke satt"}
              />
              <Detail
                label="Kunde varslet"
                value={order.customer_notified_at ? formatDateTimeNo(order.customer_notified_at) : "Aldri"}
              />
            </dl>

            {trackingHref ? (
              <a
                href={trackingHref}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-3 inline-flex h-9 items-center border border-stone-300 px-4 text-xs font-semibold text-stone-800 hover:border-stone-900"
              >
                Åpne sporing hos transportør ↗
              </a>
            ) : null}
          </div>

          {/* Varelinjer */}
          <div className="border border-stone-200 bg-white p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-bold text-stone-900">Varer</h2>
              <span className="text-xs text-stone-400">{resolvedItems.length} linjer</span>
            </div>
            <div className="mt-3 divide-y divide-stone-100">
              {resolvedItems.map((item) => (
                <div key={item.id} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_110px_120px] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-stone-900">{item.product_name}</p>
                    <p className="text-xs text-stone-500">
                      {item.supplier_name} · NOBB {item.nobb_number}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-stone-700 tabular-nums">
                    {item.quantity} {item.unit}
                  </p>
                  <p className="text-right text-sm font-semibold text-stone-900 tabular-nums">
                    {formatCurrency(item.line_total_nok)}
                  </p>
                </div>
              ))}
            </div>
            <dl className="mt-3 space-y-1.5 border-t border-stone-200 pt-3 text-sm">
              <SumRow label="Varer" value={formatCurrency(order.subtotal_nok)} />
              <SumRow label="Frakt" value={order.shipping_nok === 0 ? "Gratis" : formatCurrency(order.shipping_nok)} />
              <SumRow label="MVA inkludert" value={formatCurrency(order.vat_nok)} />
              <SumRow label="Total" value={formatCurrency(order.total_nok)} strong />
            </dl>
          </div>

          <OrderEconomicsCard
            orderId={order.id}
            economics={economics}
            goodsCostNok={order.goods_cost_nok}
            freightCostNok={order.freight_cost_nok}
            otherCostNok={order.other_cost_nok}
            costNote={order.cost_note ?? ""}
          />

          <SupportThread orderId={order.id} messages={messages ?? []} />
          <EventLog events={events ?? []} />
        </div>

        <aside className="space-y-6">
          <LogisticsForm
            orderId={order.id}
            carriers={CARRIERS.map((carrier) => ({
              code: carrier.code,
              label: carrier.label,
              hasTracking: carrier.trackingUrl !== null,
            }))}
            transportOptions={TRANSPORT_OPTIONS.map((status) => ({
              value: status,
              label: SHOP_ORDER_TRANSPORT_LABELS[status],
            }))}
            statusOptions={STATUS_OPTIONS.map((status) => ({
              value: status,
              label: SHOP_ORDER_STATUS_LABELS[status],
            }))}
            defaults={{
              transportStatus: order.transport_status,
              orderStatus: order.status,
              carrierCode: order.carrier_code ?? "",
              trackingNumber: order.tracking_number ?? "",
              trackingUrl: order.tracking_url ?? "",
              estimatedDeliveryDate: order.estimated_delivery_date ?? "",
              statusNote: order.last_status_note ?? "",
            }}
          />

          <div className="border border-stone-200 bg-white p-5">
            <h2 className="text-sm font-bold text-stone-900">
              {order.pickup_store_name ? "Henting i butikk" : "Leveringsadresse"}
            </h2>
            <address className="mt-3 text-sm not-italic leading-6 text-stone-800">
              {order.customer_name}
              {order.pickup_store_name ? (
                <>
                  <br />
                  {order.pickup_store_name}
                  {order.pickup_store_id ? <><br />{order.pickup_store_id}</> : null}
                </>
              ) : (
                <>
                  <br />
                  {order.shipping_address_line1 ?? "—"}
                  <br />
                  {order.shipping_postal_code ?? ""} {order.shipping_city ?? ""}
                </>
              )}
              {order.customer_phone ? (
                <>
                  <br />
                  Tlf. {order.customer_phone}
                </>
              ) : null}
            </address>
            {order.customer_note?.trim() ? (
              <div className="mt-3 border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Beskjed fra kunden</p>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-stone-800">{order.customer_note}</p>
              </div>
            ) : null}
            <dl className="mt-3 space-y-2 border-t border-stone-100 pt-3 text-xs">
              <InfoRow label="Stripe session" value={order.checkout_session_id ?? "—"} />
              <InfoRow label="Payment intent" value={order.payment_intent_id ?? "—"} />
            </dl>
          </div>

          {/* Internt notat */}
          <ActionForm action={saveInternalNoteAction} className="border border-stone-200 bg-white p-5">
            <input type="hidden" name="orderId" value={order.id} />
            <h2 className="text-sm font-bold text-stone-900">Internt notat</h2>
            <p className="mt-0.5 text-xs text-stone-400">Vises aldri for kunden.</p>
            <textarea
              name="internalNote"
              rows={4}
              defaultValue={order.internal_note ?? ""}
              placeholder="Avtalt med sjåfør, avvik på lager, oppfølging …"
              className="mt-3 w-full border border-stone-300 px-3 py-2 text-sm text-stone-900 outline-none focus:border-[#163f2a]"
            />
            <SubmitButton
              pendingLabel="Lagrer …"
              className="mt-2 inline-flex h-9 items-center border border-stone-300 px-4 text-xs font-semibold text-stone-800 hover:border-stone-900"
            >
              Lagre notat
            </SubmitButton>
          </ActionForm>

          {/* Varsling */}
          <ActionForm action={resendStatusEmailAction} className="border border-stone-200 bg-white p-5">
            <input type="hidden" name="orderId" value={order.id} />
            <h2 className="text-sm font-bold text-stone-900">Statusvarsel</h2>
            <p className="mt-1 text-xs text-stone-500">
              Sender dagens status, transportør og sporing på nytt til {order.customer_email}.
            </p>
            <SubmitButton
              pendingLabel="Sender …"
              className="mt-3 inline-flex h-10 w-full items-center justify-center border border-stone-300 px-4 text-sm font-semibold text-stone-800 hover:border-stone-900"
            >
              Send statusvarsel på nytt
            </SubmitButton>
          </ActionForm>

          <ByggmakkerCard orderId={order.id} state={byggmakkerState} events={events ?? []} />
        </aside>
      </section>
    </div>
  );
}

/* ── Delkomponenter ─────────────────────────────────────────────────────── */

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "danger";
}) {
  return (
    <div className={`border p-4 ${tone === "danger" ? "border-red-200 bg-red-50" : "border-stone-200 bg-white"}`}>
      <p className="text-xs text-stone-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${tone === "danger" ? "text-red-700" : "text-stone-900"}`}>{value}</p>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-wide text-stone-400">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold text-stone-900 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

function SumRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className={strong ? "font-bold text-stone-900" : "text-stone-500"}>{label}</dt>
      <dd className={`tabular-nums ${strong ? "text-base font-bold text-stone-900" : "font-medium text-stone-700"}`}>
        {value}
      </dd>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-stone-500">{label}</dt>
      <dd className="max-w-[210px] truncate text-right font-mono text-stone-700" title={value}>
        {value}
      </dd>
    </div>
  );
}

function SupportThread({ orderId, messages }: { orderId: string; messages: ShopMessage[] }) {
  return (
    <div className="border border-stone-200 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-stone-900">Support</h2>
        <span className="text-xs text-stone-400">{messages.length} meldinger</span>
      </div>

      <div className="mt-3 space-y-2">
        {messages.length === 0 ? (
          <p className="bg-stone-50 px-3 py-3 text-sm text-stone-500">Ingen meldinger.</p>
        ) : null}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`border px-3 py-2 ${
              message.author_type === "admin" ? "border-emerald-200 bg-emerald-50" : "border-stone-200 bg-stone-50"
            }`}
          >
            <div className="flex items-center justify-between gap-3 text-xs text-stone-500">
              <span className="font-semibold text-stone-700">{message.author_name}</span>
              <span>{formatDateTimeNo(message.created_at)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-stone-700">{message.body}</p>
          </article>
        ))}
      </div>

      <ActionForm action={sendCustomerMessageAction} className="mt-4">
        <input type="hidden" name="orderId" value={orderId} />
        <textarea
          name="message"
          required
          minLength={2}
          maxLength={2000}
          rows={3}
          placeholder="Svar kunden."
          className="w-full border border-stone-300 px-3 py-2 text-sm outline-none focus:border-[#163f2a]"
        />
        <SubmitButton
          pendingLabel="Sender …"
          className="mt-2 inline-flex h-9 items-center bg-[#163f2a] px-4 text-xs font-bold text-white hover:bg-[#1d5639]"
        >
          Send svar
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

function ByggmakkerCard({
  orderId,
  state,
  events,
}: {
  orderId: string;
  state: ReturnType<typeof parseByggmakkerEventType>;
  events: ShopEvent[];
}) {
  const presentation = {
    sent: { label: "Sendt til Byggmakker", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    failed: { label: "Sending feilet", className: "border-red-200 bg-red-50 text-red-700" },
    skipped: { label: "Hoppet over – e-post ikke konfigurert", className: "border-amber-200 bg-amber-50 text-amber-700" },
    none: { label: "Ikke sendt ennå", className: "border-stone-200 bg-stone-50 text-stone-600" },
  }[state];

  const lastSent = events.find((event) => event.event_type === "byggmakker_order_email_sent");

  return (
    <ActionForm action={resendByggmakkerAction} className="border border-stone-200 bg-white p-5">
      <input type="hidden" name="orderId" value={orderId} />
      <h2 className="text-sm font-bold text-stone-900">Bestilling til Byggmakker</h2>
      <p className="mt-1 text-xs text-stone-500">Leverandørbestillingen som sendes når kunden har betalt.</p>

      <div className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${presentation.className}`}>
        {presentation.label}
      </div>

      {lastSent ? (
        <p className="mt-2 text-xs text-stone-500">Sist sendt {formatDateTimeNo(lastSent.created_at)}</p>
      ) : null}

      <SubmitButton
        pendingLabel="Sender …"
        className="mt-4 inline-flex h-10 w-full items-center justify-center border border-stone-300 px-4 text-sm font-semibold text-stone-800 hover:border-stone-900"
      >
        {state === "sent" ? "Send bestilling på nytt" : "Send bestilling til Byggmakker"}
      </SubmitButton>
    </ActionForm>
  );
}

function EventLog({ events }: { events: ShopEvent[] }) {
  return (
    <div className="border border-stone-200 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold text-stone-900">Logg</h2>
        <span className="text-xs text-stone-400">{events.length} hendelser</span>
      </div>

      <ol className="mt-3 space-y-2">
        {events.length === 0 ? (
          <p className="bg-stone-50 px-3 py-3 text-sm text-stone-500">Ingen hendelser.</p>
        ) : null}
        {events.map((event) => (
          <li key={event.id} className="border border-stone-200 bg-stone-50 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-stone-900">{event.message || event.event_type}</p>
              <p className="text-xs text-stone-500">{formatDateTimeNo(event.created_at)}</p>
            </div>
            <p className="mt-1 text-xs text-stone-500">
              {event.actor_label ?? event.actor_type} ·{" "}
              {event.is_customer_visible ? "Synlig for kunde" : "Intern"}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
