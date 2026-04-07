import Stripe from "stripe";

import { env, hasStripeWebhookEnv } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type MaterialOrderStatus = "draft" | "pending_payment" | "paid" | "submitted" | "cancelled" | "failed";

type MaterialOrderPaymentRow = {
  id: string;
  user_id: string;
  status: MaterialOrderStatus;
  payment_intent_id: string | null;
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

  if (looksLikeMaterialOrder) {
    await markMaterialOrderPaid(supabase, session);
    return;
  }

  await markProjectUnlocked(supabase, session);
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
