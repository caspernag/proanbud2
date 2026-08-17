import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeProductImage } from "@/lib/product-image-normalize";
import { STOREFRONT_IMAGE_BUCKET, STOREFRONT_PRODUCTS_TABLE } from "@/lib/storefront-catalog-db";

/**
 * Bildeadministrasjon for /sjefen.
 *
 * Før dette var «endre et bilde» å skrive en storage-path som fritekst i et
 * input-felt, ett produkt av gangen — ingen opplasting, ingen forhåndsvisning,
 * ingen bulk. Årsaken var datamodellen: bildeidentitet lå spredd på
 * nobb_images, storefront_products.image_path og image_url.
 *
 * Nå er public.product_images eneste skriver, og image_path holdes i sync av
 * en trigger. Det gjør bulk mulig: alle funksjonene her opererer på lister.
 */

export const PRODUCT_IMAGES_TABLE = "product_images";

/** Maks filstørrelse vi tar imot ved manuell opplasting (før normalisering). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type ProductImageRow = {
  id: string;
  nobb_number: string;
  storage_path: string;
  sort_order: number;
  role: string;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  source: string;
};

export type ProductImageCoverage = {
  total: number;
  withImage: number;
  withoutImage: number;
};

export async function getProductImageCoverage(db: SupabaseClient): Promise<ProductImageCoverage> {
  const [{ count: total }, { count: withImage }] = await Promise.all([
    db.from(STOREFRONT_PRODUCTS_TABLE).select("id", { count: "exact", head: true }),
    db
      .from(STOREFRONT_PRODUCTS_TABLE)
      .select("id", { count: "exact", head: true })
      .not("image_path", "is", null),
  ]);

  const totalCount = total ?? 0;
  const withImageCount = withImage ?? 0;

  return {
    total: totalCount,
    withImage: withImageCount,
    withoutImage: Math.max(0, totalCount - withImageCount),
  };
}

export type ProductImageListRow = {
  id: string;
  nobb_number: string;
  product_name: string;
  category: string | null;
  image_path: string | null;
};

/**
 * Produkter for bulk-flaten. `filter` avgjør om vi viser alt, bare de som
 * mangler bilde, eller bare de som har ett.
 */
