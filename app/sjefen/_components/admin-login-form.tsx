"use client";

import { startTransition, useState, type FormEvent } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AdminLoginForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"neutral" | "error" | "success">("neutral");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    startTransition(() => {
      setPending(true);
      setMessage("");
      setTone("neutral");
    });

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setPending(false);
      setTone("error");
      setMessage("Supabase-klienten kunne ikke startes.");
      return;
    }

    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", "/sjefen/dashboard");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo.toString() },
    });

    setPending(false);
    setTone(error ? "error" : "success");
    setMessage(
      error ? error.message : "Innloggingslenke sendt. Sjekk e-posten din."
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="admin-email" className="block text-xs font-medium text-stone-500 mb-1.5 uppercase tracking-widest">
          E-post
        </label>
        <input
          id="admin-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@eksempel.no"
          className="w-full rounded-lg bg-stone-100 border border-stone-300 px-4 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-900 font-semibold py-2.5 text-sm transition"
      >
        {pending ? "Sender…" : "Send innloggingslenke"}
      </button>

      {message && (
        <p
          className={`text-xs rounded-lg px-3 py-2 ${
            tone === "error"
              ? "bg-red-500/10 text-red-400"
              : tone === "success"
              ? "bg-emerald-500/10 text-emerald-400"
              : "text-stone-500"
          }`}
        >
          {message}
        </p>
      )}
    </form>
  );
}
