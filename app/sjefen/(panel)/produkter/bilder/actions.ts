"use server";

import { revalidatePath, updateTag } from "next/cache";

import type { ActionState } from "@/app/sjefen/_components/action-form";
import {
  deleteProductImages,
  parseNobbList,
  queueProductImageRefetch,
  uploadProductImage,
} from "@/lib/admin-product-images";
import { requireAdminDb } from "@/lib/admin-data";
import { STOREFRONT_CATALOG_TAG } from "@/lib/storefront-catalog-db";

function revalidateImageSurfaces() {
  revalidatePath("/sjefen/produkter/bilder");
  revalidatePath("/sjefen/produkter");
  revalidatePath("/");
  // Produktsidene er statiske og leser katalogen gjennom `use cache` — stien
  // alene invaliderer dem ikke. `updateTag` og ikke `revalidateTag`: den siste
  // serverer det gamle innholdet mens det ferske hentes i bakgrunnen, og en
  // kunde som får forrige prisfils pris er ikke en akseptabel mellomtilstand.
  updateTag(STOREFRONT_CATALOG_TAG);
}

/** NOBB-numrene et bulk-skjema sendte inn: avkryssede rader + fritekstfeltet. */
function collectNobbNumbers(formData: FormData): string[] {
  const selected = formData.getAll("nobb").filter((value): value is string => typeof value === "string");
  const pasted = formData.get("nobb_list");

  const combined = [...selected, ...(typeof pasted === "string" ? parseNobbList(pasted) : [])];

  return Array.from(new Set(combined.map((value) => value.replace(/\D/g, "")).filter(Boolean)));
}

export async function uploadProductImageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const db = await requireAdminDb();

  const nobbNumber = (formData.get("nobb_number") as string | null)?.replace(/\D/g, "") ?? "";
  if (!nobbNumber) {
    return { ok: false, message: "Mangler NOBB-nummer." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Velg en bildefil." };
  }

  try {
    const { byteSize } = await uploadProductImage(db, nobbNumber, file);
    revalidateImageSurfaces();
    return {
      ok: true,
      message: `Bilde lagret for ${nobbNumber} (${Math.round(byteSize / 1024)} kB etter konvertering).`,
    };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : "Opplasting feilet." };
  }
}

/**
 * Bulk-handlingene deler skjema (de avkryssede radene), så de kan ikke være
 * hvert sitt ActionForm. Knappen som ble trykket sender `intent`, og vi
 * forgrener på den.
 */
export async function bulkProductImageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const db = await requireAdminDb();
  const nobbNumbers = collectNobbNumbers(formData);
  const intent = formData.get("intent");

  if (nobbNumbers.length === 0) {
    return { ok: false, message: "Ingen produkter valgt." };
  }

  try {
    if (intent === "delete") {
      const removed = await deleteProductImages(db, nobbNumbers);
      revalidateImageSurfaces();
      return {
        ok: true,
        message: `Slettet ${removed} bilde(r) for ${nobbNumbers.length} produkt(er).`,
      };
    }

    const queued = await queueProductImageRefetch(db, nobbNumbers);
    revalidateImageSurfaces();
    return {
      ok: true,
      message: `${queued} produkt(er) merket for ny henting. Bildene hentes fra kildene neste gang de vises.`,
    };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : "Handlingen feilet." };
  }
}
