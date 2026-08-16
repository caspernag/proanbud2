import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { importPriceFile } from "@/lib/admin-product-price-import";

const fixtureBytes = new Uint8Array(
  readFileSync(path.join(__dirname, "fixtures", "byggmakker-priser.xlsx")),
);

type UpsertedRow = Record<string, unknown>;

/**
 * Minimal Supabase-stubb: nok til å kjøre importen gjennom, og som lar oss se
 * nøyaktig hvilke rader upserten skriver. Alle produktene finnes fra før, med
 * popularitet, EAN og bilde som prisfilen ikke bærer.
 */
function createDbStub() {
  const upserted: UpsertedRow[] = [];

  const productBuilder = () => {
    const state: { kind: "existing" | "count" | "meta" } = { kind: "meta" };

    const builder: Record<string, unknown> = {
      select(columns: string, options?: { head?: boolean }) {
        state.kind = options?.head ? "count" : columns.includes("popularity_score") ? "existing" : "meta";
        return builder;
      },
      in(_column: string, values: string[]) {
        return {
          then: (resolve: (value: unknown) => void) =>
            resolve({
              data: values.map((nobb) => ({
                id: `byggmakker-${nobb}`,
                slug: `vare-${nobb}`,
                nobb_number: nobb,
                popularity_score: 42,
                ean: `70399990000${nobb.slice(-1)}`,
                image_url: `https://cdn.example/${nobb}.jpg`,
                datasheet_url: null,
              })),
              error: null,
            }),
        };
      },
      ilike: () => builder,
      or: () => builder,
      range: () => ({
        then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
      }),
      upsert(rows: UpsertedRow | UpsertedRow[]) {
        if (Array.isArray(rows)) upserted.push(...rows);
        return { then: (resolve: (value: unknown) => void) => resolve({ error: null }) };
      },
      then: (resolve: (value: unknown) => void) =>
        resolve(state.kind === "count" ? { count: 0, error: null } : { data: [], error: null }),
    };

    return builder;
  };

  const db = {
    from(table: string) {
      if (table === "storefront_products") return productBuilder();
      return {
        upsert: () => ({ then: (resolve: (value: unknown) => void) => resolve({ error: null }) }),
        insert: () => ({ then: (resolve: (value: unknown) => void) => resolve({ error: null }) }),
      };
    },
  };

  return { db, upserted };
}

describe("prisimport bevarer det filen ikke bærer", () => {
  const run = async () => {
    const { db, upserted } = createDbStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await importPriceFile(db as any, { fileName: "prisliste.xlsx", data: fixtureBytes });
    return upserted;
  };

  it("nullstiller ikke popularitet på produkter som bare oppdateres", async () => {
    const rows = await run();

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.popularity_score === 42)).toBe(true);
  });

  it("beholder EAN når prisfilen ikke har en EAN-kolonne", async () => {
    const rows = await run();

    // Uten EAN slår ikke lagerstatusen fra Byggmakker opp, og alt viser «Sjekk lager».
    expect(rows.every((row) => typeof row.ean === "string" && row.ean.length > 0)).toBe(true);
  });

  it("beholder bilde og datablad", async () => {
    const rows = await run();

    expect(rows.every((row) => String(row.image_url ?? "").startsWith("https://cdn.example/"))).toBe(true);
  });

  it("oppdaterer fortsatt prisen fra filen", async () => {
    const rows = await run();

    expect(rows.every((row) => typeof row.unit_price_nok === "number")).toBe(true);
    expect(rows.some((row) => (row.unit_price_nok as number) > 0)).toBe(true);
  });

  it("lagrer innkjøpspris og veiledende pris eks. mva så marginen kan regnes", async () => {
    const rows = await run();

    // 119 kr/m² × 4,1 m² per pakke, netto og veiledende, begge eks. mva.
    const terrassebord = rows.find((row) => row.nobb_number === "51512345");

    expect(terrassebord?.cost_price_ex_vat_nok).toBeCloseTo(487.9, 2);
    expect(terrassebord?.list_price_ex_vat_nok).toBeCloseTo(612.95, 2);
    // Utsalgsprisen er påslått og inkl. mva — den må ligge over innkjøpsprisen.
    expect(terrassebord?.unit_price_nok as number).toBeGreaterThan(
      terrassebord?.cost_price_ex_vat_nok as number,
    );
    expect(rows.every((row) => (row.cost_price_ex_vat_nok as number) > 0)).toBe(true);
  });
});
