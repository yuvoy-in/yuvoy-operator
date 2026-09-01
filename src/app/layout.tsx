import type { Metadata, Viewport } from "next";
import { fraunces, satoshi } from "@/lib/fonts";
import "./globals.css";

/**
 * The operator portal's shell.
 *
 * Noindex and nofollow, unconditionally and with no environment switch. There
 * is no version of this origin that should be in a search index: every page
 * behind it is one operator's bookings, and the sign-in page in front of it is
 * a phone-number form whose only value to a stranger is confirming which
 * businesses work with Yuvoy. The traveller app's `NEXT_PUBLIC_ALLOW_INDEXING`
 * has no counterpart here on purpose — a switch implies a setting where there
 * is only ever one right answer.
 */
export const metadata: Metadata = {
  title: {
    default: "Yuvoy for operators",
    template: "%s · Yuvoy for operators",
  },
  description: "Run your departures on Yuvoy.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#16362e",
  width: "device-width",
  initialScale: 1,
  /*
    `viewport-fit: cover` is deliberately NOT set — a standing rule from the
    marketing site's header work, carried across both apps.
  */
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${satoshi.variable}`}>
      <body className="bg-cream text-forest">
        <a
          href="#main"
          className="focus:bg-forest focus:text-cream sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:px-4 focus:py-3"
        >
          Skip to content
        </a>
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
