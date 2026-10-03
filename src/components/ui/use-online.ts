"use client";

import { useSyncExternalStore } from "react";

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
