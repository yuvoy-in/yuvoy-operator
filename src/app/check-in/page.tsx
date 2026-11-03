import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { Screen } from "@/components/chrome/screen";
import { CheckInScreen } from "./check-in-screen";

export const metadata: Metadata = { title: "Check in" };

/*
  Never cached and never prerendered: it is behind the session, and what it
  does depends on a fragment only the browser can read.
*/
export const dynamic = "force-dynamic";

/**
 * Where the traveller's QR opens (yuvoy-operator#175, yuvoy-app#218).
 *
 * The link is `/check-in#<reference>.<code>`. The server never sees the part
 * after `#`, so this page draws the frame and the client screen reads the
 * fragment, checks the party in once, and says what happened.
 */
export default async function CheckInPage() {
  await requireOperator();
  return (
    <Screen nav={{ back: { href: "/today", label: "Today" } }} width="sm">
      <h1 className="font-display tracking-display leading-display text-4xl text-balance">
        Check in
      </h1>
      <CheckInScreen />
    </Screen>
  );
}
