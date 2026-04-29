"use client";

import { useState } from "react";

const CART_STORAGE_KEY = "proanbud_storefront_cart_v2";

type CartItem = {
  productId: string;
  quantity: number;
};

type ApiResponse = {
  items: CartItem[];
  unmatched: { productName: string; nobbNumber: string }[];
  matchedCount: number;
  totalRows?: number;
  withNobbCount?: number;
  reason?: "no_nobb";
};

export function AddMaterialListToCartButton({ projectSlug }: { projectSlug: string }) {
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "info"; message: string }
  >({ kind: "idle" });

  const handleClick = async () => {
    setStatus({ kind: "loading" });

    try {
      const response = await fetch(`/api/projects/${projectSlug}/add-to-cart`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setStatus({
          kind: "error",
          message: data.error ?? "Kunne ikke legge til i handlekurven.",
        });
        return;
      }

      const data = (await response.json()) as ApiResponse;

      if (data.items.length === 0) {
        if (data.reason === "no_nobb") {
          setStatus({
            kind: "error",
            message:
              data.totalRows && data.totalRows > 0
                ? "Ingen av produktene har NOBB-nummer. Velg katalogprodukter for å legge i kurv."
                : "Materiallisten er tom.",
          });
        } else {
          setStatus({
            kind: "error",
            message: `${data.unmatched.length} produkter med NOBB ble ikke funnet i nettbutikken.`,
          });
        }
        return;
      }

      // Merge with existing localStorage cart
      const existing = readCart();
      const merged = mergeCart(existing, data.items);
      writeCart(merged);

      const skipped = data.unmatched.length;
      if (skipped > 0) {
        setStatus({
          kind: "info",
          message: `${data.matchedCount} produkter lagt i kurv. ${skipped} fantes ikke i nettbutikken.`,
        });
      }

      // Brief delay so info is seen, then redirect
      window.setTimeout(() => {
        window.location.href = "/checkout";
      }, skipped > 0 ? 900 : 100);
    } catch {
      setStatus({
        kind: "error",
        message: "Noe gikk galt. Prøv igjen.",
      });
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={status.kind === "loading"}
        className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-sm border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 transition hover:border-stone-900 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <CartIcon />
        {status.kind === "loading" ? "Legger til …" : "Legg i handlekurv"}
      </button>
      {status.kind === "error" ? (
        <p className="rounded-sm border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700">
          {status.message}
        </p>
      ) : null}
      {status.kind === "info" ? (
        <p className="rounded-sm border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          {status.message}
        </p>
      ) : null}
    </div>
  );
}

function readCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is CartItem =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as CartItem).productId === "string" &&
        typeof (item as CartItem).quantity === "number",
      )
      .map((item) => ({ productId: item.productId, quantity: Math.max(1, Math.round(item.quantity)) }));
  } catch {
    return [];
  }
}

function writeCart(items: CartItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

function mergeCart(existing: CartItem[], additions: CartItem[]): CartItem[] {
  const map = new Map<string, number>();
  for (const item of existing) {
    map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
  }
  for (const item of additions) {
    map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
  }
  return Array.from(map, ([productId, quantity]) => ({ productId, quantity }));
}

function CartIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M3 3.5h2l1.4 9.2a1.5 1.5 0 0 0 1.5 1.3h6.7a1.5 1.5 0 0 0 1.5-1.2l1.1-5.3H6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="17" r="1.2" fill="currentColor" />
      <circle cx="14.5" cy="17" r="1.2" fill="currentColor" />
    </svg>
  );
}
