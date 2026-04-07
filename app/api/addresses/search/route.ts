import { NextResponse } from "next/server";

const MIN_QUERY_LENGTH = 3;
const MAX_RESULTS = 8;

type GeonorgeAddress = {
  adressetekst?: string;
  postnummer?: string;
  poststed?: string;
  kommunenavn?: string;
};

type GeonorgeResponse = {
  adresser?: GeonorgeAddress[];
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ items: [] });
  }

  const endpoint = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(query)}&fuzzy=true&treffPerSide=${MAX_RESULTS}&side=0`;

  try {
    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({ items: [] }, { status: 502 });
    }

    const payload = (await response.json()) as GeonorgeResponse;
    const addresses = payload.adresser ?? [];

    const items = addresses
      .map((address) => {
        const addressLine1 = address.adressetekst?.trim() ?? "";
        const postalCode = address.postnummer?.trim() ?? "";
        const city = address.poststed?.trim() ?? "";

        if (!addressLine1 || !postalCode || !city) {
          return null;
        }

        return {
          label: `${addressLine1}, ${postalCode} ${city}`,
          addressLine1,
          postalCode,
          city,
          municipality: address.kommunenavn?.trim() || null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] }, { status: 502 });
  }
}
