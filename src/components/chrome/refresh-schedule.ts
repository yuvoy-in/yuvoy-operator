"use client";

import { useCallback, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * One schedule for re-reading the screen, shared by everything that does it
 * on its own: `RefreshOnFocus`, and the replayer that sends what was kept on
 * the phone with no signal.
 *
 * ## Why one
 *
 * Coming back to the app fired two full re-reads, found by the stability
 * audit before release: a tab coming back fires `focus` and
 * `visibilitychange` together, and each `router.refresh()` re-renders the
 * root layout (the session check, the chrome's counts) and the page. Next
 * runs refreshes and Server Actions strictly in turn, so a tap made just
 * then waited behind both. The minute's re-read was not moved by either, so
 * it could follow a second later, and on the signal coming back the
 * replayer re-read again after sending.
 *
 * So a trigger re-reads only when none is on its way and none started in the
 * last few seconds, and every re-read, from anywhere here, moves the next
 * minute's along. A timestamp and a count, not a delay: nothing waits, a
 * trigger that is not due is simply dropped.
 */

/** A trigger this soon after the last re-read is the same moment. */
export const QUIET_MS = 5_000;

/** The slow re-read while somebody is looking, counted from the last one. */
export const INTERVAL_MS = 60_000;

let last = Number.NEGATIVE_INFINITY;
let inFlight = 0;
const listeners = new Set<() => void>();

/** Whether a trigger (focus, the tab shown, the signal back, the minute) re-reads now. */
export function due(now: number): boolean {
  return inFlight === 0 && now - last >= QUIET_MS;
}

/** A re-read has started: the quiet window and the next minute run from now. */
export function started(now: number): void {
  last = now;
  for (const listener of listeners) listener();
}

/** Told whenever a re-read starts, so a slow timer can count again from it. */
export function onStarted(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Held while a re-read is on its way. Counted, because the replayer and a
 * screen's own schedule can each hold one.
 */
export function hold(): () => void {
  inFlight += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight -= 1;
  };
}

/** A fresh schedule, for a test. */
export function resetSchedule(): void {
  last = Number.NEGATIVE_INFINITY;
  inFlight = 0;
  listeners.clear();
}

/**
 * `router.refresh()`, through the schedule.
 *
 * Run in a transition so its pending state says when the re-read has landed:
 * Next commits a refresh as a transition, and the transition it starts here
 * is not done until the new tree is in. The schedule is held for exactly
 * that long.
 *
 * `force` is for a re-read that has to happen whatever came before it: the
 * replayer's, after it has sent what was kept, since a re-read already on
 * its way was asked before those landed. It still counts as one.
 */
export function useScheduledRefresh(): (force?: boolean) => void {
  const router = useRouter();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!pending) return;
    return hold();
  }, [pending]);

  return useCallback(
    (force = false) => {
      const now = Date.now();
      if (!force && !due(now)) return;
      started(now);
      start(() => router.refresh());
    },
    [router],
  );
}
