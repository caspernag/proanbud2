import { NextResponse } from "next/server";
import { z } from "zod";

import { hasStripeWebhookEnv } from "@/lib/env";
import { orderLineUnit } from "@/lib/product-unit-pricing";
import { calculateShippingNok } from "@/lib/shipping";
import { createShopOrderSlug, logShopOrderEvent, normalizeShopOrderFulfillment } from "@/lib/shop-order";
import { getStorefrontProductsByIds } from "@/lib/storefront";
import { storefrontAgreementStores } from "@/lib/storefront-store-selection";
import { getStripe } from "@/lib/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const checkoutPayloadSchema = z.object({
  customer: z.object({
    email: z.string().email(),
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(6).max(40),
    addressLine1: z.string().trim().max(160).default(""),
    postalCode: z.string().trim().max(16).default(""),
    city: z.string().trim().max(80).default(""),
    notes: z.string().trim().max(1200).optional().default(""),
  }),
  deliveryMode: z.enum(["pickup", "delivery"]).default("pickup"),
  pickupStoreId: z.string().trim().max(120).optional().default(""),
  pickupStoreName: z.string().trim().max(200).optional().default(""),
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

  if (
    payload.deliveryMode === "delivery" &&
    (!payload.customer.addressLine1.trim() || !payload.customer.postalCode.trim() || !payload.customer.city.trim())
  ) {
    return NextResponse.json(
      { error: "Adresse, postnummer og by må fylles ut for levering." },
      { status: 400 },
    );
  }

  const fulfillment = normalizeShopOrderFulfillment({
    deliveryMode: payload.deliveryMode,
    addressLine1: payload.customer.addressLine1,
    postalCode: payload.customer.postalCode,
    city: payload.customer.city,
    pickupStoreId: payload.pickupStoreId,
    pickupStoreName: payload.pickupStoreName,
  });

  if (payload.deliveryMode === "pickup" && !fulfillment.pickup_store_id && !fulfillment.pickup_store_name) {
    return NextResponse.json({ error: "Velg en byggevarehandel før betaling." }, { status: 400 });
  }

  if (payload.deliveryMode === "pickup") {
    const isAgreementStore = storefrontAgreementStores().some(
      (store) => store.id === fulfillment.pickup_store_id,
    );
    if (!isAgreementStore) {
      return NextResponse.json(
        { error: "Denne butikken er ikke tilgjengelig for henting. Velg en byggevarehandel fra listen." },
        { status: 400 },
      );
    }
  }

  const subtotalNok = orderItems.reduce((sum, item) => sum + item.lineTotalNok, 0);
  const shippingNok = payload.deliveryMode === "pickup" ? 0 : calculateShippingNok(subtotalNok);
  const totalNok = subtotalNok + shippingNok;
  const vatNok = Math.round(totalNok * 0.2);
  const orderSlug = createShopOrderSlug();

  const { data: createdOrder, error: createOrderError } = await supabase
    .from("shop_orders")
    .insert({
      status: "draft",
      slug: orderSlug,
      transport_status: "pending",
      delivery_mode: fulfillment.delivery_mode,
      currency: "NOK",
      customer_email: payload.customer.email,
      customer_name: payload.customer.fullName,
      customer_phone: payload.customer.phone,
      shipping_address_line1: fulfillment.shipping_address_line1,
      shipping_postal_code: fulfillment.shipping_postal_code,
      shipping_city: fulfillment.shipping_city,
      pickup_store_id: fulfillment.pickup_store_id,
      pickup_store_name: fulfillment.pickup_store_name,
      customer_note: payload.customer.notes ?? "",
      subtotal_nok: subtotalNok,
      shipping_nok: shippingNok,
      vat_nok: vatNok,
      total_nok: totalNok,
      checkout_flow: payload.checkoutFlow,
    })
    .select("id, public_token, slug")
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
    unit: orderLineUnit({
      priceUnit: item.product.priceUnit,
      salesUnit: item.product.salesUnit,
      fallbackUnit: item.product.unit,
    }),
    quantity: item.quantity,
    unit_price_nok: item.unitPriceNok,
    line_total_nok: item.lineTotalNok,
    metadata: {
      brand: item.product.brand,
      sectionTitle: item.product.sectionTitle,
      priceUnit: item.product.priceUnit ?? item.product.unit,
      salesUnit: item.product.salesUnit ?? item.product.unit,
      salesUnitQuantity: item.product.salesUnitQuantity ?? null,
      packageAreaSqm: item.product.packageAreaSqm ?? null,
      quantitySuggestion: item.product.quantitySuggestion,
      source: item.product.source,
    },
  }));

  const { error: insertItemsError } = await supabase.from("shop_order_items").insert(rows);

  if (insertItemsError) {
    await supabase.from("shop_orders").delete().eq("id", createdOrder.id);
    return NextResponse.json({ error: "Kunne ikke lagre varelinjene i ordren." }, { status: 500 });
  }

  await logShopOrderEvent(supabase, {
    orderId: createdOrder.id,
    eventType: "order_created",
    actorType: "customer",
    actorLabel: payload.customer.fullName,
    message: "Ordren er opprettet og klar for betaling.",
    payload: {
      checkoutFlow: payload.checkoutFlow,
      itemCount: rows.length,
      totalNok,
    },
  });

  const origin = resolveCheckoutOrigin(request.url);

  const stripe = getStripe();

  if (!stripe) {
    return NextResponse.json({ error: "Stripe er ikke konfigurert." }, { status: 503 });
  }

  if (process.env.NODE_ENV === "production" && !hasStripeWebhookEnv()) {
    return NextResponse.json({ error: "Stripe webhook er ikke konfigurert." }, { status: 503 });
  }

  const paymentMethodTypes =
    payload.checkoutFlow === "klarna"
      ? (["klarna"] as const)
      : (["card"] as const);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: payload.customer.email,
      success_url: `${origin}/betaling/suksess?session_id={CHECKOUT_SESSION_ID}&shop_order_token=${createdOrder.public_token}&shop_order_slug=${createdOrder.slug ?? orderSlug}`,
      cancel_url: `${origin}/checkout?betaling=avbrutt`,
      metadata: {
        kind: "shop_order",
        shopOrderId: createdOrder.id,
        shopOrderToken: String(createdOrder.public_token),
        shopOrderSlug: createdOrder.slug ?? orderSlug,
        checkoutFlow: payload.checkoutFlow,
      },
      payment_intent_data: {
        receipt_email: payload.customer.email,
        metadata: {
          kind: "shop_order",
          shopOrderId: createdOrder.id,
          shopOrderToken: String(createdOrder.public_token),
          shopOrderSlug: createdOrder.slug ?? orderSlug,
          checkoutFlow: payload.checkoutFlow,
        },
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
                    description: "Standard levering fra Prisbygg nettbutikk.",
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

    await logShopOrderEvent(supabase, {
      orderId: createdOrder.id,
      eventType: "checkout_session_created",
      message: "Betaling er startet i Stripe.",
      payload: {
        checkoutSessionId: session.id,
        checkoutFlow: payload.checkoutFlow,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kunne ikke starte Stripe-checkout.";
    const klarnaNotReady =
      payload.checkoutFlow === "klarna" &&
      /klarna/i.test(message) &&
      /(activated|enable|supported|available)/i.test(message);

    await supabase.from("shop_orders").update({ status: "failed" }).eq("id", createdOrder.id);

    await logShopOrderEvent(supabase, {
      orderId: createdOrder.id,
      eventType: "checkout_session_failed",
      message: "Betalingen kunne ikke startes.",
      payload: { checkoutFlow: payload.checkoutFlow, error: message },
      customerVisible: false,
    });

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


function resolveCheckoutOrigin(requestUrl: string) {
  const url = new URL(requestUrl);
  return url.origin;
}
