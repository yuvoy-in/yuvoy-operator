"use client";

import { useEffect } from "react";
import { holdCheckInLink } from "@/lib/day/check-in-link";

/**
 * Keeps a check-in link's code through sign-in (yuvoy-operator#175).
 *
 * Signed out, `/check-in#<reference>.<code>` is sent here, and the browser
 * brings the fragment along. Signing in sends the operator back with a
 * navigation that does not, so the fragment is held in this tab for
 * `/check-in` to take, once, and taken out of the address bar. Anything that
 * is not a check-in link is not kept and not touched.
 */
export function HoldCheckInLink() {
  useEffect(() => {
    if (!holdCheckInLink(window.location.hash)) return;
    // Held, so the code leaves this page's address bar and history entry.
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + window.location.search,
    );
  }, []);
  return null;
}
