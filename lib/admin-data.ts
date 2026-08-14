import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAdminUser } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Datatilgang for /sjefen.
 *
 * VIKTIG: adminsider skal ALDRI lese forretningsdata gjennom
 * `createSupabaseServerClient()`. Den klienten kjører som den innloggede
 * brukeren, og RLS på shop_orders (`customer_email = auth.email()`) og
 * material_orders/projects (`auth.uid() = user_id`) gjør at panelet da bare
 * ser administratorens egne rader — andre kunders ordre blir usynlige uten at
 * noe feiler. Det er nøyaktig den feilen som skjulte ekte kundeordre i
 * Bestillinger og Økonomi.
 *
 * `requireAdminDb()` verifiserer administrator og gir service-role-klienten,
 * som omgår RLS med vilje. Tilgangskontrollen ligger i requireAdminUser().
 */
export async function requireAdminDb(): Promise<SupabaseClient> {
  await requireAdminUser();

  const db = createSupabaseAdminClient();
  if (!db) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY mangler — adminpanelet kan ikke lese data uten den.",
    );
  }

  return db;
}

export type QueryOutcome<T> = { rows: T[]; error: string | null };

type SupabaseListResponse<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Kjører en select og gjør feil synlige i stedet for å la dem bli til tomme
 * lister. En side som viser «0 kr» fordi spørringen feilet er farligere enn en
 * side som sier at noe er galt.
 */
export async function adminRows<T>(
  label: string,
  query: PromiseLike<SupabaseListResponse<T>>,
): Promise<QueryOutcome<T>> {
  try {
    const { data, error } = await query;

    if (error) {
      console.error(`[sjefen] ${label} feilet:`, error.message);
      return { rows: [], error: `${label}: ${error.message}` };
    }

    return { rows: data ?? [], error: null };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "ukjent feil";
    console.error(`[sjefen] ${label} kastet:`, message);
    return { rows: [], error: `${label}: ${message}` };
  }
}

/** Samler feilmeldingene fra flere spørringer til ett banner. */
export function collectErrors(...outcomes: { error: string | null }[]): string[] {
  return outcomes.map((outcome) => outcome.error).filter((error): error is string => error !== null);
}

/**
 * Henter alle auth-brukere. Paginerer, siden listUsers har et tak per side og
 * en hardkodet `perPage: 500` stille mister brukere når basen vokser.
 */
export async function fetchAllAuthUsers(
  db: SupabaseClient,
): Promise<QueryOutcome<{ id: string; email: string | null; created_at: string; last_sign_in_at: string | null; provider: string }>> {
  const users: { id: string; email: string | null; created_at: string; last_sign_in_at: string | null; provider: string }[] = [];
  const perPage = 200;

  try {
    for (let page = 1; page <= 50; page += 1) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage });

      if (error) {
        console.error("[sjefen] listUsers feilet:", error.message);
        return { rows: users, error: `Brukere: ${error.message}` };
      }

      const batch = data?.users ?? [];
      for (const user of batch) {
        users.push({
          id: user.id,
          email: user.email ?? null,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at ?? null,
          provider: user.app_metadata?.provider ?? "email",
        });
      }

      if (batch.length < perPage) break;
    }

    return { rows: users, error: null };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "ukjent feil";
    return { rows: users, error: `Brukere: ${message}` };
  }
}

/* ── Felles regler for hva som teller som omsetning ──────────────────────── */

/** Butikkordre som er betalt. Brukes overalt så tallene stemmer på tvers av sider. */
export const PAID_SHOP_STATUSES = ["paid", "fulfilled"] as const;

/** Materialordre som er betalt. */
export const PAID_MATERIAL_STATUSES = ["paid", "submitted", "fulfilled"] as const;

export function isPaidShopStatus(status: string): boolean {
  return (PAID_SHOP_STATUSES as readonly string[]).includes(status);
}

export function isPaidMaterialStatus(status: string): boolean {
  return (PAID_MATERIAL_STATUSES as readonly string[]).includes(status);
}
