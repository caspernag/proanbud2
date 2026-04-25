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
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
