import Stripe from "stripe";

import { sendByggmakkerShopOrderEmail, sendMaterialOrderEmail, sendShopOrderEmail } from "@/lib/email";
import { getPriceListProducts } from "@/lib/price-lists";
import { logShopOrderEvent } from "@/lib/shop-order";
import { withResolvedShopOrderUnits } from "@/lib/shop-order-units";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type MaterialOrderStatus = "draft" | "pending_payment" | "paid" | "submitted" | "cancelled" | "failed";
type ShopOrderStatus = "draft" | "pending_payment" | "paid" | "fulfilled" | "cancelled" | "failed";

type EmailDispatchOutcome = "sent" | "already_sent" | "skipped" | "failed";

type MaterialOrderPaymentRow = {
  id: string;
  user_id: string;
  status: MaterialOrderStatus;
  payment_intent_id: string | null;
};

type ShopOrderPaymentRow = {
  id: string;
  status: ShopOrderStatus;
  payment_intent_id: string | null;
  checkout_session_id: string | null;
  transport_status: string;
  paid_at: string | null;
};

export async function reconcileCheckoutSession(session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") {
    return;
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role er ikke konfigurert.");
  }

  const looksLikeMaterialOrder = session.metadata?.kind === "material_order" || Boolean(session.metadata?.orderId);
  const looksLikeShopOrder = session.metadata?.kind === "shop_order" || Boolean(session.metadata?.shopOrderId);

  if (looksLikeShopOrder) {
    await markShopOrderPaid(supabase, session);
    return;
  }

  if (looksLikeMaterialOrder) {
    await markMaterialOrderPaid(supabase, session);
    return;
  }

  await markProjectUnlocked(supabase, session);
}

async function markShopOrderPaid(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  session: Stripe.Checkout.Session,
) {
  const orderId = session.metadata?.shopOrderId;

  if (!orderId) {
    return;
  }

  const paymentIntentId = toPaymentIntentId(session.payment_intent);
  const { data: order, error: orderError } = await supabase
    .from("shop_orders")
    .select("id, status, payment_intent_id, checkout_session_id, transport_status, paid_at")
    .eq("id", orderId)
    .maybeSingle<ShopOrderPaymentRow>();

  if (orderError) {
    throw new Error("Kunne ikke hente butikkordre for webhook.");
  }

  if (!order) {
    return;
  }

  if (
    (order.status === "paid" || order.status === "fulfilled") &&
    order.payment_intent_id === paymentIntentId &&
    order.checkout_session_id === session.id
  ) {
    await dispatchShopOrderEmails(supabase, orderId, order.paid_at ?? new Date().toISOString());
    return;
  }

  const paidAt = new Date().toISOString();
  const { error: updateOrderError } = await supabase
    .from("shop_orders")
    .update({
      status: "paid",
      transport_status: order.transport_status === "pending" ? "confirmed" : order.transport_status,
      checkout_session_id: session.id,
      payment_intent_id: paymentIntentId,
      paid_at: paidAt,
    })
    .eq("id", orderId);

  if (updateOrderError) {
    throw new Error("Kunne ikke oppdatere butikkordre via webhook.");
  }

  await logShopOrderEvent(supabase, {
    orderId,
    eventType: "payment_confirmed_webhook",
    message: "Betalingen er bekreftet, og ordren er sendt videre til behandling.",
    payload: {
      checkoutSessionId: session.id,
      paymentIntent: paymentIntentId,
      paymentStatus: session.payment_status,
    },
  });

  await dispatchShopOrderEmails(supabase, orderId, paidAt);
}

/**
 * Sends both order emails for a paid shop order. The Byggmakker order is the
 * business-critical step (it IS the purchase order to the supplier), so it is
 * attempted first and independently of the customer confirmation — a failing
 * confirmation must never block it.
 *
 * Both sends are guarded by their own event log, so re-running this (e.g. on a
 * Stripe webhook retry) never double-sends. If either send fails transiently we
 * throw, which makes the webhook return 500 and Stripe retry with backoff; the
 * send that already succeeded is skipped on the retry.
 */
async function dispatchShopOrderEmails(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  orderId: string,
  paidAt: string,
) {
  const byggmakker = await ensureByggmakkerOrderEmailSent(supabase, orderId, paidAt);
  const customer = await ensureShopOrderEmailSent(supabase, orderId, paidAt);

  if (byggmakker === "failed" || customer === "failed") {
    throw new Error(
      `Ordre-e-post feilet (byggmakker=${byggmakker}, kunde=${customer}); ber Stripe om nytt forsøk.`,
    );
  }
}

