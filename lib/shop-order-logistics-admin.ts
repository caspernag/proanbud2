import type { SupabaseClient } from "@supabase/supabase-js";

import { sendShopOrderStatusEmail } from "@/lib/email";
import {
  isShopOrderStatus,
  isShopOrderTransportStatus,
  logShopOrderEvent,
  SHOP_ORDER_TRANSPORT_LABELS,
  SHOP_ORDER_TRANSPORT_STEPS,
  transportStepState,
  type ShopOrderStatus,
  type ShopOrderTransportStatus,
} from "@/lib/shop-order";
import {
  carrierLabel,
  nextTransportStatus,
  resolveTrackingUrl,
  type ByggmakkerState,
  type LogisticsOrder,
} from "@/lib/shop-order-logistics";

export const LOGISTICS_ORDER_COLUMNS =
  "id, slug, public_token, status, transport_status, carrier, carrier_code, tracking_number, tracking_url, estimated_delivery_date, customer_name, customer_email, customer_phone, shipping_address_line1, shipping_postal_code, shipping_city, customer_note, internal_note, last_status_note, total_nok, created_at, paid_at, confirmed_at, packed_at, shipped_at, delivered_at";

export type LogisticsUpdateInput = {
  orderId: string;
  transportStatus: ShopOrderTransportStatus;
  /** Utelates ved hurtighandlinger — da utledes ordrestatus fra transportsteget. */
  orderStatus?: ShopOrderStatus | null;
  carrierCode?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  estimatedDeliveryDate?: string | null;
  statusNote?: string | null;
  internalNote?: string | null;
  notifyCustomer: boolean;
  actorLabel?: string;
};

export type LogisticsUpdateResult =
  | { ok: true; emailed: boolean; emailError?: string }
  | { ok: false; error: string };

/**
 * Eneste vei inn for endringer på transportflyten. Oppdaterer ordren, setter
 * tidsstempler for steget, skriver ordrelogg og varsler eventuelt kunden.
 *
 * E-postfeil ruller ikke tilbake databaseoppdateringen — statusen er allerede
 * sann, og admin får beskjed om at varselet må sendes på nytt.
 */
export async function applyLogisticsUpdate(
  supabase: SupabaseClient,
  input: LogisticsUpdateInput,
): Promise<LogisticsUpdateResult> {
  if (!input.orderId || !isShopOrderTransportStatus(input.transportStatus)) {
    return { ok: false, error: "Ugyldig status." };
  }

  const { data: order } = await supabase
    .from("shop_orders")
    .select(LOGISTICS_ORDER_COLUMNS)
    .eq("id", input.orderId)
    .maybeSingle<LogisticsOrder>();

  if (!order) {
    return { ok: false, error: "Fant ikke ordren." };
  }

  const transport = input.transportStatus;
  const now = new Date();
  const timestamp = now.toISOString();
  const statusChanged = order.transport_status !== transport;

  const carrierCode = blankToNull(input.carrierCode);
  const trackingNumber = blankToNull(input.trackingNumber);
  const manualTrackingUrl = blankToNull(input.trackingUrl);
  const estimatedDeliveryDate = blankToNull(input.estimatedDeliveryDate);
  const statusNote = (input.statusNote ?? "").trim();

  const resolvedCarrierLabel = carrierLabel(carrierCode, order.carrier);
  const resolvedTrackingUrl = resolveTrackingUrl({
    carrierCode,
    trackingNumber,
    trackingUrl: manualTrackingUrl,
  });

  const orderStatus = resolveOrderStatus({
    requested: input.orderStatus ?? null,
    current: order.status,
    transport,
  });

  const update: Record<string, unknown> = {
    status: orderStatus,
    transport_status: transport,
    carrier_code: carrierCode,
    carrier: resolvedCarrierLabel,
    tracking_number: trackingNumber,
    tracking_url: resolvedTrackingUrl,
    estimated_delivery_date: estimatedDeliveryDate,
    last_status_note: statusNote,
  };

  if (input.internalNote != null) {
    update.internal_note = input.internalNote.trim();
  }

  // Tidsstempler settes én gang — første gang ordren når steget.
  if (isAtOrPast(transport, "confirmed") && !order.confirmed_at) update.confirmed_at = timestamp;
  if (isAtOrPast(transport, "packing") && !order.packed_at) update.packed_at = timestamp;
  if (isAtOrPast(transport, "shipped") && !order.shipped_at) update.shipped_at = timestamp;
  if (transport === "delivered") {
    if (!order.delivered_at) update.delivered_at = timestamp;
    update.fulfilled_at = timestamp;
  }

  const { error: updateError } = await supabase.from("shop_orders").update(update).eq("id", order.id);

  if (updateError) {
    return { ok: false, error: `Kunne ikke lagre: ${updateError.message}` };
  }

  await logShopOrderEvent(supabase, {
    orderId: order.id,
    eventType: statusChanged ? "admin_transport_status_changed" : "admin_order_updated",
    actorType: "admin",
    actorLabel: input.actorLabel ?? "Prisbygg logistikk",
    message:
      statusNote ||
      (statusChanged
        ? `Status oppdatert til ${SHOP_ORDER_TRANSPORT_LABELS[transport]}.`
        : "Transportdetaljer oppdatert."),
    payload: {
      status: orderStatus,
      transportStatus: transport,
      previousTransportStatus: order.transport_status,
      carrier: resolvedCarrierLabel,
      carrierCode,
      trackingNumber,
      estimatedDeliveryDate,
    },
  });

  if (!input.notifyCustomer) {
    return { ok: true, emailed: false };
  }

  const emailResult = await notifyCustomerOfStatus(supabase, {
    order: { ...order, ...(update as Partial<LogisticsOrder>) } as LogisticsOrder,
    transport,
    statusNote,
    carrierLabelText: resolvedCarrierLabel,
    trackingNumber,
    trackingUrl: resolvedTrackingUrl,
    estimatedDeliveryDate,
  });

  return emailResult.ok
    ? { ok: true, emailed: true }
    : { ok: true, emailed: false, emailError: emailResult.error };
}

