import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  outputFileTracingRoot: process.cwd(),
  outputFileTracingExcludes: {
    "*": [".private/**"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "export.byggtjeneste.no",
      },
      {
        protocol: "https",
        hostname: "www.svgrepo.com",
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
