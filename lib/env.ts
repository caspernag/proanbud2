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
  resendApiKey: process.env.RESEND_API_KEY ?? "",
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
  return env.bypassStripeCheckout && process.env.NODE_ENV !== "production";
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
