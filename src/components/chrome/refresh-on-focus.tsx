"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the manifest when the operator comes back to it, and slowly while
 * they are looking at it.
 *
 * The page is server-rendered with no client data layer, so "stale" here means
 * somebody booked at 08:40 and the screen still says 08:30's list. Two
 * triggers, both cheap:
 *
 *   - **Focus.** The dominant case by far. The phone was in a pocket; the
 *     answer that matters is the one at the moment they look.
 *   - **A slow interval**, 60s, and only while the tab is visible. This is one
 *     bar of signal on an island: a 5-second poll is a battery and a data plan
 *     spent to be 55 seconds fresher than nobody needed.
 *
 * `router.refresh()` re-runs the server render and reconciles — it does not
 * remount, so a half-typed state or a pending action is not thrown away.
 */
const INTERVAL_MS = 60_000;

export function RefreshOnFocus() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, INTERVAL_MS);

    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, [router]);

  return null;
}