async function ensureShopOrderEmailSent(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  orderId: string,
  paidAt: string,
): Promise<EmailDispatchOutcome> {
  const { data: existingEmailEvent } = await supabase
    .from("shop_order_events")
    .select("id")
    .eq("order_id", orderId)
    .eq("event_type", "shop_order_email_sent")
    .limit(1)
    .maybeSingle();

  if (existingEmailEvent) {
    return "already_sent";
  }

  try {
    await sendOrderEmailForShopOrder(supabase, orderId, paidAt);
  } catch (error) {
    await logShopOrderEvent(supabase, {
      orderId,
      eventType: "shop_order_email_failed",
      message: "Ordrebekreftelse til kunden kunne ikke sendes automatisk.",
      payload: { paidAt, error: error instanceof Error ? error.message : String(error) },
      customerVisible: false,
    });
    return "failed";
  }

  await logShopOrderEvent(supabase, {
    orderId,
    eventType: "shop_order_email_sent",
    message: "Ordrebekreftelse er sendt på e-post.",
    payload: { paidAt },
    customerVisible: false,
  });
  return "sent";
}

async function ensureByggmakkerOrderEmailSent(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  orderId: string,
  paidAt: string,
): Promise<EmailDispatchOutcome> {
  const { data: existingEmailEvent } = await supabase
    .from("shop_order_events")
    .select("id")
    .eq("order_id", orderId)
    .eq("event_type", "byggmakker_order_email_sent")
    .limit(1)
    .maybeSingle();

  if (existingEmailEvent) {
    return "already_sent";
  }

  try {
    const emailId = await sendOrderEmailForByggmakker(supabase, orderId, paidAt);

    if (!emailId) {
      await logShopOrderEvent(supabase, {
        orderId,
        eventType: "byggmakker_order_email_skipped",
        message: "Byggmakker-bestilling ble ikke sendt fordi e-post ikke er konfigurert.",
        payload: { paidAt },
        customerVisible: false,
      });
      return "skipped";
    }

    await logShopOrderEvent(supabase, {
      orderId,
      eventType: "byggmakker_order_email_sent",
      message: "Ordren er sendt til Byggmakker for behandling og transportvurdering.",
      payload: { paidAt, resendEmailId: emailId },
    });
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[shop-order] Byggmakker-bestilling ${orderId} kunne ikke sendes:`, message);

    await logShopOrderEvent(supabase, {
      orderId,
      eventType: "byggmakker_order_email_failed",
      message: "Byggmakker-bestilling kunne ikke sendes automatisk.",
      payload: { paidAt, error: message },
      customerVisible: false,
    });
    return "failed";
  }
}

/**
 * Manually (re)sends the Byggmakker purchase order for a shop order. Used by the
 * admin order page as a recovery path when the automatic send failed or was
 * skipped (e.g. missing configuration). Bypasses the idempotency guard on
 * purpose — the admin is explicitly asking for a resend — and throws on failure
 * so the caller can surface it.
 */
export async function resendByggmakkerOrderEmail(orderId: string): Promise<EmailDispatchOutcome> {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role er ikke konfigurert.");
  }

  const { data: order, error: orderError } = await supabase
    .from("shop_orders")
    .select("id, paid_at")
    .eq("id", orderId)
    .maybeSingle<{ id: string; paid_at: string | null }>();

  if (orderError) {
    throw new Error("Kunne ikke hente butikkordre for ny utsending.");
  }

  if (!order) {
    throw new Error("Fant ikke butikkordren.");
  }

  const paidAt = order.paid_at ?? new Date().toISOString();

  try {
    const emailId = await sendOrderEmailForByggmakker(supabase, orderId, paidAt);

    if (!emailId) {
      await logShopOrderEvent(supabase, {
        orderId,
        eventType: "byggmakker_order_email_skipped",
        actorType: "admin",
        actorLabel: "Sjefen",
        message: "Manuell utsending hoppet over fordi Byggmakker-e-post ikke er konfigurert.",
        payload: { paidAt, manual: true },
        customerVisible: false,
      });
      return "skipped";
    }

    await logShopOrderEvent(supabase, {
      orderId,
      eventType: "byggmakker_order_email_sent",
      actorType: "admin",
      actorLabel: "Sjefen",
      message: "Byggmakker-bestilling sendt på nytt manuelt.",
      payload: { paidAt, resendEmailId: emailId, manual: true },
    });
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[shop-order] Manuell Byggmakker-utsending ${orderId} feilet:`, message);

    await logShopOrderEvent(supabase, {
      orderId,
      eventType: "byggmakker_order_email_failed",
      actorType: "admin",
      actorLabel: "Sjefen",
      message: "Manuell utsending av Byggmakker-bestilling feilet.",
      payload: { paidAt, error: message, manual: true },
      customerVisible: false,
    });

    throw new Error(`Kunne ikke sende Byggmakker-bestilling: ${message}`);
  }
}

