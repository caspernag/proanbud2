"use client";

import { startTransition, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type LoginFormProps = {
  nextPath: string;
  supabaseEnabled: boolean;
};

export function LoginForm({ nextPath, supabaseEnabled }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "error" | "success">("neutral");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabaseEnabled) {
      setMessageTone("error");
      setMessage("Legg inn Supabase-noklene dine i miljøvariablene for å aktivere innlogging.");
      return;
    }

    startTransition(() => {
      setPending(true);
      setMessage("");
      setMessageTone("neutral");
    });

    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setPending(false);
      setMessageTone("error");
      setMessage("Supabase-klienten kunne ikke startes.");
      return;
    }

    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", nextPath);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo.toString(),
      },
    });

    setPending(false);
    setMessageTone(error ? "error" : "success");
    setMessage(error ? error.message : "Innloggingslenke sendt. Sjekk e-posten din.");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5">
      <label htmlFor="email" className="sr-only">
        E-postadresse
      </label>
      <Input
        id="email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="ola@nordmann.no"
        autoComplete="email"
        required
        className="h-9"
      />

      <Button
        type="submit"
        disabled={pending}
        className="h-9 w-full"
      >
        {pending ? "Sender..." : "Logg inn uten passord"}
      </Button>

      {message ? (
        <p
          className={`rounded-md border px-2.5 py-1.5 text-xs ${
            messageTone === "error"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : messageTone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-stone-200 bg-stone-50 text-stone-700"
          }`}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
