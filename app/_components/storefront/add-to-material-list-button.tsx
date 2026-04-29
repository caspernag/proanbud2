"use client";

import { useState } from "react";

export const PENDING_MATERIAL_LIST_PRODUCTS_KEY = "proanbud_pending_material_list_products_v1";

type PendingMaterialListProduct = {
  source: "catalog";
  productName: string;
  quantity: string;
  comment: string;
  quantityReason: string;
  nobbNumber?: string;
  supplierName?: string;
  unitPriceNok?: number;
  productUrl?: string;
  imageUrl?: string;
  sectionTitle?: string;
  category?: string;
};

type AddToMaterialListButtonProps = PendingMaterialListProduct & {
  compact?: boolean;
};

export function AddToMaterialListButton({ compact = false, ...product }: AddToMaterialListButtonProps) {
  const [added, setAdded] = useState(false);

  function handleClick() {
    try {
      const existing = readPendingProducts();
      const duplicate = existing.some((entry) => {
        if (product.nobbNumber && entry.nobbNumber === product.nobbNumber) return true;
        if (product.productUrl && entry.productUrl === product.productUrl) return true;
        return entry.productName.toLowerCase() === product.productName.toLowerCase();
      });
      const next = duplicate ? existing : [product, ...existing].slice(0, 20);
      window.sessionStorage.setItem(PENDING_MATERIAL_LIST_PRODUCTS_KEY, JSON.stringify(next));
    } catch {
      // Keep navigation working even if sessionStorage is unavailable.
    }

    setAdded(true);
    window.setTimeout(() => {
      window.location.href = "/min-side/materiallister?nyMaterialliste=1";
    }, 120);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        compact
          ? "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 shadow-sm transition hover:border-[#15452d] hover:bg-[#15452d] hover:text-white"
          : "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 shadow-sm transition hover:border-[#15452d] hover:bg-[#15452d] hover:text-white"
      }
      aria-label={added ? "Legger produkt i materialliste" : "Legg til i materialliste"}
      title="Legg til i materialliste"
    >
      {added ? <CheckIcon /> : <PlusIcon />}
    </button>
  );
}

function readPendingProducts(): PendingMaterialListProduct[] {
  const raw = window.sessionStorage.getItem(PENDING_MATERIAL_LIST_PRODUCTS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((entry): entry is PendingMaterialListProduct => {
      return Boolean(
        entry &&
          typeof entry === "object" &&
          (entry as PendingMaterialListProduct).source === "catalog" &&
          typeof (entry as PendingMaterialListProduct).productName === "string" &&
          typeof (entry as PendingMaterialListProduct).quantity === "string",
      );
    });
  } catch {
    return [];
  }
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M4.5 10.5l3.2 3.2 7.8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}