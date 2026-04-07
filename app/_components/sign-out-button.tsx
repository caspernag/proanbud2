"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type SignOutButtonProps = {
  tone?: "light" | "dark";
};

export function SignOutButton({ tone = "light" }: SignOutButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      return;
    }

    startTransition(() => {
      setPending(true);
    });

    await supabase.auth.signOut();
    router.refresh();
  }

  const className =
    tone === "dark"
      ? "inline-flex h-8 items-center justify-center rounded-[3px] border border-white/40 px-3 text-xs font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
      : "inline-flex h-8 items-center justify-center rounded-md border border-stone-300 px-3 text-xs font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      className={className}
    >
      {pending ? "Logger ut..." : "Logg ut"}
    </button>
  );
}
