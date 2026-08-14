import { NextResponse } from "next/server";

import { runDaybookCatchUp, runDaybookForDate } from "@/lib/accounting/post-daybook";
import { env } from "@/lib/env";

// Ett bilag per dag, men opprydningen kan ta igjen flere dager på rad.
export const maxDuration = 120;

function isAuthorized(request: Request): boolean {
  if (!env.cronSecret) {
    return false;
  }

  const bearer = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  const headerSecret = request.headers.get("x-cron-secret")?.trim();

  return env.cronSecret === bearer || env.cronSecret === headerSecret;
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // `?date=YYYY-MM-DD` kjører én bestemt dag. Brukes til å ta igjen historikk
  // manuelt; postering er idempotent, så en dag som allerede er bokført
  // hoppes over uansett.
  const requestedDate = new URL(request.url).searchParams.get("date");

  try {
    const results = requestedDate
      ? [await runDaybookForDate(requestedDate)]
      : await runDaybookCatchUp();

    const failed = results.filter((result) => result.status === "failed");

    return NextResponse.json(
      { ok: failed.length === 0, results },
      { status: failed.length === 0 ? 200 : 500 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
