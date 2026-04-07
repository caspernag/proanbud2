import { NextResponse } from "next/server";

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 8;

type BrregCompany = {
  navn?: string;
  organisasjonsnummer?: string;
  forretningsadresse?: {
    adresselinje1?: string;
    adresselinje2?: string;
    adresselinje3?: string;
    postnummer?: string;
    poststed?: string;
  };
};

type BrregResponse = {
  _embedded?: {
    enheter?: BrregCompany[];
  };
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ items: [] });
  }

  const endpoint = `https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(query)}&size=${MAX_RESULTS}`;

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

    const payload = (await response.json()) as BrregResponse;
    const companies = payload._embedded?.enheter ?? [];

    const items = companies
      .map((company) => {
        const name = company.navn?.trim() ?? "";
        const organizationNumber = company.organisasjonsnummer?.trim() ?? "";

        if (!name || !organizationNumber) {
          return null;
        }

        const addressParts = [
          company.forretningsadresse?.adresselinje1,
          company.forretningsadresse?.adresselinje2,
          company.forretningsadresse?.adresselinje3,
        ]
          .filter(Boolean)
          .map((part) => part!.trim())
          .filter((part) => part.length > 0);

        const postalCode = company.forretningsadresse?.postnummer?.trim() ?? "";
        const city = company.forretningsadresse?.poststed?.trim() ?? "";
        const postalLine = [postalCode, city].filter(Boolean).join(" ").trim();

        return {
          name,
          organizationNumber,
          addressLine: addressParts.join(", ") || null,
          postalLine: postalLine.length > 0 ? postalLine : null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] }, { status: 502 });
  }
}
