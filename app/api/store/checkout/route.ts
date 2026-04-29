import { NextResponse } from "next/server";
import { z } from "zod";

import { isStripeBypassed } from "@/lib/env";
import { getStorefrontProductsByIds } from "@/lib/storefront";
import { getStripe } from "@/lib/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const checkoutPayloadSchema = z.object({
  customer: z.object({
    email: z.string().email(),
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(6).max(40),
    addressLine1: z.string().trim().min(3).max(160),
    postalCode: z.string().trim().min(3).max(16),
    city: z.string().trim().min(2).max(80),
    notes: z.string().trim().max(1200).optional().default(""),
  }),
  checkoutFlow: z.enum(["pay_now", "klarna"]).default("pay_now"),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .min(1),
});


export async function POST(request: Request) {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role er ikke konfigurert." }, { status: 503 });
  }

  let payload: z.infer<typeof checkoutPayloadSchema>;

  try {
    const body = await request.json();
    payload = checkoutPayloadSchema.parse(body);
  } catch {
    return NextResponse.json({ error: "Ugyldig checkout-data." }, { status: 400 });
  }

  const consolidatedItems = consolidateCartItems(payload.items);
  const products = await getStorefrontProductsByIds(consolidatedItems.map((item) => item.productId));

  if (products.length !== consolidatedItems.length) {
    return NextResponse.json({ error: "En eller flere produkter ble ikke funnet i katalogen." }, { status: 400 });
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  const orderItems = consolidatedItems.map((item) => {
    const product = productById.get(item.productId);

    if (!product) {
      throw new Error("Produkt mangler.");
    }

    const unitPriceNok = Math.max(0, Math.round(product.unitPriceNok));
    const quantity = Math.max(1, Math.round(item.quantity));
    const lineTotalNok = unitPriceNok * quantity;

    return {
      product,
      quantity,
      unitPriceNok,
      lineTotalNok,
    };
  });

  const subtotalNok = orderItems.reduce((sum, item) => sum + item.lineTotalNok, 0);
  const shippingNok = calculateShippingNok(subtotalNok);
  const totalNok = subtotalNok + shippingNok;
  const vatNok = Math.round(totalNok * 0.2);

  const { data: createdOrder, error: createOrderError } = await supabase
    .from("shop_orders")
    .insert({
      status: "draft",
      currency: "NOK",
      customer_email: payload.customer.email,
      customer_name: payload.customer.fullName,
      customer_phone: payload.customer.phone,
      shipping_address_line1: payload.customer.addressLine1,
      shipping_postal_code: payload.customer.postalCode,
      shipping_city: payload.customer.city,
      customer_note: payload.customer.notes ?? "",
      subtotal_nok: subtotalNok,
      shipping_nok: shippingNok,
      vat_nok: vatNok,
      total_nok: totalNok,
      checkout_flow: payload.checkoutFlow,
    })
    .select("id, public_token")
    .single();

  if (createOrderError || !createdOrder) {
    return NextResponse.json({ error: "Kunne ikke opprette butikkordre." }, { status: 500 });
  }

  const rows = orderItems.map((item) => ({
    order_id: createdOrder.id,
    product_id: item.product.id,
    product_slug: item.product.slug,
    nobb_number: item.product.nobbNumber,
    product_name: item.product.productName,
    supplier_name: item.product.supplierName,
    category: item.product.category,
    unit: item.product.priceUnit ?? item.product.unit,
    quantity: item.quantity,
    unit_price_nok: item.unitPriceNok,
    line_total_nok: item.lineTotalNok,
    metadata: {
      brand: item.product.brand,
      sectionTitle: item.product.sectionTitle,
      quantitySuggestion: item.product.quantitySuggestion,
      source: item.product.source,
    },
  }));

  const { error: insertItemsError } = await supabase.from("shop_order_items").insert(rows);

  if (insertItemsError) {
    await supabase.from("shop_orders").delete().eq("id", createdOrder.id);
    return NextResponse.json({ error: "Kunne ikke lagre varelinjene i ordren." }, { status: 500 });
  }

  const origin = resolveCheckoutOrigin(request.url);

  if (isStripeBypassed()) {
    await supabase
      .from("shop_orders")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
      })
      .eq("id", createdOrder.id);

    return NextResponse.json({
      url: `${origin}/ordre/${createdOrder.public_token}?paid=1&test_mode=1`,
    });
  }

  const stripe = getStripe();

  if (!stripe) {
    return NextResponse.json({ error: "Stripe er ikke konfigurert." }, { status: 503 });
  }

  const paymentMethodTypes =
    payload.checkoutFlow === "klarna"
      ? (["klarna"] as const)
      : (["card"] as const);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: payload.customer.email,
      success_url: `${origin}/betaling/suksess?session_id={CHECKOUT_SESSION_ID}&shop_order_token=${createdOrder.public_token}`,
      cancel_url: `${origin}/checkout?betaling=avbrutt`,
      metadata: {
        kind: "shop_order",
        shopOrderId: createdOrder.id,
        shopOrderToken: String(createdOrder.public_token),
        checkoutFlow: payload.checkoutFlow,
      },
      payment_method_types: [...paymentMethodTypes],
      billing_address_collection: payload.checkoutFlow === "klarna" ? "required" : "auto",
      line_items: [
        ...orderItems.map((item) => ({
          quantity: item.quantity,
          price_data: {
            currency: "nok",
            product_data: {
              name: item.product.productName,
              description: `${item.product.brand ? `${item.product.brand} · ` : ""}Art.nr ${item.product.nobbNumber}`,
            },
            unit_amount: item.unitPriceNok * 100,
          },
        })),
        ...(shippingNok > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: "nok",
                  product_data: {
                    name: "Frakt og håndtering",
                    description: "Standard levering fra ProAnbud nettbutikk.",
                  },
                  unit_amount: shippingNok * 100,
                },
              },
            ]
          : []),
      ],
    });

    await supabase
      .from("shop_orders")
      .update({
        status: "pending_payment",
        checkout_session_id: session.id,
      })
      .eq("id", createdOrder.id);

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kunne ikke starte Stripe-checkout.";
    const klarnaNotReady =
      payload.checkoutFlow === "klarna" &&
      /klarna/i.test(message) &&
      /(activated|enable|supported|available)/i.test(message);

    await supabase.from("shop_orders").update({ status: "failed" }).eq("id", createdOrder.id);

    return NextResponse.json(
      {
        error: klarnaNotReady
          ? "Klarna er ikke aktivert i Stripe-kontoen ennå. Aktiver Klarna i Stripe Dashboard og prøv igjen."
          : "Kunne ikke starte betaling for handlekurven.",
      },
      { status: 400 },
    );
  }
}

function consolidateCartItems(items: Array<{ productId: string; quantity: number }>) {
  const consolidated = new Map<string, number>();

  for (const item of items) {
    consolidated.set(item.productId, (consolidated.get(item.productId) ?? 0) + item.quantity);
  }

  return Array.from(consolidated.entries()).map(([productId, quantity]) => ({
    productId,
    quantity: Math.max(1, Math.min(999, Math.round(quantity))),
  }));
}

function calculateShippingNok(subtotalNok: number) {
  if (subtotalNok <= 0) {
    return 0;
  }

  if (subtotalNok >= 5000) {
    return 0;
  }

  return Math.max(199, Math.min(999, Math.round(subtotalNok * 0.035)));
}

function resolveCheckoutOrigin(requestUrl: string) {
  const url = new URL(requestUrl);
  return url.origin;
}
