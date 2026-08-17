import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  outputFileTracingRoot: process.cwd(),
  outputFileTracingExcludes: {
    "*": [".private/**"],
  },
  images: {
    // Produktbilder er statiske: de endrer seg bare når prisimporten bytter
    // bilde. Lang CDN-TTL betyr at Vercel optimaliserer hvert bilde én gang.
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 dager
    formats: ["image/avif", "image/webp"],
    // Produktbilder vises aldri bredere enn ~700 px. Uten denne listen
    // genererer Next varianter helt opp til 3840 px som ingen ber om.
    imageSizes: [64, 96, 128, 200, 256, 320],
    deviceSizes: [360, 480, 640, 828, 1080, 1200],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "export.byggtjeneste.no",
      },
      {
        // Supabase Storage — enables next/image with direct public bucket URLs.
        // Make the material-images bucket public in the Supabase dashboard to
        // serve images via Vercel's image CDN and eliminate Storage egress.
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
