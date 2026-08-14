import type Stripe from "stripe";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { osloDateOf } from "./daybook";
import { buildRefundJournalEntry, postJournalEntry, type RefundDraft } from "./fiken";

/**
 * Bokfører refusjoner som kreditnota.
 *
 * En refusjon som ikke bokføres gjør to ting galt samtidig: omsetningen blir
 * stående for høy, og vi betaler utgående mva på et salg som er reversert.
 * Bilaget legges på REFUSJONSDATOEN, ikke tilbake på salgsdagen — den dagen er
 * som regel allerede bokført og avstemt, og skal ikke røres.
 */

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

type OrderRow = {
  id: string;
  order_number: number | null;
  slug: string | null;
  subtotal_nok: number | null;
  shipping_nok: number | null;
  total_nok: number | null;
};

export type RefundRunResult = {
  stripeRefundId: string;
  status: "posted" | "dry_run" | "skipped_already_posted" | "skipped_unknown_order" | "failed";
  totalGrossOre: number;
  needsReview: boolean;
  journalEntryId?: string | null;
  error?: string;
};

/**
 * Fordeler et refundert beløp mellom varer og frakt.
 *
 * Full refusjon er entydig: ordrens egne tall reverseres. Delvis refusjon er
 * det IKKE — Stripe forteller bare hvor mange kroner som gikk tilbake, ikke hva
 * de gjaldt. Vi antar at delrefusjoner gjelder varer (som er det normale: en
 * vare returneres, frakten er allerede påløpt), og flagger raden for manuell
 * kontroll i stedet for å late som fordelingen er utledet.
 */
export function splitRefund(
  order: { subtotalNok: number; shippingNok: number; totalNok: number },
  refundedOre: number,
): { goodsGrossOre: number; shippingGrossOre: number; isFullRefund: boolean; needsReview: boolean } {
  const totalOre = Math.round(order.totalNok * 100);

  if (refundedOre >= totalOre) {
    return {
      goodsGrossOre: Math.round(order.subtotalNok * 100),
      shippingGrossOre: Math.round(order.shippingNok * 100),
      isFullRefund: true,
      needsReview: false,
    };
  }

  const goodsOre = Math.round(order.subtotalNok * 100);

  return {
    // Overstiger delrefusjonen varesummen, må resten nødvendigvis være frakt.
    goodsGrossOre: Math.min(refundedOre, goodsOre),
    shippingGrossOre: Math.max(0, refundedOre - goodsOre),
    isFullRefund: false,
    needsReview: true,
  };
}

/** Bokfører én refusjon. Idempotent på Stripes refusjons-id. */
export async function recordStripeRefund(
  refund: Stripe.Refund,
  paymentIntentId: string | null,
): Promise<RefundRunResult> {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role er ikke konfigurert.");
  }

  const { data: existing } = await supabase
    .from("accounting_refunds")
    .select("id, fiken_journal_entry_id, total_gross_ore, needs_review, attempts")
    .eq("stripe_refund_id", refund.id)
    .maybeSingle();

  if (existing?.fiken_journal_entry_id) {
    return {
      stripeRefundId: refund.id,
      status: "skipped_already_posted",
      totalGrossOre: existing.total_gross_ore ?? 0,
      needsReview: existing.needs_review ?? false,
      journalEntryId: existing.fiken_journal_entry_id,
    };
  }

  const order = await findOrderForRefund(supabase, paymentIntentId);

  // Uten ordren vet vi ikke hva som ble refundert, og et bilag basert på
  // gjetning er verre enn ingen bilag. Logges så det kan tas manuelt.
  if (!order) {
    console.error(
      `[accounting] Refusjon ${refund.id} kunne ikke kobles til en ordre (payment_intent=${paymentIntentId}). Må bokføres manuelt.`,
    );
    return {
      stripeRefundId: refund.id,
      status: "skipped_unknown_order",
      totalGrossOre: refund.amount,
      needsReview: true,
    };
  }

  const split = splitRefund(
    {
      subtotalNok: order.subtotal_nok ?? 0,
      shippingNok: order.shipping_nok ?? 0,
      totalNok: order.total_nok ?? 0,
    },
    refund.amount,
  );

  const orderReference =
    order.order_number != null ? `#${order.order_number}` : (order.slug ?? order.id.slice(0, 8));

  const draft: RefundDraft = {
    stripeRefundId: refund.id,
    refundDate: osloDateOf(new Date(refund.created * 1000)),
    orderReference,
    goodsGrossOre: split.goodsGrossOre,
    shippingGrossOre: split.shippingGrossOre,
  };

  const { error: upsertError } = await supabase.from("accounting_refunds").upsert(
    {
      stripe_refund_id: refund.id,
      order_id: order.id,
      refund_date: draft.refundDate,
      goods_gross_ore: draft.goodsGrossOre,
      shipping_gross_ore: draft.shippingGrossOre,
      total_gross_ore: refund.amount,
      is_full_refund: split.isFullRefund,
      needs_review: split.needsReview,
      status: "pending",
      attempts: (existing?.attempts ?? 0) + 1,
    },
    { onConflict: "stripe_refund_id" },
  );

  if (upsertError) {
    throw new Error(`Kunne ikke lagre refusjon ${refund.id}: ${upsertError.message}`);
  }

  try {
    const result = await postJournalEntry(buildRefundJournalEntry(draft));

    if (!result.posted) {
      return {
        stripeRefundId: refund.id,
        status: "dry_run",
        totalGrossOre: refund.amount,
        needsReview: split.needsReview,
        journalEntryId: null,
      };
    }

    await supabase
      .from("accounting_refunds")
      .update({
        status: "posted",
        fiken_journal_entry_id: result.journalEntryId,
        posted_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("stripe_refund_id", refund.id);

    return {
      stripeRefundId: refund.id,
      status: "posted",
      totalGrossOre: refund.amount,
      needsReview: split.needsReview,
      journalEntryId: result.journalEntryId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await supabase
      .from("accounting_refunds")
      .update({ status: "failed", error_message: message })
      .eq("stripe_refund_id", refund.id);

    return {
      stripeRefundId: refund.id,
      status: "failed",
      totalGrossOre: refund.amount,
      needsReview: split.needsReview,
      error: message,
    };
  }
}

async function findOrderForRefund(
  supabase: AdminClient,
  paymentIntentId: string | null,
): Promise<OrderRow | null> {
  if (!paymentIntentId) {
    return null;
  }

  const { data } = await supabase
    .from("shop_orders")
    .select("id, order_number, slug, subtotal_nok, shipping_nok, total_nok")
    .eq("payment_intent_id", paymentIntentId)
    .maybeSingle<OrderRow>();

  return data ?? null;
}
