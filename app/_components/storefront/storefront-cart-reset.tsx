"use client";

import { useEffect } from "react";

import { STOREFRONT_CART_STORAGE_KEY } from "@/app/_components/storefront/storefront-provider";

export function StorefrontCartReset() {
  useEffect(() => {
    try {
      window.localStorage.removeItem(STOREFRONT_CART_STORAGE_KEY);
    } catch {
      // Ignore local storage access issues on confirmation pages.
    }
  }, []);

  return null;
}