/** Flytter ordren ett steg videre i flyten. Brukes av hurtigknapper og masseoppdatering. */
export async function advanceLogisticsStage(
  supabase: SupabaseClient,
  input: { orderId: string; notifyCustomer: boolean; actorLabel?: string },
): Promise<LogisticsUpdateResult> {
  const { data: order } = await supabase
    .from("shop_orders")
    .select(LOGISTICS_ORDER_COLUMNS)
    .eq("id", input.orderId)
    .maybeSingle<LogisticsOrder>();

  if (!order) return { ok: false, error: "Fant ikke ordren." };

  const next = nextTransportStatus(order.transport_status);
  if (!next) return { ok: false, error: "Ordren er allerede i siste steg." };

  return applyLogisticsUpdate(supabase, {
    orderId: order.id,
    transportStatus: next,
    carrierCode: order.carrier_code,
    trackingNumber: order.tracking_number,
    trackingUrl: order.tracking_url,
    estimatedDeliveryDate: order.estimated_delivery_date,
    statusNote: "",
    notifyCustomer: input.notifyCustomer,
    actorLabel: input.actorLabel,
  });
}

/** Sender statusoppdatering uten å endre noe — «send varselet på nytt». */
export async function resendStatusNotification(
  supabase: SupabaseClient,
  orderId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: order } = await supabase
    .from("shop_orders")
    .select(LOGISTICS_ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle<LogisticsOrder>();

  if (!order) return { ok: false, error: "Fant ikke ordren." };

  return notifyCustomerOfStatus(supabase, {
    order,
    transport: order.transport_status,
    statusNote: order.last_status_note,
    carrierLabelText: carrierLabel(order.carrier_code, order.carrier),
    trackingNumber: order.tracking_number,
    trackingUrl: resolveTrackingUrl({
      carrierCode: order.carrier_code,
      trackingNumber: order.tracking_number,
      trackingUrl: order.tracking_url,
    }),
    estimatedDeliveryDate: order.estimated_delivery_date,
  });
}

