"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { STORE_IMAGE_FALLBACK_URL } from "@/lib/storefront-image";

/**
 * Nominell intrinsic-størrelse. Den faktiske visningsstørrelsen styres av
 * `className` (containeren), men `next/image` krever width/height for å unngå
 * layout shift, og bruker forholdet til å reservere plass.
 */
const INTRINSIC_SIZE = 800;

type StorefrontProductImageProps = {
  src: string;
  alt: string;
  className?: string;
  /**
   * Påkrevd. Brukes ikke til srcset lenger (produktbilder optimaliseres ikke,
   * se under), men holdes som dokumentasjon av faktisk visningsbredde — og
   * trer i kraft igjen med én gang optimaliseringen slås på.
   */
  sizes: string;
  /** Settes på bildet over folden (produktside-hero) for å unngå lazy-load. */
  priority?: boolean;
};

export function StorefrontProductImage({
  src,
  alt,
  className,
  sizes,
  priority = false,
}: StorefrontProductImageProps) {
  const [imageSrc, setImageSrc] = useState(src);

  useEffect(() => {
    setImageSrc(src);
  }, [src]);

  const isFallback = imageSrc === STORE_IMAGE_FALLBACK_URL;

  return (
    <Image
      src={imageSrc}
      alt={alt}
      width={INTRINSIC_SIZE}
      height={INTRINSIC_SIZE}
      sizes={sizes}
      className={className}
      priority={priority}
      loading={priority ? undefined : "lazy"}
      // Produktbilder går utenom Vercels bildeoptimalisering med vilje.
      // Kildefilene er allerede normalisert til WebP på maks 1200 px ved
      // lagring (snitt ~15 kB), så optimalisereren sparte lite — men brente én
      // transformasjon per bilde per bredde per format, og da kvoten gikk tom
      // svarte den 402 (`OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED`). Da falt
      // hvert bilde ned på `onError` og viste plassholderen. SVG-fallbacket
      // kunne uansett ikke optimaliseres (Next avviser SVG uten
      // `dangerouslyAllowSVG`).
      unoptimized
      onError={() => {
        if (!isFallback) {
          setImageSrc(STORE_IMAGE_FALLBACK_URL);
        }
      }}
    />
  );
}
