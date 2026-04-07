import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { MinSideShell } from "@/app/_components/min-side-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function MinSideLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

  if (supabase && !user) {
    redirect(`/login?next=${encodeURIComponent("/min-side")}`);
  }

  return <MinSideShell userEmail={user?.email ?? null}>{children}</MinSideShell>;
}
