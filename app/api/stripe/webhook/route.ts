import Stripe from "stripe";

import { sendMaterialOrderEmail } from "@/lib/email";
import { env, hasStripeWebhookEnv } from "@/lib/env";
import { getPriceListProducts } from "@/lib/price-lists";
import { getStripe } from "@/lib/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";


type MaterialOrderStatus = "draft" | "pending_payment" | "paid" | "submitted" | "cancelled" | "failed";
type ShopOrderStatus = "draft" | "pending_payment" | "paid" | "fulfilled" | "cancelled" | "failed";

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
};

export async function POST(request: Request) {
  const stripe = getStripe();

  if (!stripe || !hasStripeWebhookEnv()) {
    return Response.json({ error: "Stripe webhook er ikke konfigurert." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return Response.json({ error: "Mangler stripe-signature header." }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, env.stripeWebhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ugyldig signatur.";
    return Response.json({ error: message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        await reconcileCheckoutSession(event.data.object as Stripe.Checkout.Session);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook-behandling feilet.";
    return Response.json({ error: message }, { status: 500 });
  }

  return Response.json({ received: true });
}

async function reconcileCheckoutSession(session: Stripe.Checkout.Session) {
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
    .select("id, status, payment_intent_id, checkout_session_id")
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
    return;
  }

  const { error: updateOrderError } = await supabase
    .from("shop_orders")
    .update({
      status: "paid",
      checkout_session_id: session.id,
      payment_intent_id: paymentIntentId,
      paid_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  if (updateOrderError) {
    throw new Error("Kunne ikke oppdatere butikkordre via webhook.");
  }
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

  // Send order email to Byggmakker (demo) with CC to Proanbud
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

    // Build a NOBB → cost price map from the price list for accurate min-pris
    const priceListProducts = await getPriceListProducts().catch(() => []);
    const nobbCostMap = new Map<string, number>();
    for (const p of priceListProducts) {
      if (p.nobbNumber) nobbCostMap.set(p.nobbNumber, p.priceNok);
    }

    const user = userResult.data?.user;
    const customerEmail = user?.email ?? "ukjent@proanbud.no";
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
      items: items.map((i) => {
        const costPrice = i.nobb_number ? (nobbCostMap.get(i.nobb_number) ?? undefined) : undefined;
        return {
          product_name: i.product_name,
          supplier_label: i.supplier_label,
          quantity: i.quantity,
          unit: i.unit,
          unit_price_nok: i.unit_price_nok,
          total_price_nok: i.total_price_nok,
          cost_price_nok: costPrice,
          cost_total_nok: costPrice !== undefined ? costPrice * i.quantity : undefined,
          nobb_number: i.nobb_number ?? null,
        };
      }),
    });
  } catch (err) {
    // Email failure must never break the webhook response, but log it
    console.error("[webhook] sendOrderEmailForMaterialOrder feilet:", err);
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

  // Legacy fallback for older sessions that may not have been linked before checkout redirect.
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
