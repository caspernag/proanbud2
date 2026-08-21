/**
 * Kanonisk opprinnelse for absolutte URL-er som skal ut av appen (sitemap,
 * robots).
 *
 * Bevisst uten `VERCEL_URL`-fallback: den peker på deployment-URL-en
 * (`prisbygg-<hash>.vercel.app`), og en sitemap som lister den i stedet for
 * prisbygg.no forteller søkemotorene at innholdet bor et annet sted enn det
 * gjør.
 */
export const PUBLIC_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://prisbygg.no").replace(/\/$/, "");
