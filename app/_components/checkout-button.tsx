"use client";

import Link from "next/link";
import { startTransition, useState } from "react";

type CheckoutButtonProps = {
  slug: string;
  projectId?: string;
  projectName: string;
  priceNok: number;
  requiresAuth: boolean;
  bypassStripe: boolean;
  authNextPath?: string;
};

export function CheckoutButton({
  slug,
  projectId,
  projectName,
  priceNok,
  requiresAuth,
  bypassStripe,
  authNextPath,
}: CheckoutButtonProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function handleCheckout() {
    startTransition(() => {
      setPending(true);
      setMessage("");
    });

    const formData = new FormData();
    formData.set("slug", slug);
    formData.set("projectId", projectId ?? slug);
    formData.set("projectName", projectName);
    formData.set("priceNok", String(priceNok));

    const response = await fetch("/api/checkout", {
      method: "POST",
      body: formData,
    });

    const payload = (await response.json()) as { error?: string; url?: string };

    if (!response.ok || !payload.url) {
      setPending(false);
      setMessage(payload.error ?? "Kunne ikke låse opp prosjektet nå.");
      return;
    }

    window.location.href = payload.url;
  }

  if (requiresAuth) {
    const nextPath = authNextPath ?? `/min-side/materiallister/${slug}`;

    return (
      <div className="space-y-3">
        <Link
          href={`/login?next=${encodeURIComponent(nextPath)}`}
          className="inline-flex w-full items-center justify-center rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
        >
          Logg inn for å låse opp
        </Link>
        <p className="text-sm text-stone-600">
          Prosjektet lagres i kontoen din før opplåsing av full liste.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleCheckout}
        disabled={pending}
        className="inline-flex w-full items-center justify-center rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-500"
      >
        {pending ? (bypassStripe ? "Låser opp..." : "Sender til betaling...") : "Lås opp full liste"}
      </button>
      <p className="min-h-6 text-sm text-stone-600">{message}</p>
    </div>
  );
}
