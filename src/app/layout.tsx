import type { Metadata, Viewport } from "next";
import { fraunces, satoshi } from "@/lib/fonts";
import { AppShell } from "@/components/chrome/app-shell";
import { chromeData } from "@/lib/site/nav-badges";
import { SuspensionBanner } from "@/components/account/suspension-banner";
import { THEME_COLOR } from "@/lib/site/theme";
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
  themeColor: THEME_COLOR,
  width: "device-width",
  initialScale: 1,
  /*
    `viewport-fit: cover` is deliberately NOT set — a standing rule from the
    marketing site's header work, carried across both apps.
  */
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  /*
    The bar's two counts — yuvoy-operator#42. Read here because the chrome is
    a client component and the counts come from `/operator/v1`, which a
    browser is never allowed to call. `navBadges` cannot throw: a signed-out
    door, a dead session or a dropped connection costs a badge, never a page.
  */
  const { badges, suspension } = await chromeData();

  return (
    <html lang="en" className={`${fraunces.variable} ${satoshi.variable}`}>
      <body className="bg-forest text-cream">
        <a
          href="#main"
          className="label bg-cream text-forest sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-3"
        >
          Skip to content
        </a>
        <AppShell
          badges={badges}
          banner={<SuspensionBanner suspension={suspension} />}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
