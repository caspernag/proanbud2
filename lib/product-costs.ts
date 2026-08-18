import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { STOREFRONT_PRODUCTS_TABLE } from "@/lib/storefront-catalog-db";

/**
 * Innkjøpspris eks. mva per NOBB-nummer, hentet fra katalogen.
 *
 * KATALOGEN ER FASIT, IKKE VEKTORLAGERET. `cost_price_ex_vat_nok` skrives av
 * prisimporten (lib/admin-product-price-import) og kan rettes for hånd i
 * /sjefen/produkter. Prislisten i OpenAI-vektorlageret er et eldre
 * øyeblikksbilde — refresh-jobben som holdt den oppdatert ble tatt av cron da
 * importen overtok katalogen — og et lønnsomhetstall som bygger på den viser
 * kostnader fra en annen prisfil enn den butikken faktisk selger etter.
 *
 * Kolonnen er ikke tilgjengelig for anon-rollen, så klienten må være
 * service-role-klienten fra /sjefen.
 */
export async function getProductCostsByNobb(
  db: SupabaseClient,
  nobbNumbers: Iterable<string>,
): Promise<Map<string, number>> {
  const wanted = [...new Set([...nobbNumbers].map((value) => value?.trim()).filter(Boolean))] as string[];
  const costByNobb = new Map<string, number>();

  if (wanted.length === 0) {
    return costByNobb;
  }

  // Delt opp fordi PostgREST legger hele `in`-lista i URL-en, og en ordreliste
  // kan inneholde flere hundre varenummer.
  const chunkSize = 200;

  for (let from = 0; from < wanted.length; from += chunkSize) {
    const chunk = wanted.slice(from, from + chunkSize);
    const { data, error } = await db
      .from(STOREFRONT_PRODUCTS_TABLE)
      .select("nobb_number, cost_price_ex_vat_nok")
      .in("nobb_number", chunk);

    if (error) {
      throw new Error(`Kunne ikke hente innkjøpspriser: ${error.message}`);
    }

    for (const row of (data ?? []) as CostRow[]) {
      const cost = toFiniteNumber(row.cost_price_ex_vat_nok);
      // null/0 betyr ukjent innkjøpspris. Å telle den som 0 ville gjort
      // dekningsbidraget lik omsetningen, og linja skal i stedet merkes som
      // ukjent i lønnsomhetskortet.
      if (cost !== null && cost > 0) {
        costByNobb.set(String(row.nobb_number), cost);
      }
    }
  }

  return costByNobb;
}

type CostRow = {
  nobb_number: string;
  cost_price_ex_vat_nok: number | string | null;
};

function toFiniteNumber(value: number | string | null): number | null {
  if (value === null || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
