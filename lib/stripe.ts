import Stripe from "stripe";

import { env, hasStripeEnv } from "@/lib/env";

let stripeClient: Stripe | null = null;

export function getStripe() {
  if (!hasStripeEnv()) {
    return null;
  }

  if (!stripeClient) {
    stripeClient = new Stripe(env.stripeSecretKey);
  }

  return stripeClient;
}
