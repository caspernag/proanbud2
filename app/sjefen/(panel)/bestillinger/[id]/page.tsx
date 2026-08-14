import { redirect } from "next/navigation";

/**
 * Ordredetaljene bor nå i logistikkpanelet, som har hele arbeidsflyten
 * (transportsteg, sporing, varsling, pakkseddel). Gamle bokmerker og lenker
 * sendes dit i stedet for at vi vedlikeholder to detaljsider.
 */
export default async function BestillingRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/sjefen/logistikk/${id}`);
}
