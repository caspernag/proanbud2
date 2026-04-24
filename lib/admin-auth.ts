import { redirect } from "next/navigation";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Call this at the top of every protected /sjefen page.
 * Returns the authenticated admin user, or redirects to /sjefen.
 */
export async function requireAdminUser() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/sjefen");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/sjefen");

  const admin = createSupabaseAdminClient();
  if (!admin) redirect("/sjefen");

  const { data: adminRow } = await admin
    .from("admin_users")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!adminRow) redirect("/sjefen");

  return user;
}

/**
 * Returns true if the currently authenticated user is an admin. Does not throw.
 */
export async function isAdminUser(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return false;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const admin = createSupabaseAdminClient();
    if (!admin) return false;

    const { data } = await admin
      .from("admin_users")
      .select("id")
      .eq("user_id", user.id)
      .single();

    return Boolean(data);
  } catch {
    return false;
  }
}
