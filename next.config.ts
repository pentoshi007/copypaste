import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",

  "object-src 'self' blob: https://*.r2.cloudflarestorage.com",

  "frame-ancestors 'self'",

  "frame-src 'self' https://*.r2.cloudflarestorage.com",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",

  "style-src 'self' 'unsafe-inline'",

  "img-src 'self' data: blob: https://res.cloudinary.com",
  "font-src 'self' data:",

  "connect-src 'self' https://api.cloudinary.com https://res.cloudinary.com https://*.r2.cloudflarestorage.com",
  "media-src 'self' blob: https://res.cloudinary.com https://*.r2.cloudflarestorage.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",

  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },

  { key: "X-Content-Type-Options", value: "nosniff" },

  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },

  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },

  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

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

    optimizePackageImports: ["lucide-react", "react-syntax-highlighter"],
  },
  async headers() {
    return [
      {

        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
