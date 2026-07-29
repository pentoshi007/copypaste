import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Content Security Policy.
 *
 * `script-src` still needs 'unsafe-inline': the pre-paint theme script in
 * app/layout.tsx is inline, and Next emits its own inline bootstrap. Moving to
 * nonces would require rendering the CSP per request from middleware. Even with
 * that relaxation the policy blocks externally-hosted scripts, framing,
 * plugins, and form posts to other origins.
 */
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  // Tailwind and inline style attributes.
  "style-src 'self' 'unsafe-inline'",
  // blob:/data: cover local previews of a file before it's uploaded.
  "img-src 'self' data: blob: https://res.cloudinary.com",
  "font-src 'self' data:",
  // Direct uploads go to Cloudinary and R2 from the browser.
  "connect-src 'self' https://api.cloudinary.com https://res.cloudinary.com https://*.r2.cloudflarestorage.com",
  "media-src 'self' blob: https://res.cloudinary.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  // Production only: on a dev machine this would rewrite
  // http://192.168.x.x:3000 to https and break testing from a phone on the LAN.
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Stop browsers guessing a different content type than we send.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak note contents via the Referer header to third parties.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Isolate this origin from cross-origin popups/embeds.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // HSTS is meaningless (and confusing) over plain-HTTP local development.
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
    // Rewrites barrel imports to deep per-icon/per-module imports so a single
    // named import doesn't drag the whole package into the client bundle.
    optimizePackageImports: ["lucide-react", "react-syntax-highlighter"],
  },
  async headers() {
    return [
      {
        // Everything except Next's immutable build assets, which don't need it.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
