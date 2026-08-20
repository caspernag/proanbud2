import "server-only";

import { cacheLife } from "next/cache";

import { env, hasVercelAnalyticsEnv } from "@/lib/env";
import type { VercelPathVisits, VercelTrafficDay, VercelVisitTotals } from "@/lib/web-traffic";

/**
 * Lesetilgang til Vercel Web Analytics.
 *
 * `<Analytics />` i rot-layouten samler tallene; dette er veien tilbake ut av
 * Vercel igjen, slik at /sjefen kan vise trafikken uten at noen må logge inn i
 * Vercel-panelet. API-et er dokumentert på
 * https://vercel.com/docs/analytics/web-analytics-api og krever et
 * personlig/team-token med lesetilgang til prosjektet.
 *
 * VIKTIG: API-et svarer 404 «Web Analytics not found» så lenge Web Analytics
 * ikke er slått på for prosjektet (Vercel → Prosjekt → Analytics → Enable), og
 * selve spørre-API-et krever Pro-plan. Feilen bobler opp som tekst i kortet i
 * stedet for å bli til null besøkende — et dashboard som viser «0» fordi
 * kallet feilet er farligere enn ett som sier at noe er galt.
 */

const VERCEL_ANALYTICS_API = "https://api.vercel.com/v1/query/web-analytics";
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Vinduene rundes ned til nærmeste 5 minutt. `"use cache"` nøkler på
 * argumentene, så et rullerende `Date.now()` ville gitt en ny cache-nøkkel per
 * request og dermed null gjenbruk.
 */
const WINDOW_BUCKET_MS = 5 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type AnalyticsOutcome<T> = { data: T; error: string | null };

/** Rullerende vindu bakover fra nå, avrundet så cachen kan treffe. */
export function analyticsWindow(days: number): { since: string; until: string } {
  const until = Math.floor(Date.now() / WINDOW_BUCKET_MS) * WINDOW_BUCKET_MS;
  return {
    since: new Date(until - days * DAY_MS).toISOString(),
    until: new Date(until).toISOString(),
  };
}

/* ── Rå spørring ────────────────────────────────────────────────────────── */

type WebAnalyticsEndpoint = "visits/count" | "visits/aggregate";

