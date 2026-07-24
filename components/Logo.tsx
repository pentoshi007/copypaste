import type { SVGProps } from "react";

/**
 * CopyPaste logo — two overlapping rounded cards (copy/duplicate motif)
 * with a cursor arrow sweeping between them (paste action).
 * Modern gradient: indigo → fuchsia → orange.
 */
export default function Logo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="CopyPaste"
      {...props}
    >
      <defs>
        <linearGradient id="cp-grad-a" x1="4" y1="6" x2="20" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6366F1" />
          <stop offset="1" stopColor="#A855F7" />
        </linearGradient>
        <linearGradient id="cp-grad-b" x1="16" y1="4" x2="36" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#EC4899" />
          <stop offset="1" stopColor="#F97316" />
        </linearGradient>
      </defs>

      {/* Back card (indigo → purple) */}
      <rect x="4" y="6" width="20" height="24" rx="4.5" fill="url(#cp-grad-a)" />
      {/* Text lines on back card */}
      <rect x="8" y="11" width="10" height="2" rx="1" fill="white" fillOpacity="0.55" />
      <rect x="8" y="15.5" width="12" height="2" rx="1" fill="white" fillOpacity="0.4" />
      <rect x="8" y="20" width="7" height="2" rx="1" fill="white" fillOpacity="0.3" />

      {/* Front card (pink → orange) — offset up-right to show overlap */}
      <rect x="15" y="10" width="20" height="24" rx="4.5" fill="url(#cp-grad-b)" />
      {/* Cursor / paste arrow on front card */}
      <path
        d="M21 16.5L29 20.5L26 22L28 25.5L26.2 26.4L24.2 22.9L21 24.5L21 16.5Z"
        fill="white"
      />
      {/* Subtle highlight on front card top edge */}
      <rect x="15" y="10" width="20" height="6" rx="4.5" fill="white" fillOpacity="0.08" />
    </svg>
  );
}
