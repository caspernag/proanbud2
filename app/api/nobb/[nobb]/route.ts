import { NextResponse } from "next/server";

import { getNobbDetails } from "@/lib/nobb-details";


type RouteContext = {
  params: Promise<{
    nobb: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { nobb } = await context.params;
  const nobbNumber = nobb.trim();

  if (!nobbNumber) {
    return NextResponse.json({ error: "Ugyldig NOBB-nummer." }, { status: 400 });
  }

  const details = await getNobbDetails(nobbNumber);

  if (!details) {
    return NextResponse.json(
      { error: "Fant ikke produktinformasjon for NOBB-nummeret." },
      { status: 404 },
    );
  }

  return NextResponse.json(details);
}
