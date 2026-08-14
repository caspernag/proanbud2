"use server";

import { revalidatePath } from "next/cache";

import type { ActionState } from "@/app/sjefen/_components/action-form";
import {
  applyToAllOrphans,
  completeImportRun,
  deleteOrphanProducts,
  getImportRun,
  keepOrphanProducts,
} from "@/lib/admin-product-price-import";
import { requireAdminDb } from "@/lib/admin-data";

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function revalidateProductPages(runId: string) {
  revalidatePath("/sjefen/produkter");
  revalidatePath(`/sjefen/produkter/import/${encodeURIComponent(runId)}`);
  revalidatePath("/");
}

/**
 * Bulkhandling på de valgte radene. Ett skjema, to knapper: knappen som ble
 * trykket sender med `intent`.
 */
export async function reviewSelectedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const db = await requireAdminDb();

  const runId = text(formData.get("runId"));
  const intent = text(formData.get("intent"));
  const productIds = formData
    .getAll("productIds")
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean);

  if (!runId) return { ok: false, message: "Mangler import-ID." };
  if (productIds.length === 0) {
    return { ok: false, message: "Ingen produkter er valgt." };
  }

  try {
    if (intent === "delete") {
      const deleted = await deleteOrphanProducts(db, runId, productIds);
      revalidateProductPages(runId);
      return { ok: true, message: `${deleted} produkt(er) slettet.` };
    }

    if (intent === "keep") {
      const kept = await keepOrphanProducts(db, runId, productIds);
      revalidateProductPages(runId);
      return { ok: true, message: `${kept} produkt(er) beholdt.` };
    }

    return { ok: false, message: "Ukjent handling." };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Handlingen kunne ikke fullføres.",
    };
  }
}

/**
 * Samme to handlinger, men på alt som ligger i gjennomgangen — eventuelt
 * begrenset til det aktive søket, slik at man kan rydde i grupper.
 */
export async function reviewAllAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const db = await requireAdminDb();

  const runId = text(formData.get("runId"));
  const intent = text(formData.get("intent"));
  const q = text(formData.get("q"));
  const scope = text(formData.get("scope"));

  if (!runId) return { ok: false, message: "Mangler import-ID." };
  if (intent !== "keep" && intent !== "delete") {
    return { ok: false, message: "Ukjent handling." };
  }

  try {
    const run = await getImportRun(db, runId);
    if (!run) return { ok: false, message: "Fant ikke importkjøringen." };

    const affected = await applyToAllOrphans(db, {
      runId,
      supplierName: run.supplier_name,
      // «filtered» respekterer søket, «all» tar hele gjennomgangen.
      q: scope === "filtered" ? q : "",
      action: intent,
    });

    revalidateProductPages(runId);

    return {
      ok: true,
      message:
        intent === "keep"
          ? `${affected} produkt(er) beholdt.`
          : `${affected} produkt(er) slettet.`,
    };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Handlingen kunne ikke fullføres.",
    };
  }
}

/** Lukker gjennomgangen uten å røre restene — de blir liggende i katalogen. */
export async function closeReviewAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const db = await requireAdminDb();
  const runId = text(formData.get("runId"));

  if (!runId) return { ok: false, message: "Mangler import-ID." };

  try {
    await completeImportRun(db, runId);
    revalidateProductPages(runId);
    return { ok: true, message: "Gjennomgangen er lukket. Restene ble liggende i katalogen." };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Kunne ikke lukke gjennomgangen.",
    };
  }
}
