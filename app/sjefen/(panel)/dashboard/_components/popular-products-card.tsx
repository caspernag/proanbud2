import Link from "next/link";

import type { AdminWebTraffic } from "@/lib/web-traffic";

import { Card } from "../../../_components/ui";
import { AnalyticsNotice } from "./analytics-notice";
import { PopularProductsTabs } from "./popular-products-tabs";

/**
 * Mest sette produktsider. Måler oppmerksomhet, ikke salg — en vare kan ligge
 * øverst her og likevel ikke være solgt én gang, og nettopp det gapet er verdt
 * å se: det er som regel pris, lagerstatus eller bilde som stopper kjøpet.
 */
export function PopularProductsCard({ traffic }: { traffic: AdminWebTraffic }) {
  return (
    <Card
      title="Mest populære produkter"
      description="Produktsider etter besøkende"
      actions={
        <Link href="/sjefen/produkter" className="text-xs font-semibold text-[#163f2a] hover:underline">
          Alle produkter →
        </Link>
      }
    >
      <AnalyticsNotice traffic={traffic} />
      <PopularProductsTabs windows={traffic.popular} />
    </Card>
  );
}
