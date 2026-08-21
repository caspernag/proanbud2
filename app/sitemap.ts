import type { MetadataRoute } from "next";

import { PUBLIC_ORIGIN } from "@/lib/public-origin";
import { getStorefrontProductSlugs } from "@/lib/storefront";

/**
 * Produktsidene er allerede prerendret via `generateStaticParams`, så en
 * sitemap koster ingenting ekstra å servere — den bruker samme slug-liste.
 *
 * Poenget er ikke bare indeksering: uten sitemap gjetter crawlere seg fram til
 * URL-er, og hver bom traff `[slug]` som et fullt katalogoppslag.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await getStorefrontProductSlugs();

  return [
    {
      url: PUBLIC_ORIGIN,
      changeFrequency: "daily" as const,
      priority: 1,
    },
    ...slugs.map((slug) => ({
      url: `${PUBLIC_ORIGIN}/${slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