async function notifyCustomerOfStatus(
  supabase: SupabaseClient,
  input: {
    order: LogisticsOrder;
    transport: ShopOrderTransportStatus;
    statusNote: string | null;
    carrierLabelText: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    estimatedDeliveryDate: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const { order, transport } = input;

  if (!order.customer_email) {
    return { ok: false, error: "Ordren mangler e-postadresse." };
  }

  const reachedIndex = transportStepState(transport);
  const steps = SHOP_ORDER_TRANSPORT_STEPS.map((step, index) => ({
    status: step,
    label: SHOP_ORDER_TRANSPORT_LABELS[step],
    reached: reachedIndex >= index,
  }));

  try {
    await sendShopOrderStatusEmail({
      orderId: order.id,
      orderSlug: order.slug ?? order.public_token,
      customerName: order.customer_name,
      customerEmail: order.customer_email,
      transportStatus: transport,
      steps,
      statusNote: input.statusNote,
      carrierLabel: input.carrierLabelText,
      trackingNumber: input.trackingNumber,
      trackingUrl: input.trackingUrl,
      estimatedDeliveryDate: input.estimatedDeliveryDate,
      shippingAddress: order.shipping_address_line1,
      shippingPostalCode: order.shipping_postal_code,
      shippingCity: order.shipping_city,
    });

    await supabase
      .from("shop_orders")
      .update({ customer_notified_at: new Date().toISOString() })
      .eq("id", order.id);

    await logShopOrderEvent(supabase, {
      orderId: order.id,
      eventType: "customer_status_email_sent",
      actorType: "system",
      actorLabel: "Prisbygg",
      message: `Statusoppdatering sendt til ${order.customer_email}.`,
      payload: { transportStatus: transport },
    });

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukjent feil";

    await logShopOrderEvent(supabase, {
      orderId: order.id,
      eventType: "customer_status_email_failed",
      actorType: "system",
      actorLabel: "Prisbygg",
      message: `Statusoppdatering kunne ikke sendes: ${message}`,
      payload: { transportStatus: transport, error: message },
      customerVisible: false,
    });

    return { ok: false, error: message };
  }
}

/**
 * Leverandørstatus per ordre, utledet av den nyeste
 * byggmakker_order_email_*-hendelsen. Ett oppslag for hele køen.
 */
export async function fetchByggmakkerStates(
  supabase: SupabaseClient,
  orderIds: string[],
): Promise<Map<string, ByggmakkerState>> {
  const states = new Map<string, ByggmakkerState>();
  if (orderIds.length === 0) return states;

  const { data } = await supabase
    .from("shop_order_events")
    .select("order_id, event_type, created_at")
    .in("order_id", orderIds)
    .like("event_type", "byggmakker_order_email_%")
    .order("created_at", { ascending: false })
    .returns<{ order_id: string; event_type: string; created_at: string }[]>();

  // Radene kommer nyest først, så første treff per ordre er gjeldende status.
  for (const row of data ?? []) {
    if (states.has(row.order_id)) continue;
    states.set(row.order_id, parseByggmakkerEventType(row.event_type));
  }

  return states;
}

export function parseByggmakkerEventType(eventType: string): ByggmakkerState {
  if (eventType === "byggmakker_order_email_sent") return "sent";
  if (eventType === "byggmakker_order_email_failed") return "failed";
  if (eventType === "byggmakker_order_email_skipped") return "skipped";
  return "none";
}

/**
 * Ordrestatus følger transportsteget når admin ikke sier noe annet:
 * levert ⇒ fullført, kansellert ⇒ kansellert.
 */
function resolveOrderStatus(input: {
  requested: ShopOrderStatus | null;
  current: ShopOrderStatus;
  transport: ShopOrderTransportStatus;
}): ShopOrderStatus {
  if (input.transport === "delivered") return "fulfilled";
  if (input.transport === "cancelled") return "cancelled";

  if (input.requested && isShopOrderStatus(input.requested)) return input.requested;
  return input.current;
}

const TRANSPORT_ORDER: ShopOrderTransportStatus[] = [
  "pending",
  "confirmed",
  "packing",
  "shipped",
  "out_for_delivery",
  "delivered",
];

function isAtOrPast(status: ShopOrderTransportStatus, milestone: ShopOrderTransportStatus): boolean {
  const a = TRANSPORT_ORDER.indexOf(status);
  const b = TRANSPORT_ORDER.indexOf(milestone);
  return a >= 0 && b >= 0 && a >= b;
}

function blankToNull(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : null;
}
