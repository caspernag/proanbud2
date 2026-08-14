import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import {
  buildDaybookDraft,
  osloDayRange,
  previousOsloDate,
  type DaybookDraft,
  type DaybookOrderInput,
} from "./daybook";
import { buildDaybookJournalEntry, postJournalEntry } from "./fiken";

/**
 * Kjører dagsoppgjøret: bygger bilaget, lagrer det, og poster til Fiken.
 *
 * IDEMPOTENS ER HELE POENGET HER. Fiken-bilag kan ikke slettes, bare
 * tilbakeføres, så et dobbeltpostet bilag er manuelt opprydningsarbeid i
 * regnskapet. Vernet er `accounting_daybook.fiken_journal_entry_id`: er den
 * satt, har vi allerede postet den dagen, og vi rører den aldri igjen — uansett
 * hvor mange ganger cron kjører.
 */

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

type ShopOrderRow = {
  id: string;
  subtotal_nok: number | null;
  shipping_nok: number | null;
  total_nok: number | null;
};

export type DaybookRunResult = {
  bookingDate: string;
  status: "posted" | "dry_run" | "skipped_already_posted" | "skipped_empty" | "failed";
  orderCount: number;
  grossOre: number;
  journalEntryId?: string | null;
  error?: string;
};

/** Ordrene som hører til bokføringsdøgnet, hentet på norsk tid. */
async function loadOrdersForDate(supabase: AdminClient, bookingDate: string): Promise<DaybookOrderInput[]> {
  const { fromIso, toIso } = osloDayRange(bookingDate);

  const { data, error } = await supabase
    .from("shop_orders")
    .select("id, subtotal_nok, shipping_nok, total_nok")
    .in("status", ["paid", "fulfilled"])
    .gte("paid_at", fromIso)
    .lt("paid_at", toIso)
    .order("paid_at");

  if (error) {
    throw new Error(`Kunne ikke hente ordre for ${bookingDate}: ${error.message}`);
  }

  return (data ?? []).map((row: ShopOrderRow) => ({
    id: row.id,
    subtotalNok: row.subtotal_nok ?? 0,
    shippingNok: row.shipping_nok ?? 0,
    totalNok: row.total_nok ?? 0,
  }));
}

/**
 * Bokfører ett døgn. Trygg å kalle om igjen på samme dato.
 */
export async function runDaybookForDate(bookingDate: string): Promise<DaybookRunResult> {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role er ikke konfigurert.");
  }

  // Er dagen allerede postet, stopper vi før vi bygger noe som helst.
  const { data: existing } = await supabase
    .from("accounting_daybook")
    .select("id, status, fiken_journal_entry_id, order_count, gross_ore, attempts")
    .eq("booking_date", bookingDate)
    .maybeSingle();

  if (existing?.fiken_journal_entry_id) {
    return {
      bookingDate,
      status: "skipped_already_posted",
      orderCount: existing.order_count ?? 0,
      grossOre: existing.gross_ore ?? 0,
      journalEntryId: existing.fiken_journal_entry_id,
    };
  }

  const orders = await loadOrdersForDate(supabase, bookingDate);

  // En dag uten salg skal ikke gi et nullbilag i regnskapet. Vi lagrer heller
  // ingen rad, slik at dagen fanges opp på nytt hvis en betaling skulle bli
  // etterregistrert.
  if (orders.length === 0) {
    return { bookingDate, status: "skipped_empty", orderCount: 0, grossOre: 0 };
  }

  const draft = buildDaybookDraft(bookingDate, orders);

  await upsertDraft(supabase, draft, existing?.attempts ?? 0);

  try {
    const result = await postJournalEntry(buildDaybookJournalEntry(draft));

    if (!result.posted) {
      // Tørrmodus: bilaget står som `pending` og postes den dagen Fiken-nøkkelen
      // finnes. Ingenting går tapt i mellomtiden.
      return {
        bookingDate,
        status: "dry_run",
        orderCount: draft.orderCount,
        grossOre: draft.grossOre,
        journalEntryId: null,
      };
    }

    await supabase
      .from("accounting_daybook")
      .update({
        status: "posted",
        fiken_journal_entry_id: result.journalEntryId,
        posted_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("booking_date", bookingDate);

    return {
      bookingDate,
      status: "posted",
      orderCount: draft.orderCount,
      grossOre: draft.grossOre,
      journalEntryId: result.journalEntryId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await supabase
      .from("accounting_daybook")
      .update({ status: "failed", error_message: message })
      .eq("booking_date", bookingDate);

    return {
      bookingDate,
      status: "failed",
      orderCount: draft.orderCount,
      grossOre: draft.grossOre,
      error: message,
    };
  }
}

async function upsertDraft(supabase: AdminClient, draft: DaybookDraft, previousAttempts: number) {
  const { error } = await supabase.from("accounting_daybook").upsert(
    {
      booking_date: draft.bookingDate,
      gross_ore: draft.grossOre,
      goods_net_ore: draft.goodsNetOre,
      shipping_net_ore: draft.shippingNetOre,
      outgoing_vat_ore: draft.outgoingVatOre,
      order_count: draft.orderCount,
      order_ids: draft.orderIds,
      status: "pending",
      attempts: previousAttempts + 1,
    },
    { onConflict: "booking_date" },
  );

  if (error) {
    throw new Error(`Kunne ikke lagre dagsoppgjør ${draft.bookingDate}: ${error.message}`);
  }
}

/**
 * Cron-kjøringen: tar gårsdagen, og rydder samtidig opp i eldre dager som ikke
 * ble postet. Uten opprydningen ville én feilet natt blitt et hull i regnskapet
 * som ingen oppdager før terminoppgjøret.
 */
export async function runDaybookCatchUp(now: Date = new Date()): Promise<DaybookRunResult[]> {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role er ikke konfigurert.");
  }

  const dates = new Set<string>([previousOsloDate(now)]);

  const { data: unposted } = await supabase
    .from("accounting_daybook")
    .select("booking_date")
    .is("fiken_journal_entry_id", null)
    .order("booking_date")
    .limit(30);

  for (const row of unposted ?? []) {
    if (row.booking_date) dates.add(row.booking_date as string);
  }

  const results: DaybookRunResult[] = [];

  for (const date of Array.from(dates).sort()) {
    results.push(await runDaybookForDate(date));
  }

  return results;
}