async function sendOrderEmailForShopOrder(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  orderId: string,
  paidAt: string,
) {
  const [{ data: orderData }, { data: items }] = await Promise.all([
    supabase
      .from("shop_orders")
      .select("id, public_token, slug, customer_name, customer_email, customer_phone, shipping_address_line1, shipping_postal_code, shipping_city, subtotal_nok, shipping_nok, vat_nok, total_nok")
      .eq("id", orderId)
      .maybeSingle(),
    supabase
      .from("shop_order_items")
      .select("product_id, product_name, supplier_name, quantity, unit, unit_price_nok, line_total_nok, nobb_number")
      .eq("order_id", orderId)
      .order("supplier_name"),
  ]);

  if (!orderData || !items) return;

  const resolvedItems = await withResolvedShopOrderUnits(items);

  await sendShopOrderEmail({
    orderId,
    orderSlug: orderData.slug ?? orderData.public_token ?? null,
    customerName: orderData.customer_name,
    customerEmail: orderData.customer_email,
    customerPhone: orderData.customer_phone ?? null,
    shippingAddress: orderData.shipping_address_line1,
    shippingPostalCode: orderData.shipping_postal_code,
    shippingCity: orderData.shipping_city,
    subtotalNok: orderData.subtotal_nok ?? 0,
    shippingNok: orderData.shipping_nok ?? 0,
    vatNok: orderData.vat_nok ?? 0,
    totalNok: orderData.total_nok ?? 0,
    paidAt,
    items: resolvedItems.map((item) => ({
      productName: item.product_name,
      supplierName: item.supplier_name,
      quantity: item.quantity,
      unit: item.unit,
      unitPriceNok: item.unit_price_nok,
      lineTotalNok: item.line_total_nok,
      nobbNumber: item.nobb_number ?? null,
    })),
  });
}

async function sendOrderEmailForByggmakker(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  orderId: string,
  paidAt: string,
) {
  const [{ data: orderData }, { data: items }] = await Promise.all([
    supabase
      .from("shop_orders")
      .select("id, public_token, slug, customer_name, customer_email, customer_phone, shipping_address_line1, shipping_postal_code, shipping_city, customer_note")
      .eq("id", orderId)
      .maybeSingle(),
    supabase
      .from("shop_order_items")
      .select("product_id, product_name, quantity, unit, nobb_number")
      .eq("order_id", orderId)
      .order("product_name"),
  ]);

  if (!orderData || !items) return null;

  const resolvedItems = await withResolvedShopOrderUnits(items);

  return sendByggmakkerShopOrderEmail({
    orderId,
    orderSlug: orderData.slug ?? orderData.public_token ?? null,
    customerName: orderData.customer_name,
    customerEmail: orderData.customer_email,
    customerPhone: orderData.customer_phone ?? null,
    shippingAddress: orderData.shipping_address_line1,
    shippingPostalCode: orderData.shipping_postal_code,
    shippingCity: orderData.shipping_city,
    customerNote: orderData.customer_note ?? null,
    paidAt,
    items: resolvedItems.map((item) => ({
      nobbNumber: item.nobb_number ?? "",
      productName: item.product_name,
      quantity: item.quantity,
      unit: item.unit,
    })),
  });
}

async function markMaterialOrderPaid(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  session: Stripe.Checkout.Session,
) {
  const orderId = session.metadata?.orderId;

  if (!orderId) {
    return;
  }

  const paymentIntentId = toPaymentIntentId(session.payment_intent);
  const { data: order, error: orderError } = await supabase
    .from("material_orders")
    .select("id, user_id, status, payment_intent_id")
    .eq("id", orderId)
    .maybeSingle<MaterialOrderPaymentRow>();

  if (orderError) {
    throw new Error("Kunne ikke hente materialordre for webhook.");
  }

  if (!order) {
    return;
  }

  if ((order.status === "paid" || order.status === "submitted") && order.payment_intent_id === paymentIntentId) {
    return;
  }

  const timestamp = new Date().toISOString();
  const { error: updateOrderError } = await supabase
    .from("material_orders")
    .update({
      status: "paid",
      checkout_session_id: session.id,
      payment_intent_id: paymentIntentId,
      paid_at: timestamp,
      submitted_at: timestamp,
    })
    .eq("id", orderId);

  if (updateOrderError) {
    throw new Error("Kunne ikke oppdatere materialordre via webhook.");
  }

  const { error: eventError } = await supabase.from("material_order_events").insert({
    order_id: orderId,
    user_id: order.user_id,
    event_type: "payment_confirmed_webhook",
    payload: {
      checkoutSessionId: session.id,
      paymentIntent: paymentIntentId,
      paymentStatus: session.payment_status,
      eventType: "checkout.session.completed",
    },
  });

  if (eventError) {
    throw new Error("Kunne ikke lagre materialordre-event via webhook.");
  }

  await sendOrderEmailForMaterialOrder(supabase, orderId, order.user_id, timestamp);
}

