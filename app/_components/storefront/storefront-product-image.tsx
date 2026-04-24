"use client";

import { useEffect, useState } from "react";

import { STORE_IMAGE_FALLBACK_URL } from "@/lib/storefront-image";

export function StorefrontProductImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [imageSrc, setImageSrc] = useState(src);

  useEffect(() => {
    setImageSrc(src);
  }, [src]);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt={alt}
        loading="lazy"
        onError={() => {
          if (imageSrc !== STORE_IMAGE_FALLBACK_URL) {
            setImageSrc(STORE_IMAGE_FALLBACK_URL);
          }
        }}
        className={className}
      />
    </>
  );
}
