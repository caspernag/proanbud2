import type { MetadataRoute } from "next";

import { PUBLIC_ORIGIN } from "@/lib/public-origin";

/**
 * Uten denne fila ble `/robots.txt` fanget av produkt-catch-all-en `[slug]`, og
 * hver crawler som spurte etter den fikk en «Produkt ikke funnet»-side med
 * status 200 — og kostet et funksjonskall og et katalogoppslag i Supabase.
 * Sitemap-henvisningen er den andre halvdelen: crawlere som ikke får en liste
 * over de faktiske produkt-URL-ene gjetter i stedet.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/auth/", "/login", "/sjefen", "/min-side", "/prosjekter", "/betaling", "/checkout", "/ordre/"],
    },
    sitemap: `${PUBLIC_ORIGIN}/sitemap.xml`,
  };
}
