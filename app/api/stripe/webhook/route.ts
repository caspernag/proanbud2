import Stripe from "stripe";

import { env, hasStripeWebhookEnv } from "@/lib/env";
import { reconcileCheckoutSession } from "@/lib/stripe-checkout-reconciliation";
import { getStripe } from "@/lib/stripe";

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
