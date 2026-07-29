import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
  preload: true,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  // Mono is only used inside code/textarea, so don't block first paint on it.
  preload: false,
});

export const metadata: Metadata = {
  title: "CopyPaste — Cross-device clipboard",
  description:
    "Sync text, code, links, images, and files across your devices instantly.",
  applicationName: "CopyPaste",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "CopyPaste",
    // Lets the app paint behind the status bar when installed on iOS, which is
    // what makes the safe-area insets below meaningful.
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Required for env(safe-area-inset-*) to report anything but zero. Without it
  // the composer's safe-area padding is a no-op and, once installed as a PWA,
  // the send button sits under the iOS home indicator.
  viewportFit: "cover",
  // Tell mobile browsers to shrink the *layout* viewport when the software
  // keyboard opens instead of overlaying it. Without this, the bottom of the
  // app (the composer's send button) ends up underneath the keyboard and,
  // because the shell uses overflow:hidden, can't be scrolled into view.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

// Applies the persisted theme before first paint to avoid a flash of the
// wrong colour scheme. Inlined (rather than next/script) so it runs
// synchronously with zero extra runtime.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Warm up the DNS/TLS handshake for image delivery before any <img> is parsed. */}
        <link rel="preconnect" href="https://res.cloudinary.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://res.cloudinary.com" />
      </head>
      <body className="min-h-full flex flex-col bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
        <Toaster position="top-center" richColors closeButton duration={2200} />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
