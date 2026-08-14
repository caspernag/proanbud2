import type Stripe from "stripe";

import { getStripe } from "@/lib/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { osloDateOf } from "./daybook";
import { buildPayoutJournalEntry, postJournalEntry, type PayoutDraft } from "./fiken";

/**
 * Bokfører Stripe-utbetalinger til bank.
 *
 * HVORFOR DETTE ER NØDVENDIG: salgsbilaget debiterer Stripe-mellomkontoen med
 * brutto. Uten et motstykke vokser den kontoen i det uendelige, og bankkontoen
 * i Fiken stemmer aldri med den ekte. Utbetalingsbilaget er det som lukker
 * sløyfa — og gebyret, som er differansen mellom brutto og utbetalt, er
 * kostnaden som blir synlig først her.
 */

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export type PayoutRunResult = {
  stripePayoutId: string;
  status: "posted" | "dry_run" | "skipped_already_posted" | "failed";
  netOre: number;
  feeOre: number;
  journalEntryId?: string | null;
  error?: string;
};

/**
 * Summerer gebyrene som inngår i en utbetaling.
 *
 * Stripe oppgir ikke gebyret på selve utbetalingen; det ligger på hver enkelt
 * transaksjon. Vi henter transaksjonene som er avregnet i utbetalingen og
 * summerer. `payout`-linjen selv er utbetalingen ut av Stripe-saldoen og skal
 * ikke telles med i brutto.
 */
async function summarisePayout(
  stripe: Stripe,
  payout: Stripe.Payout,
): Promise<{ draft: PayoutDraft; balanceTxnIds: string[] }> {
  let grossOre = 0;
  let feeOre = 0;
  const balanceTxnIds: string[] = [];

  for await (const transaction of stripe.balanceTransactions.list({ payout: payout.id, limit: 100 })) {
    if (transaction.type === "payout") {
      continue;
    }

    grossOre += transaction.amount;
    feeOre += transaction.fee;
    balanceTxnIds.push(transaction.id);
  }

  return {
    draft: {
      stripePayoutId: payout.id,
      payoutDate: osloDateOf(new Date(payout.arrival_date * 1000)),
      grossOre,
      feeOre,
      // Utbetalt beløp er fasit fra Stripe, ikke noe vi regner ut selv.
      netOre: payout.amount,
    },
    balanceTxnIds,
  };
}

/**
 * Bokfører én utbetaling. Idempotent på `stripe_payout_id` — Stripe kan sende
 * samme webhook flere ganger, og bilaget skal bare finnes én gang.
 */
export async function recordStripePayout(payout: Stripe.Payout): Promise<PayoutRunResult> {
  const supabase = createSupabaseAdminClient();
  const stripe = getStripe();

  if (!supabase) {
    throw new Error("Supabase service role er ikke konfigurert.");
  }

  if (!stripe) {
    throw new Error("Stripe er ikke konfigurert.");
  }

  const { data: existing } = await supabase
    .from("accounting_payouts")
    .select("id, fiken_journal_entry_id, net_ore, fee_ore, attempts")
    .eq("stripe_payout_id", payout.id)
    .maybeSingle();

  if (existing?.fiken_journal_entry_id) {
    return {
      stripePayoutId: payout.id,
      status: "skipped_already_posted",
      netOre: existing.net_ore ?? 0,
      feeOre: existing.fee_ore ?? 0,
      journalEntryId: existing.fiken_journal_entry_id,
    };
  }

  const { draft, balanceTxnIds } = await summarisePayout(stripe, payout);

  await upsertPayout(supabase, draft, existing?.attempts ?? 0);
  await tagOrdersWithPayout(supabase, payout.id, balanceTxnIds);

  try {
    const result = await postJournalEntry(buildPayoutJournalEntry(draft));

    if (!result.posted) {
      return {
        stripePayoutId: payout.id,
        status: "dry_run",
        netOre: draft.netOre,
        feeOre: draft.feeOre,
        journalEntryId: null,
      };
    }

    await supabase
      .from("accounting_payouts")
      .update({
        status: "posted",
        fiken_journal_entry_id: result.journalEntryId,
        posted_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("stripe_payout_id", payout.id);

    return {
      stripePayoutId: payout.id,
      status: "posted",
      netOre: draft.netOre,
      feeOre: draft.feeOre,
      journalEntryId: result.journalEntryId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await supabase
      .from("accounting_payouts")
      .update({ status: "failed", error_message: message })
      .eq("stripe_payout_id", payout.id);

    return {
      stripePayoutId: payout.id,
      status: "failed",
      netOre: draft.netOre,
      feeOre: draft.feeOre,
      error: message,
    };
  }
}

async function upsertPayout(supabase: AdminClient, draft: PayoutDraft, previousAttempts: number) {
  const { error } = await supabase.from("accounting_payouts").upsert(
    {
      stripe_payout_id: draft.stripePayoutId,
      payout_date: draft.payoutDate,
      gross_ore: draft.grossOre,
      fee_ore: draft.feeOre,
      net_ore: draft.netOre,
      status: "pending",
      attempts: previousAttempts + 1,
    },
    { onConflict: "stripe_payout_id" },
  );

  if (error) {
    throw new Error(`Kunne ikke lagre utbetaling ${draft.stripePayoutId}: ${error.message}`);
  }
}

/**
 * Merker ordrene som inngår i utbetalingen, slik at man kan gå fra en
 * bankinnbetaling til de konkrete salgene bak den. Rent sporingsarbeid — feiler
 * det, skal ikke bilaget stoppe.
 */
async function tagOrdersWithPayout(supabase: AdminClient, payoutId: string, balanceTxnIds: string[]) {
  if (balanceTxnIds.length === 0) {
    return;
  }

  try {
    await supabase
      .from("shop_orders")
      .update({ stripe_payout_id: payoutId })
      .in("stripe_balance_txn_id", balanceTxnIds);
  } catch (error) {
    console.error(
      `[accounting] Kunne ikke merke ordre med utbetaling ${payoutId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}
