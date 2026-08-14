"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionState } from "@/app/sjefen/_components/action-form";
import { importPriceFile } from "@/lib/admin-product-price-import";
import { requireAdminDb } from "@/lib/admin-data";

function text(value: FormDataEntryValue | null, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function nullableText(value: FormDataEntryValue | null) {
  const trimmed = text(value);
  return trimmed ? trimmed : null;
}

function intValue(value: FormDataEntryValue | null, label: string, min = 0, max = 10_000_000) {
  const raw = text(value);
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} må være et heltall mellom ${min} og ${max}.`);
  }

  return parsed;
}

function optionalNumber(value: FormDataEntryValue | null, label: string) {
  const raw = text(value);
  if (!raw) return null;

  const parsed = Number.parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) {
    throw new Error(`${label} må være et positivt tall.`);
  }

  return parsed;
}

function technicalDetails(value: FormDataEntryValue | null) {
  return text(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildSearchText(input: {
  category: string;
  sectionTitle: string;
  productName: string;
  brand: string;
  description: string;
  technicalDetails: string[];
}) {
  return [
    input.category,
    input.sectionTitle,
    input.productName,
    input.brand,
    input.description,
    ...input.technicalDetails,
  ]
    .join(" ")
    .toLowerCase();
}

export async function updateProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const db = await requireAdminDb();

  const id = text(formData.get("id"));
  if (!id) return { ok: false, message: "Mangler produkt-ID." };

  const productName = text(formData.get("product_name"));
  const slug = text(formData.get("slug"));
  const nobbNumber = text(formData.get("nobb_number"));
  const supplierName = text(formData.get("supplier_name"));
  const category = text(formData.get("category"), "Diverse");
  const sectionTitle = text(formData.get("section_title"), "Byggevarer");
  const brand = text(formData.get("brand"));
  const description = text(formData.get("description"));
  const details = technicalDetails(formData.get("technical_details"));

  if (!productName || !slug || !nobbNumber || !supplierName) {
    return { ok: false, message: "Produktnavn, slug, NOBB og leverandør må fylles ut." };
  }

  let update: Record<string, unknown>;
  try {
    update = {
      slug,
      nobb_number: nobbNumber,
      product_name: productName,
      supplier_name: supplierName,
      brand,
      unit: text(formData.get("unit"), "STK"),
      price_unit: nullableText(formData.get("price_unit")),
      sales_unit: nullableText(formData.get("sales_unit")),
      sales_unit_quantity: optionalNumber(formData.get("sales_unit_quantity"), "Salgsenhet-antall"),
      package_area_sqm: optionalNumber(formData.get("package_area_sqm"), "Pakkeareal"),
      unit_price_nok: intValue(formData.get("unit_price_nok"), "Pris"),
      list_price_nok: intValue(formData.get("list_price_nok"), "Listepris"),
      section_title: sectionTitle,
      category,
      description,
      ean: nullableText(formData.get("ean")),
      datasheet_url: nullableText(formData.get("datasheet_url")),
      image_path: nullableText(formData.get("image_path")),
      image_url: nullableText(formData.get("image_url")),
      technical_details: details,
      quantity_suggestion: text(formData.get("quantity_suggestion"), "1 stk"),
      quantity_reason: text(formData.get("quantity_reason")),
      last_updated: text(formData.get("last_updated")) || new Date().toISOString().slice(0, 10),
      source: text(formData.get("source"), "manual"),
      popularity_score: intValue(formData.get("popularity_score"), "Popularitet", 0, 1_000_000),
      search_text: buildSearchText({
        category,
        sectionTitle,
        productName,
        brand,
        description,
        technicalDetails: details,
      }),
      updated_at: new Date().toISOString(),
    };
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : "Ugyldige produktdata." };
  }

  const { error } = await db.from("storefront_products").update(update).eq("id", id);

  if (error) {
    return { ok: false, message: `Kunne ikke lagre produktet: ${error.message}` };
  }

  revalidatePath("/sjefen/produkter");
  revalidatePath(`/sjefen/produkter/${encodeURIComponent(id)}`);
  revalidatePath("/");

  return { ok: true, message: "Produktet er lagret." };
}

/**
 * Importerer en prisfil (Excel, CSV eller JSON). Nye produkter opprettes,
 * eksisterende matches på NOBB og oppdateres. Produkter fra samme leverandør som
 * ikke lå i filen slettes IKKE her — de sendes til gjennomgang, der de kan
 * beholdes eller slettes i bulk.
 */
export async function importPriceFileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const db = await requireAdminDb();
  const file = formData.get("priceFile");
  const supplierName = text(formData.get("supplierName")) || "Byggmakker";

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Velg en prisfil først." };
  }

  // Må holdes under serverActions.bodySizeLimit i next.config.ts (20 MB).
  if (file.size > 20 * 1024 * 1024) {
    return { ok: false, message: "Prisfilen er for stor. Maks 20 MB." };
  }

  let result;
  try {
    result = await importPriceFile(db, {
      fileName: file.name || "prisfil.csv",
      data: new Uint8Array(await file.arrayBuffer()),
      supplierName,
    });
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "Kunne ikke importere prisfilen.",
    };
  }

  revalidatePath("/sjefen/produkter");
  revalidatePath("/");

  // redirect() kaster en spesiell feil Next fanger opp — den må ligge utenfor
  // try/catch, ellers svelges navigasjonen av feilhåndteringen over.
  if (result.missing > 0) {
    redirect(`/sjefen/produkter/import/${encodeURIComponent(result.runId)}`);
  }

  return {
    ok: true,
    message: `Prisfil importert (${result.format}): ${result.updated} oppdatert, ${result.inserted} nye. Ingen produkter ble stående igjen.`,
  };
}
