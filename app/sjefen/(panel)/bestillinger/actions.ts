"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/app/sjefen/_components/action-form";
import { requireAdminDb } from "@/lib/admin-data";

const PARTNER_STATUSES = ["pending", "processing", "out_for_delivery", "delivered", "cancelled"];

/**
 * Partnertildeling og partnerstatus for materialbestillinger. Dette lå
 * tidligere på /admin/orders, som kun var innloggingsbeskyttet — altså kunne
 * enhver registrert kunde endre det. Nå krever det administrator.
 */
export async function updateMaterialPartnerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const db = await requireAdminDb();

  const orderId = String(formData.get("orderId") ?? "").trim();
  const partnerStatus = String(formData.get("partnerStatus") ?? "").trim();
  const partnerIdRaw = String(formData.get("partnerId") ?? "").trim();

  if (!orderId) return { ok: false, message: "Mangler ordre-ID." };
  if (!PARTNER_STATUSES.includes(partnerStatus)) {
    return { ok: false, message: "Ugyldig partnerstatus." };
  }

  const { error } = await db
    .from("material_orders")
    .update({ partner_status: partnerStatus, partner_id: partnerIdRaw || null })
    .eq("id", orderId);

  if (error) return { ok: false, message: `Kunne ikke lagre: ${error.message}` };

  revalidatePath("/sjefen/bestillinger");
  return { ok: true, message: "Partner oppdatert." };
}
