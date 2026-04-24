"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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

  const value = useMemo<StorefrontContextValue>(
    () => ({
      items,
      itemCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      addItem(productId, quantity = 1) {
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
    [items],
  );

  return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>;
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
