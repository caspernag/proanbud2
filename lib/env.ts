export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePriceId: process.env.STRIPE_PRICE_ID_MATERIAL_LIST ?? "",
  bypassStripeCheckout: process.env.BYPASS_STRIPE_CHECKOUT === "true",
  nobbApiBaseUrl: process.env.NOBB_API_BASE_URL ?? "",
  nobbApiKey: process.env.NOBB_API_KEY ?? "",
  nobbExportUsername: process.env.NOBB_EXPORT_USERNAME ?? "",
  nobbExportPassword: process.env.NOBB_EXPORT_PASSWORD ?? "",
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiPromptIdMaterialList: process.env.OPENAI_PROMPT_ID_MATERIAL_LIST ?? "",
  openAiPromptIdClarifications: process.env.OPENAI_PROMPT_ID_CLARIFICATIONS ?? "",
  openAiVectorStoreIdStorefront:
    process.env.OPENAI_VECTOR_STORE_ID_STOREFRONT ?? "vs_69e881362da8819196c25789a50dee3d",
  storefrontImageWarmupSecret: process.env.STOREFRONT_IMAGE_WARMUP_SECRET ?? process.env.CRON_SECRET ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  byggmakkerOrderEmail: process.env.BYGGMAKKER_ORDER_EMAIL ?? "",
  trebyggOrderFromEmail: process.env.TREBYGG_ORDER_FROM_EMAIL ?? "",
  fikenApiToken: process.env.FIKEN_API_TOKEN ?? "",
  fikenCompanySlug: process.env.FIKEN_COMPANY_SLUG ?? "",
  vercelAnalyticsToken: process.env.VERCEL_ANALYTICS_TOKEN ?? process.env.VERCEL_TOKEN ?? "",
  // VERCEL_PROJECT_ID injiseres automatisk av Vercel i deploy, så bare tokenet
  // og team-IDen må settes manuelt.
  vercelProjectId: process.env.VERCEL_ANALYTICS_PROJECT_ID ?? process.env.VERCEL_PROJECT_ID ?? "",
  vercelTeamId: process.env.VERCEL_TEAM_ID ?? "",
};

export function hasSupabaseEnv() {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

export function hasSupabaseServiceRoleEnv() {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}

export function hasStripeEnv() {
  return Boolean(env.stripeSecretKey);
}

export function hasStripeWebhookEnv() {
  return Boolean(env.stripeWebhookSecret);
}

export function isStripeBypassed() {
  return env.bypassStripeCheckout && process.env.NODE_ENV === "test";
}

export function hasNobbApiEnv() {
  return Boolean(env.nobbApiBaseUrl && env.nobbApiKey);
}

export function hasNobbExportEnv() {
  return Boolean(env.nobbExportUsername && env.nobbExportPassword);
}

export function hasOpenAiEnv() {
  return Boolean(env.openAiApiKey);
}

export function hasStorefrontImageWarmupSecret() {
  return Boolean(env.storefrontImageWarmupSecret);
}

export function hasCronSecret() {
  return Boolean(env.cronSecret);
}

/**
 * Uten Fiken-nøkler kjører regnskapsposteringen i tørrmodus: bilagene bygges og
 * lagres, men sendes ikke. Det er den normale tilstanden fram til selskapet er
 * registrert og Fiken-kontoen finnes.
 */
export function hasFikenEnv() {
  return Boolean(env.fikenApiToken && env.fikenCompanySlug);
}

/**
 * Hvilke Vercel-variabler som mangler.
 *
 * Navngis, ikke bare telles: `VERCEL_PROJECT_ID` settes automatisk av Vercel i
 * deploy, men IKKE lokalt, og en melding som bare sier «ikke konfigurert»
 * sender deg til å sjekke tokenet — som pleier å være det ene som er på plass.
 */
export function missingVercelAnalyticsEnv(): string[] {
  const missing: string[] = [];
  if (!env.vercelAnalyticsToken) missing.push("VERCEL_ANALYTICS_TOKEN");
  if (!env.vercelProjectId) missing.push("VERCEL_PROJECT_ID");
  return missing;
}

/**
 * Uten token/prosjekt-ID kan ikke /sjefen lese Vercel Web Analytics. Da vises
 * en oppsettmelding i trafikkortene i stedet for tomme grafer.
 */
export function hasVercelAnalyticsEnv() {
  return missingVercelAnalyticsEnv().length === 0;
}
