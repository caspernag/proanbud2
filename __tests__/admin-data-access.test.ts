import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import {
  isPaidMaterialStatus,
  isPaidShopStatus,
  PAID_MATERIAL_STATUSES,
  PAID_SHOP_STATUSES,
} from "@/lib/admin-data";

const REPO_ROOT = path.resolve(__dirname, "..");
const ADMIN_DIR = path.join(REPO_ROOT, "app/sjefen");

function walk(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) entries.push(...walk(full));
    else if (/\.tsx?$/.test(name)) entries.push(full);
  }
  return entries;
}

/**
 * Denne testen vokter feilen som skjulte ekte kundeordre i adminpanelet:
 * sidene leste forretningsdata med `createSupabaseServerClient()`, som kjører
 * som den innloggede brukeren. RLS på shop_orders (`customer_email =
 * auth.email()`) og material_orders (`auth.uid() = user_id`) gjorde da at
 * panelet kun så administratorens egne rader — uten at noe feilet.
 */
describe("adminpanelet leser data med service-role", () => {
  const files = walk(ADMIN_DIR);

  it("finner faktisk adminfilene", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("ingen fil under app/sjefen bruker den RLS-bundne klienten", () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return source.includes("createSupabaseServerClient");
    });

    expect(
      offenders.map((file) => path.relative(REPO_ROOT, file)),
      "Bruk requireAdminDb() fra lib/admin-data i stedet — se kommentaren der.",
    ).toEqual([]);
  });

  it("det finnes ingen ubeskyttet /admin-rute ved siden av /sjefen", () => {
    // Det gamle /admin-panelet var kun innloggingsbeskyttet, ikke
    // administratorbeskyttet, og lot enhver registrert kunde endre påslag.
    let exists = true;
    try {
      statSync(path.join(REPO_ROOT, "app/admin"));
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  it("hver side under app/sjefen/(panel) verifiserer administrator", () => {
    const pages = files.filter((file) => file.includes("(panel)") && file.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThan(3);

    const unguarded = pages.filter((file) => {
      const source = readFileSync(file, "utf8");
      const guarded =
        source.includes("requireAdminDb") ||
        source.includes("requireAdminUser") ||
        // Rene videresendinger trenger ingen egen sjekk; målet gjør jobben.
        source.includes("redirect(");
      return !guarded;
    });

    expect(unguarded.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });

  it("hver server action-fil under app/sjefen verifiserer administrator", () => {
    const actionFiles = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return source.startsWith('"use server"') || source.startsWith("'use server'");
    });

    const unguarded = actionFiles.filter((file) => {
      const source = readFileSync(file, "utf8");
      return !source.includes("requireAdminDb") && !source.includes("requireAdminUser");
    });

    expect(
      unguarded.map((file) => path.relative(REPO_ROOT, file)),
      "Server actions kan POSTes direkte og må sjekke tilgang selv.",
    ).toEqual([]);
  });
});

describe("felles definisjon av betalt ordre", () => {
  it("butikkordre teller som betalt ved paid og fulfilled", () => {
    expect(PAID_SHOP_STATUSES).toEqual(["paid", "fulfilled"]);
    expect(isPaidShopStatus("paid")).toBe(true);
    expect(isPaidShopStatus("fulfilled")).toBe(true);
    expect(isPaidShopStatus("pending_payment")).toBe(false);
    expect(isPaidShopStatus("cancelled")).toBe(false);
  });

  it("materialordre teller som betalt ved paid, submitted og fulfilled", () => {
    expect(PAID_MATERIAL_STATUSES).toEqual(["paid", "submitted", "fulfilled"]);
    expect(isPaidMaterialStatus("submitted")).toBe(true);
    expect(isPaidMaterialStatus("fulfilled")).toBe(true);
    expect(isPaidMaterialStatus("draft")).toBe(false);
  });
});
