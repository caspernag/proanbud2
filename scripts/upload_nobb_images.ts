/**
 * One-time migration: upload all cached NOBB images from .private/nobb-images/
 * to Supabase Storage bucket "material-images".
 *
 * Usage:
 *   npx tsx scripts/upload_nobb_images.ts
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";

// Load .env.local synchronously (no top-level await, no dotenv dependency)
const envPath = path.join(process.cwd(), ".env.local");
try {
  const raw = readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // .env.local not found, rely on environment variables already set
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "material-images";
const CACHE_DIR = path.join(process.cwd(), ".private", "nobb-images");
const CONCURRENCY = 10;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function contentType(filename: string): string {
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".webp")) return "image/webp";
  if (filename.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

async function uploadFile(filename: string): Promise<"ok" | "skip" | "err"> {
  // Skip null markers and non-image files
  if (!filename.match(/\.(jpg|jpeg|png|webp|gif)$/i)) return "skip";

  const filePath = path.join(CACHE_DIR, filename);
  const ct = contentType(filename);

  try {
    const data = await fs.readFile(filePath);
    const { error } = await supabase.storage.from(BUCKET).upload(filename, data, {
      contentType: ct,
      upsert: false, // skip already-uploaded files
    });

    if (error) {
      // "already exists" is not a real error when upsert=false
      if (error.message?.includes("already exists") || (error as { statusCode?: string }).statusCode === "409") {
        return "skip";
      }
      console.error(`  ERR ${filename}: ${error.message}`);
      return "err";
    }
    return "ok";
  } catch (e) {
    console.error(`  ERR reading ${filename}:`, e);
    return "err";
  }
}

async function main() {
  const files = await fs.readdir(CACHE_DIR);
  const imageFiles = files.filter((f) => f.match(/\.(jpg|jpeg|png|webp|gif)$/i));

  console.log(`Found ${imageFiles.length} images in ${CACHE_DIR}`);
  console.log(`Uploading to Supabase bucket "${BUCKET}" with concurrency ${CONCURRENCY}...\n`);

  let ok = 0, skip = 0, err = 0;
  let done = 0;

  // Process in batches
  for (let i = 0; i < imageFiles.length; i += CONCURRENCY) {
    const batch = imageFiles.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(uploadFile));
    for (const r of results) {
      if (r === "ok") ok++;
      else if (r === "skip") skip++;
      else err++;
      done++;
    }
    process.stdout.write(`\r  Progress: ${done}/${imageFiles.length}  (${ok} uploaded, ${skip} skipped, ${err} errors)`);
  }

  console.log(`\n\nDone! ${ok} uploaded, ${skip} already existed, ${err} errors.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
