import { createClient } from "@supabase/supabase-js";

import { env, hasSupabaseServiceRoleEnv } from "@/lib/env";

export function createSupabaseAdminClient() {
  if (!hasSupabaseServiceRoleEnv()) {
    return null;
  }

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
