"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export const STOREFRONT_CART_STORAGE_KEY = "proanbud_storefront_cart_v2";

export type StorefrontCartItem = {
  productId: string;
  quantity: number;
};

type StorefrontContextValue = {
  items: StorefrontCartItem[];
  itemCount: number;
  totalQuantity: number;
  addItem: (productId: string, quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
};

const StorefrontContext = createContext<StorefrontContextValue | null>(null);

export function StorefrontProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<StorefrontCartItem[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [cartNoticeVisible, setCartNoticeVisible] = useState(false);
  const cartNoticeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STOREFRONT_CART_STORAGE_KEY);

      if (!raw) {
        setHasLoaded(true);
        return;
      }

      const parsed = JSON.parse(raw) as unknown;

      if (!Array.isArray(parsed)) {
        setHasLoaded(true);
        return;
      }

      setItems(
        parsed
          .filter(
            (entry): entry is StorefrontCartItem =>
              Boolean(entry) &&
              typeof entry === "object" &&
              typeof (entry as StorefrontCartItem).productId === "string" &&
              typeof (entry as StorefrontCartItem).quantity === "number",
          )
          .map((entry) => ({
            productId: entry.productId,
            quantity: clampQuantity(entry.quantity),
          })),
      );
    } catch {
      // Ignore malformed local storage data.
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoaded) {
      return;
    }

    window.localStorage.setItem(STOREFRONT_CART_STORAGE_KEY, JSON.stringify(items));
  }, [hasLoaded, items]);

  useEffect(() => {
    return () => {
      if (cartNoticeTimeoutRef.current) {
        window.clearTimeout(cartNoticeTimeoutRef.current);
      }
    };
  }, []);

  const showCartNotice = useCallback(() => {
    setCartNoticeVisible(true);

    if (cartNoticeTimeoutRef.current) {
      window.clearTimeout(cartNoticeTimeoutRef.current);
    }

    cartNoticeTimeoutRef.current = window.setTimeout(() => {
      setCartNoticeVisible(false);
    }, 4500);
  }, []);

  const value = useMemo<StorefrontContextValue>(
    () => ({
      items,
      itemCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      addItem(productId, quantity = 1) {
        showCartNotice();
        setItems((current) => {
          const existing = current.find((item) => item.productId === productId);

          if (!existing) {
            return [...current, { productId, quantity: clampQuantity(quantity) }];
          }

          return current.map((item) =>
            item.productId === productId
              ? { ...item, quantity: clampQuantity(item.quantity + quantity) }
              : item,
          );
        });
      },
      removeItem(productId) {
        setItems((current) => current.filter((item) => item.productId !== productId));
      },
      updateQuantity(productId, quantity) {
        setItems((current) =>
          current.flatMap((item) => {
            if (item.productId !== productId) {
              return [item];
            }

            const nextQuantity = clampQuantity(quantity);

            if (nextQuantity <= 0) {
              return [];
            }

            return [{ ...item, quantity: nextQuantity }];
          }),
        );
      },
      clearCart() {
        setItems([]);
      },
    }),
    [items, showCartNotice],
  );

  return (
    <StorefrontContext.Provider value={value}>
      {children}
      <CartNotice
        visible={cartNoticeVisible && value.totalQuantity > 0}
        totalQuantity={value.totalQuantity}
        onClose={() => setCartNoticeVisible(false)}
      />
    </StorefrontContext.Provider>
  );
}

export function useStorefront() {
  const context = useContext(StorefrontContext);

  if (!context) {
    throw new Error("useStorefront must be used within a StorefrontProvider.");
  }

  return context;
}

function clampQuantity(quantity: number) {
  return Math.max(0, Math.min(999, Math.round(quantity)));
}

function CartNotice({
  visible,
  totalQuantity,
  onClose,
}: {
  visible: boolean;
  totalQuantity: number;
  onClose: () => void;
}) {
  return (
    <div
      className={`fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md transition duration-200 sm:right-6 sm:left-auto sm:mx-0 ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-2.5 shadow-[0_18px_45px_rgba(32,25,15,0.18)]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#15452d] text-white">
          <CartIcon />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-stone-900">Lagt i handlekurven</p>
          <p className="text-xs text-stone-500">{totalQuantity} {totalQuantity === 1 ? "vare" : "varer"} klar for checkout</p>
        </div>
        <Link
          href="/checkout"
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-[#15452d] px-3 text-sm font-semibold text-white! transition hover:bg-[#0f321f]"
          onClick={onClose}
        >
          Til kassen
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
          aria-label="Lukk"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <path d="M2 3h2l2 11a1.8 1.8 0 001.8 1.5h6.7a1.8 1.8 0 001.8-1.4L18 7H5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="18" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
