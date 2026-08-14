"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/app/sjefen/_components/action-form";
import { requireAdminDb } from "@/lib/admin-data";

/**
 * Påslag styrer utsalgsprisen i hele butikken. Tidligere ble lagringen gjort
 * med den innloggede brukerens klient og feil ble kastet bort, så et mislykket
 * lagringsforsøk så nøyaktig ut som et vellykket.
 */
export async function updateMarkupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const db = await requireAdminDb();

  const id = String(formData.get("id") ?? "").trim();
  const percentage = Number.parseFloat(String(formData.get("percentage") ?? ""));
  const fixed = Number.parseFloat(String(formData.get("fixed") ?? ""));

  if (!id) return { ok: false, message: "Mangler leverandør-ID." };

  if (!Number.isFinite(percentage) || percentage < -100 || percentage > 500) {
    return { ok: false, message: "Påslag i prosent må være et tall mellom -100 og 500." };
  }

  if (!Number.isFinite(fixed) || fixed < -100_000 || fixed > 100_000) {
    return { ok: false, message: "Fast påslag må være et tall mellom -100 000 og 100 000." };
  }

  const { error } = await db
    .from("supplier_markups")
    .update({ markup_percentage: percentage, markup_fixed: fixed })
    .eq("id", id);

  if (error) {
    return { ok: false, message: `Kunne ikke lagre: ${error.message}` };
  }

  revalidatePath("/sjefen/innstillinger");
  return { ok: true, message: `Lagret: ${percentage} % + ${fixed} kr.` };
}
