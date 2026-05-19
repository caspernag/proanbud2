"use client";

import { useState, type ReactNode } from "react";

import { AddToCartButton } from "@/app/_components/storefront/add-to-cart-button";

export function AddToCartWithQuantity({
  productId,
  secondaryAction,
  compact = false,
  quantity: controlledQuantity,
  onQuantityChange,
}: {
  productId: string;
  secondaryAction?: ReactNode;
  compact?: boolean;
  quantity?: number;
  onQuantityChange?: (quantity: number) => void;
}) {
  const [uncontrolledQuantity, setUncontrolledQuantity] = useState(1);
  const quantity = controlledQuantity ?? uncontrolledQuantity;

  function setQuantity(nextQuantity: number) {
    const safeQuantity = clampQuantity(nextQuantity);
    onQuantityChange?.(safeQuantity);

    if (controlledQuantity === undefined) {
      setUncontrolledQuantity(safeQuantity);
    }
  }

  return (
    <div className={`grid gap-2 ${secondaryAction ? "grid-cols-[minmax(0,1fr)_auto]" : ""}`}>
      <div className={`grid min-w-0 gap-2 ${compact ? "grid-cols-[70px_minmax(0,1fr)]" : "grid-cols-[78px_minmax(0,1fr)]"}`}>
        <QuantityStepper compact={compact} value={quantity} onChange={setQuantity} />
        <AddToCartButton
          productId={productId}
          quantity={quantity}
          fullWidth
          compact={compact}
          label="Legg i kurv"
          addedLabel="Lagt til"
        />
      </div>
      {secondaryAction ? <div className="shrink-0">{secondaryAction}</div> : null}
    </div>
  );
}

function QuantityStepper({
  compact,
  value,
  onChange,
}: {
  compact: boolean;
  value: number;
  onChange: (nextValue: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit(rawValue: string) {
    const parsed = Number.parseInt(rawValue, 10);
    setDraft(null);

    if (Number.isFinite(parsed)) {
      onChange(clampQuantity(parsed));
    }
  }

  const buttonClass = compact ? "h-10 w-5" : "h-10 w-6";
  const inputClass = compact ? "w-6" : "w-7";

  return (
    <div className="inline-flex h-10 min-w-0 items-center rounded-md border border-stone-300 bg-white text-stone-800 shadow-sm">
      <button
        type="button"
        onClick={() => onChange(clampQuantity(value - 1))}
        disabled={value <= 1}
        className={`${buttonClass} inline-flex items-center justify-center rounded-l-md text-sm font-bold transition hover:bg-stone-50 hover:text-[#15452d] disabled:cursor-not-allowed disabled:text-stone-300`}
        aria-label="Reduser antall"
      >
        -
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => {
          setDraft(String(value));
          event.currentTarget.select();
        }}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
        className={`${inputClass} h-10 border-x border-stone-200 bg-transparent text-center text-sm font-bold tabular-nums text-stone-900 outline-none focus:ring-1 focus:ring-inset focus:ring-[#15452d]`}
        aria-label="Antall som legges i handlekurv"
      />
      <button
        type="button"
        onClick={() => onChange(clampQuantity(value + 1))}
        className={`${buttonClass} inline-flex items-center justify-center rounded-r-md text-sm font-bold transition hover:bg-stone-50 hover:text-[#15452d]`}
        aria-label="Øk antall"
      >
        +
      </button>
    </div>
  );
}

function clampQuantity(value: number) {
  return Math.max(1, Math.min(999, Math.round(value)));
}
