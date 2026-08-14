import type { SupabaseClient } from "@supabase/supabase-js";

export type ShopOrderStatus = "draft" | "pending_payment" | "paid" | "fulfilled" | "cancelled" | "failed";
export type ShopOrderTransportStatus =
  | "pending"
  | "confirmed"
  | "packing"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export const SHOP_ORDER_STATUS_LABELS: Record<ShopOrderStatus, string> = {
  draft: "Kladd",
  pending_payment: "Venter betaling",
  paid: "Betalt",
  fulfilled: "Fullført",
  cancelled: "Kansellert",
  failed: "Feilet",
};

export const SHOP_ORDER_TRANSPORT_LABELS: Record<ShopOrderTransportStatus, string> = {
  pending: "Venter",
  confirmed: "Bekreftet",
  packing: "Plukkes og pakkes",
  shipped: "Sendt",
  out_for_delivery: "Under levering",
  delivered: "Levert",
  cancelled: "Kansellert",
};

export const SHOP_ORDER_TRANSPORT_STEPS: ShopOrderTransportStatus[] = [
  "confirmed",
  "packing",
  "shipped",
  "out_for_delivery",
  "delivered",
];

export function createShopOrderSlug(date = new Date()) {
  const day = date.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  return `ordre-${day}-${suffix}`;
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isShopOrderStatus(value: string): value is ShopOrderStatus {
  return value in SHOP_ORDER_STATUS_LABELS;
}

export function isShopOrderTransportStatus(value: string): value is ShopOrderTransportStatus {
  return value in SHOP_ORDER_TRANSPORT_LABELS;
}

export type ShopOrderFulfillmentInput = {
  deliveryMode: "pickup" | "delivery";
  addressLine1?: string | null;
  postalCode?: string | null;
  city?: string | null;
  pickupStoreId?: string | null;
  pickupStoreName?: string | null;
};

export function normalizeShopOrderFulfillment(input: ShopOrderFulfillmentInput) {
  const deliveryMode = input.deliveryMode === "delivery" ? "delivery" : "pickup";
  const addressLine1 = input.addressLine1?.trim() || null;
  const postalCode = input.postalCode?.trim() || null;
  const city = input.city?.trim() || null;
  const pickupStoreId = deliveryMode === "pickup" ? input.pickupStoreId?.trim() || null : null;
  const pickupStoreName = deliveryMode === "pickup" ? input.pickupStoreName?.trim() || null : null;

  return {
    delivery_mode: deliveryMode,
    shipping_address_line1: deliveryMode === "delivery" ? addressLine1 : null,
    shipping_postal_code: deliveryMode === "delivery" ? postalCode : null,
    shipping_city: deliveryMode === "delivery" ? city : null,
    pickup_store_id: pickupStoreId,
    pickup_store_name: pickupStoreName,
  };
}

export function transportStepState(status: ShopOrderTransportStatus) {
  if (status === "pending" || status === "cancelled") {
    return -1;
  }

  return SHOP_ORDER_TRANSPORT_STEPS.indexOf(status);
}

export async function logShopOrderEvent(
  supabase: SupabaseClient,
  input: {
    orderId: string;
    eventType: string;
    actorType?: "system" | "admin" | "customer";
    actorLabel?: string | null;
    message?: string;
    payload?: Record<string, unknown>;
    customerVisible?: boolean;
  },
) {
  const { error } = await supabase.from("shop_order_events").insert({
    order_id: input.orderId,
    event_type: input.eventType,
    actor_type: input.actorType ?? "system",
    actor_label: input.actorLabel ?? null,
    message: input.message ?? "",
    payload: input.payload ?? {},
    is_customer_visible: input.customerVisible ?? true,
  });

  if (error) {
    console.error("[shop-order] Kunne ikke lagre ordrelogg:", error.message);
  }
}