export async function listProductsForImageAdmin(
  db: SupabaseClient,
  options: {
    filter: "all" | "missing" | "has";
    q?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{ rows: ProductImageListRow[]; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 60, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);

  let query = db
    .from(STOREFRONT_PRODUCTS_TABLE)
    .select("id, nobb_number, product_name, category, image_path", { count: "exact" });

  if (options.filter === "missing") {
    query = query.is("image_path", null);
  } else if (options.filter === "has") {
    query = query.not("image_path", "is", null);
  }

  const q = (options.q ?? "").trim();
  if (q) {
    // Tallsøk treffer NOBB, tekstsøk treffer navnet.
    query = /^\d+$/.test(q)
      ? query.like("nobb_number", `${q}%`)
      : query.ilike("product_name", `%${q}%`);
  }

  const { data, error, count } = await query
    .order("popularity_score", { ascending: false })
    .order("product_name", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Kunne ikke hente produkter: ${error.message}`);
  }

  return { rows: (data as ProductImageListRow[]) ?? [], total: count ?? 0 };
}

/**
 * Lagrer et opplastet bilde som primærbilde for et produkt.
 *
 * Bildet normaliseres (nedskalert + WebP) på vei inn, akkurat som i
 * warmup-jobben — så en 12 MB telefonbilde-JPEG fra en leverandør ikke havner
 * i bøtta som den er.
 */
export async function uploadProductImage(
  db: SupabaseClient,
  nobbNumber: string,
  file: File,
): Promise<{ storagePath: string; byteSize: number }> {
  if (file.size === 0) {
    throw new Error("Filen er tom.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Filen er for stor (maks ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB).`);
  }

  const normalized = await normalizeProductImage(await file.arrayBuffer());
  if (!normalized) {
    throw new Error("Filen kunne ikke leses som et bilde.");
  }

  const storagePath = `${nobbNumber}${normalized.extension}`;

  const { error: uploadError } = await db.storage
    .from(STOREFRONT_IMAGE_BUCKET)
    .upload(storagePath, normalized.bytes, {
      contentType: normalized.contentType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Opplasting feilet: ${uploadError.message}`);
  }

  await removeStaleVariants(db, nobbNumber, storagePath);

  // Triggeren på product_images oppdaterer storefront_products.image_path.
  const { error: rowError } = await db.from(PRODUCT_IMAGES_TABLE).upsert(
    {
      nobb_number: nobbNumber,
      storage_path: storagePath,
      sort_order: 0,
      role: "primary",
      width: normalized.width,
      height: normalized.height,
      byte_size: normalized.byteSize,
      source: "manual",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "nobb_number,sort_order" },
  );

  if (rowError) {
    throw new Error(`Kunne ikke lagre bilderaden: ${rowError.message}`);
  }

  return { storagePath, byteSize: normalized.byteSize };
}

/** Fjerner bildet for et produkt — både raden og objektet i bøtta. */
export async function deleteProductImages(db: SupabaseClient, nobbNumbers: string[]): Promise<number> {
  if (nobbNumbers.length === 0) return 0;

  const { data: rows, error } = await db
    .from(PRODUCT_IMAGES_TABLE)
    .select("storage_path")
    .in("nobb_number", nobbNumbers);

  if (error) {
    throw new Error(`Kunne ikke lese bilder: ${error.message}`);
  }

  const paths = (rows ?? []).map((row) => (row as { storage_path: string }).storage_path);

  // Raden først: triggeren nullstiller image_path, så butikken slutter å peke
  // på objektet før vi sletter det. Motsatt rekkefølge ville gitt brutte
  // bilder i vinduet mellom de to operasjonene.
  const { error: deleteRowError } = await db
    .from(PRODUCT_IMAGES_TABLE)
    .delete()
    .in("nobb_number", nobbNumbers);

  if (deleteRowError) {
    throw new Error(`Kunne ikke slette bilderadene: ${deleteRowError.message}`);
  }

  if (paths.length > 0) {
    await db.storage.from(STOREFRONT_IMAGE_BUCKET).remove(paths);
  }

  return paths.length;
}

/**
 * Tvinger ny henting fra eksterne kilder for de oppgitte produktene.
 *
 * Fjerner bilderaden og negativ-markøren, slik at bilde-ruta forsøker
 * kildene på nytt neste gang produktet vises. Selve hentingen skjer der —
 * denne funksjonen invaliderer bare det som er cachet.
 */
export async function queueProductImageRefetch(
  db: SupabaseClient,
  nobbNumbers: string[],
): Promise<number> {
  if (nobbNumbers.length === 0) return 0;

  await deleteProductImages(db, nobbNumbers);

  // Negativ-markørene ligger både som .null-objekter og i nobb_images.
  await db.storage
    .from(STOREFRONT_IMAGE_BUCKET)
    .remove(nobbNumbers.map((nobb) => `${nobb}.null`));

  await db
    .from("nobb_images")
    .update({ storage_path: null, null_until: null })
    .in("nobb_number", nobbNumbers);

  return nobbNumbers.length;
}

async function removeStaleVariants(db: SupabaseClient, nobbNumber: string, keepPath: string) {
  const { data: siblings } = await db.storage.from(STOREFRONT_IMAGE_BUCKET).list("", {
    search: `${nobbNumber}.`,
    limit: 10,
  });

  const stale = (siblings ?? [])
    .map((file) => file.name)
    .filter((name) => name.startsWith(`${nobbNumber}.`) && name !== keepPath && !name.endsWith(".null"));

  if (stale.length > 0) {
    await db.storage.from(STOREFRONT_IMAGE_BUCKET).remove(stale);
  }
}

/** Normaliserer en liste med NOBB-nummer fra et bulk-tekstfelt eller avkrysning. */
export function parseNobbList(raw: string): string[] {
  const deduped = new Set<string>();

  for (const part of raw.split(/[\s,;]+/)) {
    const digits = part.replace(/\D/g, "");
    if (digits.length > 0) {
      deduped.add(digits);
    }
  }

  return Array.from(deduped);
}
