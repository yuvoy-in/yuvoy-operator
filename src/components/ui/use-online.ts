"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Whether the phone says it has a connection.
 *
 * A hint, never a promise: a phone on a captive jetty wifi reports online and
 * reaches nothing, so every write still says what happened when the network
 * failed it. What this is good for is saying "no signal" BEFORE a tap, on the
 * screens built for one bar (boarding mode, online first: owner ruling,
 * 3 Oct 2026). The server render assumes a connection: it just made one.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * How long a change of signal has to hold before a screen SAYS it changed:
 * 2s, against a jetty connection that drops and returns several times a
 * minute.
 */
export const SETTLE_MS = 2_000;

/**
 * Whether to say there is a connection: `useOnline`, once it has held for
 * `SETTLE_MS` either way. For what a screen says, never for what it lets
 * through.
 *
 * The no-signal strips (`ReadOnlyWhenOffline`, `KeptOnThisPhone`) are in the
 * flow of the page, so each drop pushed the list down by a panel and each
 * return pulled it back: on a flapping connection the rows an operator was
 * tapping jumped under the thumb (the stability audit, P3-1). A blip that
 * comes back inside the window now changes nothing on the glass. Writes
 * still follow the phone's own answer at once (`OnlineOnly`, the check-in
 * and cash buttons), because a write sent into no signal is the thing that
 * must not happen, and a link is still held at once.
 *
 * It starts from what `useOnline` says when the screen is first drawn:
 * connected while hydrating, as the server rendered it, so a page loaded with
 * no signal says so once the window has passed; and the phone's own answer
 * on a screen drawn later, which is not a change and is said at once.
 */
export function useSettledOnline(): boolean {
  const online = useOnline();
  const [said, setSaid] = useState(online);
  useEffect(() => {
    if (online === said) return;
    const timer = setTimeout(() => setSaid(online), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [online, said]);
  return said;
}
