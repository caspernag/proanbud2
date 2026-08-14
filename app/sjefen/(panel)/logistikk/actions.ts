"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/app/sjefen/_components/action-form";
import { requireAdminUser } from "@/lib/admin-auth";
import { isShopOrderStatus, isShopOrderTransportStatus, logShopOrderEvent } from "@/lib/shop-order";
import {
  advanceLogisticsStage,
  applyLogisticsUpdate,
  resendStatusNotification,
} from "@/lib/shop-order-logistics-admin";
import { resendByggmakkerOrderEmail } from "@/lib/stripe-checkout-reconciliation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Server Actions er nåbare via direkte POST, ikke bare gjennom vårt eget UI.
 * Derfor kaller hver enkelt action requireAdminUser() før den rører data.
 *
 * ActionState bor i action-form.tsx: en "use server"-fil skal kun eksportere
 * asynkrone funksjoner.
 */

function refresh(orderId?: string) {
  revalidatePath("/sjefen/logistikk");
  revalidatePath("/sjefen/bestillinger");
  if (orderId) revalidatePath(`/sjefen/logistikk/${orderId}`);
}

export async function updateLogisticsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdminUser();
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, message: "Database ikke konfigurert." };

  const orderId = str(formData.get("orderId"));
  const transportStatus = str(formData.get("transportStatus"));
  const orderStatus = str(formData.get("orderStatus"));

  if (!orderId || !isShopOrderTransportStatus(transportStatus)) {
    return { ok: false, message: "Ugyldig transportstatus." };
  }

  const result = await applyLogisticsUpdate(supabase, {
    orderId,
    transportStatus,
    orderStatus: isShopOrderStatus(orderStatus) ? orderStatus : null,
    carrierCode: str(formData.get("carrierCode")),
    trackingNumber: str(formData.get("trackingNumber")),
    trackingUrl: str(formData.get("trackingUrl")),
    estimatedDeliveryDate: str(formData.get("estimatedDeliveryDate")),
    statusNote: str(formData.get("statusNote")),
    internalNote: str(formData.get("internalNote")),
    notifyCustomer: formData.get("notifyCustomer") === "on",
    actorLabel: user.email ?? "Prisbygg logistikk",
  });

  refresh(orderId);

  if (!result.ok) return { ok: false, message: result.error };
  if (result.emailError) {
    return { ok: true, message: `Lagret, men varselet til kunden feilet: ${result.emailError}` };
  }
  return { ok: true, message: result.emailed ? "Lagret og kunden er varslet." : "Lagret." };
}

export async function advanceStageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdminUser();
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, message: "Database ikke konfigurert." };

  const orderId = str(formData.get("orderId"));
  if (!orderId) return { ok: false, message: "Mangler ordre-ID." };

  const result = await advanceLogisticsStage(supabase, {
    orderId,
    notifyCustomer: formData.get("notifyCustomer") !== "off",
    actorLabel: user.email ?? "Prisbygg logistikk",
  });

  refresh(orderId);

  if (!result.ok) return { ok: false, message: result.error };
  if (result.emailError) {
    return { ok: true, message: `Flyttet videre, men varselet feilet: ${result.emailError}` };
  }
  return { ok: true, message: result.emailed ? "Flyttet videre og kunden er varslet." : "Flyttet videre." };
}

export async function bulkAdvanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdminUser();
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, message: "Database ikke konfigurert." };

  const orderIds = formData
    .getAll("orderIds")
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (orderIds.length === 0) return { ok: false, message: "Ingen ordre valgt." };

  const notifyCustomer = formData.get("notifyCustomer") === "on";
  let moved = 0;
  const failures: string[] = [];

  // Sekvensielt med vilje: hver ordre kan sende e-post, og vi vil ikke
  // treffe Resend sin rate limit med et lass parallelle utsendinger.
  for (const orderId of orderIds) {
    const result = await advanceLogisticsStage(supabase, {
      orderId,
      notifyCustomer,
      actorLabel: user.email ?? "Prisbygg logistikk",
    });

    if (result.ok) {
      moved += 1;
      if (result.emailError) failures.push(`varsel feilet for ${orderId.slice(0, 8)}`);
    } else {
      failures.push(`${orderId.slice(0, 8)}: ${result.error}`);
    }

    refresh(orderId);
  }

  refresh();

  const summary = `${moved} av ${orderIds.length} ordre flyttet videre.`;
  return failures.length > 0
    ? { ok: moved > 0, message: `${summary} Avvik: ${failures.join("; ")}` }
    : { ok: true, message: summary };
}

