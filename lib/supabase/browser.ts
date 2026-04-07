import { createBrowserClient } from "@supabase/ssr";

import { env, hasSupabaseEnv } from "@/lib/env";

export function createSupabaseBrowserClient() {
  if (!hasSupabaseEnv()) {
    return null;
  }

  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
