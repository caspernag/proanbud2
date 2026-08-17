import "server-only";

import sharp from "sharp";

/**
 * Normalisering av produktbilder ved innkommelse.
 *
 * Bakgrunn: bøtta inneholdt 798 MB fordelt på ~4 200 objekter — snitt 195 kB,
 * største enkeltbilde 20 MB — fordi warmup-jobben lagret det kildene ga oss,
 * som det var. Bildene vises aldri større enn ~700 px, så alt over det er ren
 * egress uten synlig effekt.
 *
 * Vi normaliserer derfor én gang ved lagring i stedet for å betale for det på
 * hver visning: nedskalering til en fast maksbredde og konvertering til WebP.
 */

/** Lengste side etter nedskalering. Produktsiden viser maks ~680 px. */
export const MAX_IMAGE_DIMENSION = 1200;

/** WebP-kvalitet. 82 er praktisk talt tapsfritt for produktfoto. */
const WEBP_QUALITY = 82;

/**
 * Over denne grensen nekter vi å dekode i det hele tatt. Beskytter mot at en
 * kilde serverer en dekompresjonsbombe inn i warmup-jobben.
 */
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** Pikselgrense for samme formål (sharp dekoder ikke over dette). */
const MAX_INPUT_PIXELS = 50_000_000;

export type NormalizedImage = {
  bytes: Buffer;
  contentType: "image/webp";
  extension: ".webp";
  width: number;
  height: number;
  byteSize: number;
};

/**
 * Skalerer ned og konverterer til WebP. Returnerer `null` hvis input ikke lar
 * seg dekode som bilde — kalleren skal da behandle det som "ingen bilde
 * funnet" i stedet for å lagre søppel.
 */
export async function normalizeProductImage(
  input: ArrayBuffer | Buffer,
): Promise<NormalizedImage | null> {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);

  if (buffer.byteLength === 0 || buffer.byteLength > MAX_INPUT_BYTES) {
    return null;
  }

  try {
    const pipeline = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    const metadata = await pipeline.metadata();

    if (!metadata.width || !metadata.height) {
      return null;
    }

    const { data, info } = await pipeline
      .rotate() // respekterer EXIF-orientering før vi kaster metadataen
      .resize({
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
        fit: "inside",
        // Ikke blås opp små kildebilder — det gir bare større filer.
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return {
      bytes: data,
      contentType: "image/webp",
      extension: ".webp",
      width: info.width,
      height: info.height,
      byteSize: data.byteLength,
    };
  } catch {
    return null;
  }
}
