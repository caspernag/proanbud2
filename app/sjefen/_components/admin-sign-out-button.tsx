"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AdminSignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    startTransition(() => setPending(true));
    await supabase.auth.signOut();
    router.push("/sjefen");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={pending}
      className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-emerald-100/70 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      {pending ? "Logger ut…" : "Logg ut"}
    </button>
  );
}
