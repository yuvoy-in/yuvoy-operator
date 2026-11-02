"use client";

import { useEffect } from "react";
import { holdCheckInLink } from "@/lib/day/check-in-link";

/**
 * Keeps a check-in link's code through sign-in (yuvoy-operator#175).
 *
 * Signed out, `/check-in#<reference>.<code>` is sent here, and the browser
 * brings the fragment along. Signing in sends the operator back with a
 * navigation that does not, so the fragment is held in this tab for
 * `/check-in` to take, once. Anything that is not a check-in link is not kept.
 */
export function HoldCheckInLink() {
  useEffect(() => {
    holdCheckInLink(window.location.hash);
  }, []);
  return null;
}
