"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * What the chrome knows about the signed-in business, read once on the server
 * by the root layout and handed down here.
 *
 * A context rather than props, because the stage is drawn by `Screen`, which
 * every page renders on its own: threading the business name and the inbox
 * count through thirty pages would be thirty chances to forget one. The
 * values come from `/operator/v1`, which a browser is never allowed to call,
 * so nothing under this provider reads them any other way.
 *
 * Outside the provider (a unit test, the global error boundary) the chrome
 * knows nothing, which draws the mark alone, no count and no Money stop:
 * exactly what an unknown business should get.
 */
export interface ChromeIdentity {
  /** What the stage and the rail call the business; `null` when unknown. */
  businessName: string | null;
  /** OWNER, ADMIN or MANAGER: whether the Money stop is drawn. */
  canManage: boolean;
  /**
   * Conversations with a message nobody has read. Absent when the read
   * failed: unknown, never zero.
   */
  unread?: number;
}

const UNKNOWN: ChromeIdentity = { businessName: null, canManage: false };

const ChromeContext = createContext<ChromeIdentity>(UNKNOWN);

export function ChromeProvider({
  identity,
  children,
}: {
  identity: ChromeIdentity;
  children: ReactNode;
}) {
  return (
    <ChromeContext.Provider value={identity}>{children}</ChromeContext.Provider>
  );
}

export function useChrome(): ChromeIdentity {
  return useContext(ChromeContext);
}
