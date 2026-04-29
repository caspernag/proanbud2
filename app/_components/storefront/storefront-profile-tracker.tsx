"use client";

import { useEffect } from "react";

import {
  buildStorefrontUserProfileCookie,
  parseStorefrontUserProfileCookie,
  serializeStorefrontUserProfileCookie,
  STOREFRONT_USER_PROFILE_COOKIE,
  trackStorefrontProductImpressions,
  trackStorefrontProductView,
  trackStorefrontSearch,
  type StorefrontProfileProductInput,
  type StorefrontProfileSearchInput,
} from "@/lib/storefront-user-profile";

type StorefrontProfileTrackerProps = {
  product?: StorefrontProfileProductInput;
  visibleProducts?: StorefrontProfileProductInput[];
  search?: StorefrontProfileSearchInput;
};

export function StorefrontProfileTracker({ product, visibleProducts = [], search }: StorefrontProfileTrackerProps) {
  useEffect(() => {
    const currentProfile = parseStorefrontUserProfileCookie(readCookie(STOREFRONT_USER_PROFILE_COOKIE));
    let nextProfile = currentProfile;

    if (search) {
      nextProfile = trackStorefrontSearch(nextProfile, search);
    }

    if (visibleProducts.length > 0) {
      nextProfile = trackStorefrontProductImpressions(nextProfile, visibleProducts);
    }

    if (product) {
      nextProfile = trackStorefrontProductView(nextProfile, product);
    }

    document.cookie = buildStorefrontUserProfileCookie(serializeStorefrontUserProfileCookie(nextProfile));
  }, [product, search, visibleProducts]);

  return null;
}

function readCookie(name: string) {
  const encodedName = `${encodeURIComponent(name)}=`;
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(encodedName));

  return cookie ? cookie.slice(encodedName.length) : "";
}