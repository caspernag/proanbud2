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
   * Påkrevd. Uten `sizes` antar nettleseren at bildet er like bredt som
   * viewporten og laster ned den største varianten i srcset — altså akkurat
   * problemet vi prøver å løse. Oppgi den faktiske CSS-bredden per breakpoint.
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
      // SVG-fallbacket optimaliseres ikke (Next avviser SVG uten
      // `dangerouslyAllowSVG`, og en 400-bytes vektorfil har ingenting å hente).
      unoptimized={isFallback}
      onError={() => {
        if (!isFallback) {
          setImageSrc(STORE_IMAGE_FALLBACK_URL);
        }
      }}
    />
  );
}
