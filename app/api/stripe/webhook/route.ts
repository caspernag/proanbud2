import Stripe from "stripe";

import { recordStripePayout } from "@/lib/accounting/payouts";
import { recordStripeRefund } from "@/lib/accounting/refunds";
import { env, hasStripeWebhookEnv } from "@/lib/env";
import { reconcileCheckoutSession } from "@/lib/stripe-checkout-reconciliation";
import { getStripe } from "@/lib/stripe";

function toPaymentIntentId(value: string | Stripe.PaymentIntent | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

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
      // Utbetaling fra Stripe til bank. Lukker Stripe-mellomkontoen og gjør
      // gebyret synlig som kostnad. Idempotent på payout-id.
      case "payout.paid": {
        await recordStripePayout(event.data.object as Stripe.Payout);
        break;
      }
      // Refusjon til kunde. Må bokføres som kreditnota, ellers står omsetningen
      // og den utgående mva-en igjen på et salg som er reversert.
      case "refund.created":
      case "charge.refund.updated": {
        const refund = event.data.object as Stripe.Refund;

        // Bare fullførte refusjoner bokføres — en `pending` refusjon kan feile.
        if (refund.status === "succeeded") {
          await recordStripeRefund(refund, toPaymentIntentId(refund.payment_intent));
        }
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
