import { GlobalNavClient } from "@/app/_components/global-nav-client";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GlobalNav() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  return <GlobalNavClient isLoggedIn={Boolean(user)} userEmail={user?.email ?? null} />;
}