async function sendOrderEmailForMaterialOrder(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  orderId: string,
  userId: string,
  paidAt: string,
) {
  try {
    const [{ data: orderData }, { data: items }, userResult] = await Promise.all([
      supabase
        .from("material_orders")
        .select("id, delivery_mode, delivery_address_line1, delivery_postal_code, delivery_city, earliest_delivery_date, latest_delivery_date, subtotal_nok, delivery_fee_nok, vat_nok, total_nok")
        .eq("id", orderId)
        .maybeSingle(),
      supabase
        .from("material_order_items")
        .select("product_name, supplier_label, quantity, unit, unit_price_nok, total_price_nok, nobb_number")
        .eq("order_id", orderId)
        .eq("is_included", true)
        .order("supplier_label"),
      supabase.auth.admin.getUserById(userId),
    ]);

    if (!orderData || !items) return;

    const priceListProducts = await getPriceListProducts().catch(() => []);
    const nobbCostMap = new Map<string, number>();
    for (const product of priceListProducts) {
      if (product.nobbNumber) nobbCostMap.set(product.nobbNumber, product.priceNok);
    }

    const user = userResult.data?.user;
    const customerEmail = user?.email ?? "ukjent@prisbygg.no";
    const customerName =
      (user?.user_metadata?.full_name as string | undefined) ??
      (user?.user_metadata?.name as string | undefined) ??
      customerEmail.split("@")[0];
    const customerPhone = (user?.user_metadata?.phone as string | undefined) ?? null;

    await sendMaterialOrderEmail({
      orderId,
      customerName,
      customerEmail,
      customerPhone,
      deliveryMode: (orderData.delivery_mode as "delivery" | "pickup") ?? "delivery",
      deliveryAddress: orderData.delivery_address_line1 ?? null,
      deliveryPostalCode: orderData.delivery_postal_code ?? null,
      deliveryCity: orderData.delivery_city ?? null,
      earliestDelivery: orderData.earliest_delivery_date ?? null,
      latestDelivery: orderData.latest_delivery_date ?? null,
      subtotalNok: orderData.subtotal_nok ?? 0,
      deliveryFeeNok: orderData.delivery_fee_nok ?? 0,
      vatNok: orderData.vat_nok ?? 0,
      totalNok: orderData.total_nok ?? 0,
      paidAt,
      items: items.map((item) => {
        const costPrice = item.nobb_number ? (nobbCostMap.get(item.nobb_number) ?? undefined) : undefined;
        return {
          product_name: item.product_name,
          supplier_label: item.supplier_label,
          quantity: item.quantity,
          unit: item.unit,
          unit_price_nok: item.unit_price_nok,
          total_price_nok: item.total_price_nok,
          cost_price_nok: costPrice,
          cost_total_nok: costPrice !== undefined ? costPrice * item.quantity : undefined,
          nobb_number: item.nobb_number ?? null,
        };
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[webhook] sendOrderEmailForMaterialOrder feilet:", message);
    try {
      await supabase
        .from("material_order_events")
        .insert({
          order_id: orderId,
          user_id: userId,
          event_type: "order_email_failed",
          payload: { paidAt, error: message },
        });
    } catch {
      // Best-effort log — don't throw
    }
  }
}

async function markProjectUnlocked(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  session: Stripe.Checkout.Session,
) {
  const projectId = session.metadata?.projectId ?? "";
  const slug = session.metadata?.slug ?? "";

  const { data: linkedProject, error: linkedProjectError } = await supabase
    .from("projects")
    .update({
      payment_status: "paid",
      stripe_checkout_session_id: session.id,
    })
    .eq("stripe_checkout_session_id", session.id)
    .select("id")
    .limit(1)
    .maybeSingle();

  if (linkedProjectError) {
    throw new Error("Kunne ikke oppdatere prosjektbetaling via session-id.");
  }

  if (linkedProject) {
    return;
  }

  if (projectId && slug && projectId !== slug) {
    const { data: fallbackProject, error } = await supabase
      .from("projects")
      .update({
        payment_status: "paid",
        stripe_checkout_session_id: session.id,
      })
      .eq("id", projectId)
      .eq("slug", slug)
      .select("id")
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error("Kunne ikke oppdatere prosjektbetaling via legacy fallback.");
    }

    if (fallbackProject) {
      return;
    }
  }
}

function toPaymentIntentId(value: string | Stripe.PaymentIntent | null) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return value.id;
}