async function queryWebAnalytics(
  endpoint: WebAnalyticsEndpoint,
  params: { since: string; until: string; by?: string[]; filter?: string; limit?: number },
): Promise<AnalyticsOutcome<unknown>> {
  if (!hasVercelAnalyticsEnv()) {
    return {
      data: null,
      error: "Vercel Analytics er ikke konfigurert (VERCEL_ANALYTICS_TOKEN / VERCEL_PROJECT_ID mangler).",
    };
  }

  const search = new URLSearchParams();
  search.set("projectId", env.vercelProjectId);
  if (env.vercelTeamId) {
    search.set("teamId", env.vercelTeamId);
  }
  search.set("since", params.since);
  search.set("until", params.until);
  for (const dimension of params.by ?? []) {
    search.append("by", dimension);
  }
  if (params.filter) {
    search.set("filter", params.filter);
  }
  if (params.limit !== undefined) {
    search.set("limit", String(params.limit));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${VERCEL_ANALYTICS_API}/${endpoint}?${search.toString()}`, {
      headers: {
        Authorization: `Bearer ${env.vercelAnalyticsToken}`,
        Accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { data: null, error: describeApiError(response.status, body) };
    }

    const payload = (await response.json()) as { data?: unknown };
    return { data: payload?.data ?? null, error: null };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      return { data: null, error: `Vercel Analytics svarte ikke innen ${REQUEST_TIMEOUT_MS / 1000} s.` };
    }
    const message = cause instanceof Error ? cause.message : "ukjent feil";
    return { data: null, error: `Vercel Analytics: ${message}` };
  } finally {
    clearTimeout(timeout);
  }
}

/** Oversetter statuskodene som faktisk oppstår til noe en kan handle på. */
function describeApiError(status: number, body: string): string {
  if (status === 404) {
    return "Web Analytics er ikke slått på for prosjektet (Vercel → Analytics → Enable), eller spørre-API-et krever Pro-plan.";
  }
  if (status === 401 || status === 403) {
    return "Vercel-tokenet mangler lesetilgang til prosjektet (sjekk VERCEL_ANALYTICS_TOKEN og VERCEL_TEAM_ID).";
  }
  const detail = extractApiMessage(body);
  return `Vercel Analytics svarte ${status}${detail ? `: ${detail}` : ""}.`;
}

function extractApiMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed?.error?.message ?? null;
  } catch {
    return body.slice(0, 160) || null;
  }
}

/* ── Parsing ────────────────────────────────────────────────────────────── */

function toCount(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/**
 * Aggregatradene har dimensjonen som feltnavn og målingene i
 * `pageviews`/`visitors`. Verifisert mot ekte svar 2026-08-20:
 * `{"timestamp":"2026-08-13T00:00:00.000Z","visitors":3,"pageviews":14}` og
 * `{"requestPath":"/checkout","visitors":22,"pageviews":43}`. `count` beholdes
 * som reserve fordi events-datasettet bruker det navnet i dokumentasjonen.
 */
function parseRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null);
}

/* ── Offentlige spørringer ──────────────────────────────────────────────── */

/** Totalt antall sidevisninger og unike besøkende i vinduet. */
export async function fetchVercelVisitTotals(
  since: string,
  until: string,
): Promise<AnalyticsOutcome<VercelVisitTotals | null>> {
  "use cache";
  cacheLife({ revalidate: 300, expire: 900 });

  const { data, error } = await queryWebAnalytics("visits/count", { since, until });
  if (error || !data || typeof data !== "object") {
    return { data: null, error };
  }

  const row = data as Record<string, unknown>;
  return {
    data: { pageviews: toCount(row.pageviews), visitors: toCount(row.visitors) },
    error: null,
  };
}

/** Sidevisninger per døgn, for trafikkgrafen. */
export async function fetchVercelTrafficByDay(
  since: string,
  until: string,
): Promise<AnalyticsOutcome<VercelTrafficDay[]>> {
  "use cache";
  cacheLife({ revalidate: 300, expire: 900 });

  const { data, error } = await queryWebAnalytics("visits/aggregate", {
    since,
    until,
    by: ["day"],
    limit: 100,
  });
  if (error) {
    return { data: [], error };
  }

  const days = parseRows(data)
    .map((row) => {
      const raw = row.timestamp ?? row.day ?? row.date;
      const date = typeof raw === "string" || typeof raw === "number" ? new Date(raw) : null;
      if (!date || Number.isNaN(date.getTime())) return null;
      return {
        date: date.toISOString().slice(0, 10),
        pageviews: toCount(row.pageviews ?? row.count),
        visitors: toCount(row.visitors),
      };
    })
    .filter((day): day is VercelTrafficDay => day !== null)
    .sort((left, right) => left.date.localeCompare(right.date));

  return { data: days, error: null };
}

/**
 * Mest besøkte URL-er i vinduet.
 *
 * Butikkens produktsider ligger på rot (`/<slug>`), så det finnes ingen
 * rute-prefiks å filtrere på her. Kallerne henter derfor et bredt topplistesnitt
 * og krysser det mot faktiske slugger i katalogen.
 *
 * Merk at Vercel legger på en samlerad `{"requestPath":"Others"}` for alt som
 * faller utenfor `limit`. Den ser ut som en sti, men er ikke én — og fanges av
 * at `slugFromRequestPath` krever ledende skråstrek.
 */
export async function fetchVercelTopPaths(
  since: string,
  until: string,
  limit = 100,
): Promise<AnalyticsOutcome<VercelPathVisits[]>> {
  "use cache";
  cacheLife({ revalidate: 300, expire: 900 });

  const { data, error } = await queryWebAnalytics("visits/aggregate", {
    since,
    until,
    by: ["requestPath"],
    limit,
  });
  if (error) {
    return { data: [], error };
  }

  const paths = parseRows(data)
    .map((row) => {
      const raw = row.requestPath ?? row.path;
      if (typeof raw !== "string" || raw.length === 0) return null;
      return {
        requestPath: raw,
        pageviews: toCount(row.pageviews ?? row.count),
        visitors: toCount(row.visitors),
      };
    })
    .filter((entry): entry is VercelPathVisits => entry !== null);

  return { data: paths, error: null };
}
