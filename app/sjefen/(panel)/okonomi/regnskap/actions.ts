"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/app/sjefen/_components/action-form";
import { runDaybookCatchUp, runDaybookForDate } from "@/lib/accounting/post-daybook";
import { requireAdminUser } from "@/lib/admin-auth";

/**
 * Postering på nytt er en EKSPLISITT admin-handling, aldri en automatisk
 * retry-løkke. Et bilag som feilet kan ha rukket å bli opprettet i Fiken før
 * feilen oppsto, og Fiken-bilag kan ikke slettes — bare tilbakeføres. Derfor
 * skal et menneske se på dagen før den forsøkes igjen.
 */
export async function retryDaybookAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminUser();

  const bookingDate = String(formData.get("bookingDate") ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
    return { ok: false, message: "Ugyldig dato." };
  }

  try {
    const result = await runDaybookForDate(bookingDate);
    revalidatePath("/sjefen/okonomi/regnskap");

    switch (result.status) {
      case "posted":
        return { ok: true, message: `Bokført i Fiken som bilag ${result.journalEntryId}.` };
      case "dry_run":
        return {
          ok: true,
          message: `Bilaget er bygget og lagret, men Fiken-nøkkel mangler — ingenting ble sendt.`,
        };
      case "skipped_already_posted":
        return { ok: true, message: `Allerede bokført som bilag ${result.journalEntryId}. Ikke rørt.` };
      case "skipped_empty":
        return { ok: true, message: "Ingen betalte ordre denne dagen." };
      default:
        return { ok: false, message: result.error ?? "Posteringen feilet." };
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Posteringen feilet." };
  }
}

/** Kjører samme opprydning som cron, men på kommando. */
export async function runDaybookCatchUpAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  await requireAdminUser();

  try {
    const results = await runDaybookCatchUp();
    revalidatePath("/sjefen/okonomi/regnskap");

    const failed = results.filter((result) => result.status === "failed");
    const handled = results.filter((result) => result.status !== "skipped_empty").length;

    if (failed.length > 0) {
      return { ok: false, message: `${failed.length} av ${results.length} dager feilet.` };
    }

    return { ok: true, message: `${handled} dag(er) behandlet.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Kjøringen feilet." };
  }
}
