import { describe, it, expect } from "vitest";

import { isScannerProbePath } from "@/proxy";

// ---------------------------------------------------------------------------
// Regelen som holder sårbarhetsskannere unna produkt-catch-all-en `[slug]`.
// Alt som slipper gjennom her koster et funksjonskall på Vercel og et
// katalogoppslag i Supabase, så grensen må være eksakt begge veier.
// ---------------------------------------------------------------------------

describe("isScannerProbePath", () => {
  it("blokkerer skannerstiene vi faktisk ser i loggen", () => {
    for (const path of [
      "/about.php",
      "/admin.php",
      "/xmlrpc.php",
      "/abcd.php",
      "/classwithtostring.php",
      "/wp-content/plugins/foo/readme.txt",
      "/.env",
      "/config.json",
    ]) {
      expect(isScannerProbePath(path), path).toBe(true);
    }
  });

  it("slipper gjennom produkt-sluger", () => {
    for (const path of [
      "/gipsplate-gu-x-1200x2700x9-5-byggmakker-27133248",
      "/osb-3-zero-12x2400x1220-tg2-byggmakker-60638110",
      "/furu-28x120-cuimp-terrasse-kl1-byggmakker-25410978",
    ]) {
      expect(isScannerProbePath(path), path).toBe(false);
    }
  });

  it("slipper gjennom appens egne ruter", () => {
    for (const path of [
      "/",
      "/checkout",
      "/min-side",
      "/min-side/materiallister/abc/bestilling",
      "/sjefen/produkter/bilder",
      "/login",
      "/ordre/9f3c1a2b",
    ]) {
      expect(isScannerProbePath(path), path).toBe(false);
    }
  });

  it("slipper gjennom metadatafilene appen selv serverer", () => {
    for (const path of ["/robots.txt", "/sitemap.xml", "/manifest.webmanifest"]) {
      expect(isScannerProbePath(path), path).toBe(false);
    }
  });

  it("slipper gjennom /.well-known, men ikke punktum ellers i stien", () => {
    expect(isScannerProbePath("/.well-known/apple-app-site-association")).toBe(false);
    // Punktum i et tidligere segment er ikke nok — det er siste segment som teller.
    expect(isScannerProbePath("/noe.rart/vanlig-slug-12345678")).toBe(false);
    expect(isScannerProbePath("/noe.rart/index.php")).toBe(true);
  });
});
