import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
    ],
  },
  experimental: {
    // Rewrites barrel imports to deep per-icon/per-module imports so a single
    // named import doesn't drag the whole package into the client bundle.
    optimizePackageImports: ["lucide-react", "react-syntax-highlighter"],
  },
};

export default nextConfig;
