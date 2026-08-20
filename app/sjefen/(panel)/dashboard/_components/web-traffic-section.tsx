import type { AdminWebTraffic } from "@/lib/web-traffic";

import { ADMIN_SURFACE } from "../../../_components/ui";
import { PopularProductsCard } from "./popular-products-card";
import { WebTrafficCard } from "./web-traffic-card";

/**
 * Trafikkraden under KPI-kortene.
 *
 * Tar imot løftet i stedet for dataene, slik at siden kan streame resten av
 * dashboardet med en gang. Vercel-API-et ligger utenfor vår kontroll, og ordre
 * og avvik skal ikke vente på det.
 */
export async function WebTrafficSection({ traffic }: { traffic: Promise<AdminWebTraffic> }) {
  const resolved = await traffic;

  return (
    <section className="grid gap-3 lg:grid-cols-2">
      <WebTrafficCard traffic={resolved} />
      <PopularProductsCard traffic={resolved} />
    </section>
  );
}

export function WebTrafficSectionSkeleton() {
  return (
    <section className="grid gap-3 lg:grid-cols-2">
      {["trafikk", "produkter"].map((key) => (
        <div key={key} className={`${ADMIN_SURFACE} h-[318px] animate-pulse`} />
      ))}
    </section>
  );
}
