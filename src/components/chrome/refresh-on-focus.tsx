"use client";

import { useEffect } from "react";
import {
  INTERVAL_MS,
  onStarted,
  useScheduledRefresh,
} from "./refresh-schedule";

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
 *
 * **Once per return.** A tab coming back fires `focus` and
 * `visibilitychange` together, and each used to re-read the whole screen
 * while a tap waited behind both. Every trigger goes through the one
 * schedule (`refresh-schedule.ts`): none while a re-read is on its way or
 * within a few seconds of the last, and the minute counts from the last
 * re-read from anywhere, the replayer's included.
 *
 * **Never with no signal.** A refresh that cannot reach the server makes Next
 * fall back to a full browser navigation, and with no network that is the
 * browser's own "no internet" page in place of the screen the operator was
 * reading. So it waits while the phone says it is offline, and re-reads once
 * the moment the signal comes back.
 */
export function RefreshOnFocus() {
  const refresh = useScheduledRefresh();

  useEffect(() => {
    const trigger = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        refresh();
      }
    };

    /*
      The minute, armed again from every re-read that starts, so a re-read on
      focus is not followed by the minute's own a second later.
    */
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        trigger();
        // Nothing re-read (hidden, offline, one on its way): wait a minute more.
        arm();
      }, INTERVAL_MS);
    };
    const stop = onStarted(arm);
    arm();

    window.addEventListener("focus", trigger);
    window.addEventListener("online", trigger);
    document.addEventListener("visibilitychange", trigger);

    return () => {
      window.removeEventListener("focus", trigger);
      window.removeEventListener("online", trigger);
      document.removeEventListener("visibilitychange", trigger);
      stop();
      clearTimeout(timer);
    };
  }, [refresh]);

  return null;
}