export async function resendStatusEmailAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminUser();
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, message: "Database ikke konfigurert." };

  const orderId = str(formData.get("orderId"));
  if (!orderId) return { ok: false, message: "Mangler ordre-ID." };

  const result = await resendStatusNotification(supabase, orderId);
  refresh(orderId);

  return result.ok
    ? { ok: true, message: "Statusoppdatering sendt til kunden." }
    : { ok: false, message: result.error ?? "Kunne ikke sende." };
}

export async function saveInternalNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdminUser();
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, message: "Database ikke konfigurert." };

  const orderId = str(formData.get("orderId"));
  if (!orderId) return { ok: false, message: "Mangler ordre-ID." };

  const note = str(formData.get("internalNote")).slice(0, 4000);

  const { error } = await supabase.from("shop_orders").update({ internal_note: note }).eq("id", orderId);
  if (error) return { ok: false, message: `Kunne ikke lagre: ${error.message}` };

  await logShopOrderEvent(supabase, {
    orderId,
    eventType: "admin_internal_note_updated",
    actorType: "admin",
    actorLabel: user.email ?? "Prisbygg logistikk",
    message: "Internt notat oppdatert.",
    customerVisible: false,
  });

  refresh(orderId);
  return { ok: true, message: "Internt notat lagret." };
}

export async function sendCustomerMessageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminUser();
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, message: "Database ikke konfigurert." };

  const orderId = str(formData.get("orderId"));
  const body = str(formData.get("message"));

  if (!orderId) return { ok: false, message: "Mangler ordre-ID." };
  if (body.length < 2 || body.length > 2000) {
    return { ok: false, message: "Meldingen må være mellom 2 og 2000 tegn." };
  }

  const { error } = await supabase.from("shop_order_messages").insert({
    order_id: orderId,
    author_type: "admin",
    author_name: "Prisbygg support",
    author_email: null,
    body,
  });

  if (error) return { ok: false, message: `Kunne ikke sende: ${error.message}` };

  await logShopOrderEvent(supabase, {
    orderId,
    eventType: "admin_message_created",
    actorType: "admin",
    actorLabel: "Prisbygg support",
    message: "Support svarte kunden.",
    payload: { messageLength: body.length },
  });

  refresh(orderId);
  return { ok: true, message: "Svar sendt." };
}

export async function resendByggmakkerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminUser();

  const orderId = str(formData.get("orderId"));
  if (!orderId) return { ok: false, message: "Mangler ordre-ID." };

  try {
    await resendByggmakkerOrderEmail(orderId);
    refresh(orderId);
    return { ok: true, message: "Bestilling sendt til Byggmakker." };
  } catch (error) {
    // Feilen er allerede logget i ordreloggen av hjelperen.
    refresh(orderId);
    const message = error instanceof Error ? error.message : "Ukjent feil";
    return { ok: false, message: `Sending feilet: ${message}` };
  }
}

function str(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim();
}

/**
 * Faktiske kostnader for en ordre. Beløpene lagres EKS. MVA, siden inngående
 * mva er fradragsberettiget og dekningsbidraget regnes uten mva på begge sider.
 */
export async function saveOrderCostsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdminUser();
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, message: "Database ikke konfigurert." };

  const orderId = str(formData.get("orderId"));
  if (!orderId) return { ok: false, message: "Mangler ordre-ID." };

  const goods = parseCost(formData.get("goodsCostNok"));
  const freight = parseCost(formData.get("freightCostNok"));
  const other = parseCost(formData.get("otherCostNok"));

  if (goods === "invalid") return { ok: false, message: "Varekost må være et tall i kroner." };
  if (freight === "invalid") return { ok: false, message: "Fraktkostnad må være et tall i kroner." };
  if (other === "invalid") return { ok: false, message: "Andre kostnader må være et tall i kroner." };

  const { error } = await supabase
    .from("shop_orders")
    .update({
      goods_cost_nok: goods,
      freight_cost_nok: freight,
      other_cost_nok: other,
      cost_note: str(formData.get("costNote")).slice(0, 2000),
    })
    .eq("id", orderId);

  if (error) return { ok: false, message: `Kunne ikke lagre: ${error.message}` };

  refresh(orderId);
  return { ok: true, message: "Kostnader lagret." };
}

/** Tomt felt betyr «ikke registrert» (null), ikke null kroner. */
function parseCost(value: FormDataEntryValue | null): number | null | "invalid" {
  const text = String(value ?? "").trim().replace(",", ".");
  if (text.length === 0) return null;

  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000_000) return "invalid";

  return Math.round(parsed);
}
