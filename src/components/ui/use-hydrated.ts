"use client";

import { useSyncExternalStore } from "react";

const nothing = () => () => {};

/**
 * Whether this render is the client's own rather than a replay of the
 * server's: false while hydrating, true from the first client pass on, and
 * true from the start on a screen first drawn in the browser.
 *
 * What only the phone holds (check-ins kept on it, say) is not in the
 * server's render, so a screen that reads it is corrected on the first client
 * pass, the same pass in which this turns true. A change that arrives with it
 * is the screen arriving, not anything moving, and is drawn still.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    nothing,
    () => true,
    () => false,
  );
}
