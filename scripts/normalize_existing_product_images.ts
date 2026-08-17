/**
 * Engangs-backfill: skalerer ned og konverterer alle eksisterende objekter i
 * "material-images" til WebP, og oppdaterer image_path deretter.
 *
 * Bakgrunn: bøtta inneholdt 798 MB / ~4 200 objekter (snitt 195 kB, største
 * 20 MB) fordi warmup-jobben lagret råfilene fra kildene. Nye bilder
 * normaliseres nå ved lagring (lib/product-image-normalize.ts); dette skriptet
 * tar det som allerede ligger der.
 *
 * Bruk:
 *   npx tsx scripts/normalize_existing_product_images.ts --dry-run
 *   npx tsx scripts/normalize_existing_product_images.ts
 *
 * Krever NEXT_PUBLIC_SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY i .env.local.
 * Skriptet er idempotent: allerede normaliserte .webp-filer under
 * størrelsesgrensen hoppes over, så det kan trygt kjøres flere ganger.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const envPath = path.join(process.cwd(), ".env.local");
try {
  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // .env.local mangler — stol på miljøvariabler som allerede er satt
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "material-images";
const MAX_DIMENSION = 1200;
const WEBP_QUALITY = 82;
const CONCURRENCY = 6;
const LIST_PAGE_SIZE = 1000;

/** Under denne grensen er en .webp allerede god nok — ikke rør den. */
const ALREADY_SMALL_ENOUGH_BYTES = 120 * 1024;

const DRY_RUN = process.argv.includes("--dry-run");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Mangler NEXT_PUBLIC_SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type StorageFile = { name: string; metadata: { size?: number } | null };

async function listAllObjects(): Promise<StorageFile[]> {
  const all: StorageFile[] = [];

  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: LIST_PAGE_SIZE, offset });

    if (error) throw new Error(`Kunne ikke liste bøtta: ${error.message}`);
    if (!data || data.length === 0) break;

    all.push(...(data as StorageFile[]));
    if (data.length < LIST_PAGE_SIZE) break;
  }

  return all;
}

function isImageObject(name: string) {
  return /\.(jpg|jpeg|png|webp|gif)$/i.test(name);
}

function nobbFromName(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

type Outcome = "converted" | "skipped" | "failed";

async function processOne(file: StorageFile): Promise<{ outcome: Outcome; saved: number }> {
  const nobb = nobbFromName(file.name);
  const originalSize = file.metadata?.size ?? 0;

  if (file.name.endsWith(".webp") && originalSize > 0 && originalSize < ALREADY_SMALL_ENOUGH_BYTES) {
    return { outcome: "skipped", saved: 0 };
  }

  const { data, error } = await supabase.storage.from(BUCKET).download(file.name);
  if (error || !data) {
    console.warn(`  ! kunne ikke laste ned ${file.name}: ${error?.message ?? "ukjent"}`);
    return { outcome: "failed", saved: 0 };
  }

  const input = Buffer.from(await data.arrayBuffer());

  let output: Buffer;
  try {
    output = await sharp(input, { limitInputPixels: 50_000_000, failOn: "error" })
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  } catch (cause) {
    console.warn(`  ! kunne ikke dekode ${file.name}: ${cause instanceof Error ? cause.message : cause}`);
    return { outcome: "failed", saved: 0 };
  }

  // Ikke gjør noe verre. Hvis konverteringen ga en større fil, behold originalen.
  if (originalSize > 0 && output.byteLength >= originalSize && file.name.endsWith(".webp")) {
    return { outcome: "skipped", saved: 0 };
  }

  const targetName = `${nobb}.webp`;
  const saved = Math.max(0, originalSize - output.byteLength);

  if (DRY_RUN) {
    console.log(
      `  [tørr] ${file.name} → ${targetName}  ${(originalSize / 1024).toFixed(0)} kB → ${(output.byteLength / 1024).toFixed(0)} kB`,
    );
    return { outcome: "converted", saved };
  }

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(targetName, output, { contentType: "image/webp", upsert: true });

  if (uploadError) {
    console.warn(`  ! kunne ikke laste opp ${targetName}: ${uploadError.message}`);
    return { outcome: "failed", saved: 0 };
  }

  // Fjern originalen først når den nye ligger trygt på plass.
  if (file.name !== targetName) {
    await supabase.storage.from(BUCKET).remove([file.name]);
  }

  // Hold pekerne i sync — begge tabellene lagrer filnavnet.
  await supabase.from("nobb_images").update({ storage_path: targetName }).eq("nobb_number", nobb);
  await supabase.from("storefront_products").update({ image_path: targetName }).eq("nobb_number", nobb);

  return { outcome: "converted", saved };
}

async function main() {
  console.log(`Lister objekter i "${BUCKET}"...`);
  const objects = (await listAllObjects()).filter((file) => isImageObject(file.name));

  const totalBefore = objects.reduce((sum, file) => sum + (file.metadata?.size ?? 0), 0);
  console.log(
    `${objects.length} bildeobjekter, ${(totalBefore / 1024 / 1024).toFixed(0)} MB totalt.${DRY_RUN ? " (tørrkjøring)" : ""}\n`,
  );

  const stats = { converted: 0, skipped: 0, failed: 0, saved: 0 };
  let cursor = 0;

  async function worker() {
    while (cursor < objects.length) {
      const index = cursor++;
      const file = objects[index];
      const { outcome, saved } = await processOne(file);
      stats[outcome] += 1;
      stats.saved += saved;

      const done = stats.converted + stats.skipped + stats.failed;
      if (done % 100 === 0) {
        console.log(`  ${done}/${objects.length} — spart ${(stats.saved / 1024 / 1024).toFixed(0)} MB så langt`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log("\nFerdig.");
  console.log(`  konvertert: ${stats.converted}`);
  console.log(`  hoppet over: ${stats.skipped}`);
  console.log(`  feilet: ${stats.failed}`);
  console.log(`  spart: ${(stats.saved / 1024 / 1024).toFixed(0)} MB av ${(totalBefore / 1024 / 1024).toFixed(0)} MB`);
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
