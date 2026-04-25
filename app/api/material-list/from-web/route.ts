import { NextResponse } from "next/server";

import { analyzeProductFromUrl } from "@/lib/material-list-from-web";

type AnalyzeProductPayload = {
  url?: unknown;
};


export async function POST(request: Request) {
  let payload: AnalyzeProductPayload;

  try {
    payload = (await request.json()) as AnalyzeProductPayload;
  } catch {
    return NextResponse.json({ error: "Ugyldig JSON-payload." }, { status: 400 });
  }

  const url = typeof payload.url === "string" ? payload.url : "";
  const result = await analyzeProductFromUrl(url);

  if (!result.ok) {
    const status = result.reason === "error" ? 400 : 422;
    return NextResponse.json({ ok: false, reason: result.reason, message: result.message }, { status });
  }

  return NextResponse.json({ ok: true, product: result.product });
}
