"use client";

import { useState } from "react";

import { useStorefront } from "@/app/_components/storefront/storefront-provider";

export function AddToCartButton({
  productId,
  quantity = 1,
  tone = "primary",
}: {
  productId: string;
  quantity?: number;
  tone?: "primary" | "secondary";
}) {
  const { addItem } = useStorefront();
  const [recentlyAdded, setRecentlyAdded] = useState(false);

  const base =
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition active:scale-[0.97]";
  const palette =
    tone === "primary"
      ? recentlyAdded
        ? "bg-emerald-600 text-white shadow-[0_6px_16px_rgba(22,101,52,0.35)]"
        : "bg-[#15452d] text-white shadow-[0_6px_16px_rgba(21,69,45,0.25)] hover:bg-[#0f321f]"
      : "border border-stone-300 bg-white text-stone-800 hover:border-[#15452d] hover:text-[#15452d]";

  return (
    <button
      type="button"
      onClick={() => {
        addItem(productId, quantity);
        setRecentlyAdded(true);
        window.setTimeout(() => setRecentlyAdded(false), 1400);
      }}
      className={`${base} ${palette}`}
      aria-label={recentlyAdded ? "Lagt i kurven" : "Legg i kurv"}
    >
      {recentlyAdded ? (
        <>
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M7.5 13.5l-3-3 1.4-1.4 1.6 1.6L13.1 4.7l1.4 1.4z" />
          </svg>
          Lagt til
        </>
      ) : (
        <>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
            <path d="M2 3h2l2 11a1.8 1.8 0 001.8 1.5h6.7a1.8 1.8 0 001.8-1.4L18 7H5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="8" cy="18" r="1" fill="currentColor" stroke="none" />
            <circle cx="15" cy="18" r="1" fill="currentColor" stroke="none" />
          </svg>
          Legg i kurv
        </>
      )}
    </button>
  );
}
