import { NextResponse } from "next/server";

import { isStripeBypassed } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    orderId: string;
  }>;
};

const MINIMUM_ORDER_VALUE_NOK = 5000;

export async function POST(request: Request, { params }: RouteContext) {
  const { orderId } = await params;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase er ikke konfigurert." }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Innlogging kreves." }, { status: 401 });
  }

  const { data: order } = await supabase
    .from("material_orders")
    .select("*")
    .eq("id", orderId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Bestilling ikke funnet." }, { status: 404 });
  }

  if (["paid", "submitted", "cancelled"].includes(String(order.status))) {
    return NextResponse.json({ error: "Bestillingen kan ikke betales i nåværende status." }, { status: 409 });
  }

  if ((order.total_nok ?? 0) <= 0) {
    return NextResponse.json({ error: "Bestilling mangler gyldig totalbeløp." }, { status: 400 });
  }

  if (!order.contract_accepted_at) {
    return NextResponse.json({ error: "Kontraktsvilkår må godkjennes før innsending." }, { status: 400 });
  }

  if (!order.shipping_contact_name || !order.shipping_phone) {
    return NextResponse.json({ error: "Kontaktperson og telefon må fylles ut før innsending." }, { status: 400 });
  }

  if (order.delivery_mode !== "delivery") {
    return NextResponse.json({ error: "Kun levering til adresse med lastebil er tilgjengelig." }, { status: 400 });
  }

  if (!order.shipping_address_line1 || !order.shipping_postal_code || !order.shipping_city) {
    return NextResponse.json({ error: "Leveringsadresse må fylles ut før innsending." }, { status: 400 });
  }

  if (order.delivery_target !== "door" && order.delivery_target !== "construction_site") {
    return NextResponse.json({ error: "Leveringsmål må velges før innsending." }, { status: 400 });
  }

  if (order.unloading_method !== "standard" && order.unloading_method !== "crane_needed" && order.unloading_method !== "customer_machine") {
    return NextResponse.json({ error: "Lossingstype må velges før innsending." }, { status: 400 });
  }

  if (
    (order.delivery_target === "construction_site" || order.unloading_method === "crane_needed") &&
    String(order.delivery_instructions ?? "").trim().length < 8
  ) {
    return NextResponse.json({ error: "Legg inn fraktinstruksjon for byggeplass/kran før innsending." }, { status: 400 });
  }

  if ((order.subtotal_nok ?? 0) < MINIMUM_ORDER_VALUE_NOK) {
    return NextResponse.json(
      { error: `Minste bestillingsverdi for ProAnbud er ${MINIMUM_ORDER_VALUE_NOK} kr.` },
      { status: 400 },
    );
  }

  if (order.checkout_flow !== "pay_now" && order.checkout_flow !== "klarna") {
    return NextResponse.json({ error: "Kun kortbetaling og Klarna via Stripe er tilgjengelig." }, { status: 400 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, slug, title")
    .eq("id", order.project_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: "Prosjekt ikke funnet for bestillingen." }, { status: 404 });
  }

  const { count: lineCount } = await supabase
    .from("material_order_items")
    .select("id", { count: "exact", head: true })
    .eq("order_id", order.id)
    .eq("user_id", user.id)
    .eq("is_included", true);

  const origin = new URL(request.url).origin;

  if (isStripeBypassed()) {
    await supabase
      .from("material_orders")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        submitted_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .eq("user_id", user.id);

    await supabase.from("material_order_events").insert({
      order_id: order.id,
      user_id: user.id,
      event_type: "payment_bypassed",
      payload: {
        totalNok: order.total_nok,
      },
    });

    return NextResponse.json({ url: `${origin}/min-side/materiallister/${project.slug}/bestilling?paid=1&test_mode=1` });
  }

  const stripe = getStripe();

  if (!stripe) {
    return NextResponse.json({ error: "Stripe er ikke konfigurert." }, { status: 503 });
  }

  const paymentMethodTypes =
    order.checkout_flow === "klarna"
      ? (["klarna"] as const)
      : (["card"] as const);

  let session;

  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      success_url: `${origin}/betaling/suksess?slug=${project.slug}&order_id=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/min-side/materiallister/${project.slug}/bestilling?betaling=avbrutt&order=${order.id}`,
      metadata: {
        kind: "material_order",
        orderId: order.id,
        projectId: project.id,
        projectSlug: project.slug,
        checkoutFlow: order.checkout_flow,
        customerType: order.customer_type,
        deliveryTarget: order.delivery_target,
        unloadingMethod: order.unloading_method,
      },
      payment_method_types: [...paymentMethodTypes],
      billing_address_collection: order.checkout_flow === "klarna" ? "required" : "auto",
      line_items: [
        {
          price_data: {
            currency: "nok",
            product_data: {
              name: `Materialbestilling: ${project.title}`,
              description: `${lineCount ?? 0} varelinjer fordelt på byggevarehus.`,
            },
            unit_amount: Math.round(order.total_nok * 100),
          },
          quantity: 1,
        },
      ],
    });
  } catch (error) {
    const stripeMessage = error instanceof Error ? error.message : "Ukjent Stripe-feil.";
    const klarnaNotReady =
      order.checkout_flow === "klarna" &&
      /klarna/i.test(stripeMessage) &&
      /(activated|enable|supported|available)/i.test(stripeMessage);

    return NextResponse.json(
      {
        error: klarnaNotReady
          ? "Klarna er ikke aktivert i Stripe-kontoen ennå. Aktiver Klarna i Stripe Dashboard og prøv igjen."
          : "Kunne ikke starte Stripe-checkout.",
      },
      { status: 400 },
    );
  }

  await supabase
    .from("material_orders")
    .update({
      status: "pending_payment",
      checkout_session_id: session.id,
    })
    .eq("id", order.id)
    .eq("user_id", user.id);

  await supabase.from("material_order_events").insert({
    order_id: order.id,
    user_id: user.id,
    event_type: "checkout_created",
    payload: {
      checkoutSessionId: session.id,
      totalNok: order.total_nok,
    },
  });

  return NextResponse.json({ url: session.url });
}
