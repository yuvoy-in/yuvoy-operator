"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useOnline } from "./use-online";

/**
 * Controls that change something, switched off while the phone has no signal.
 *
 * A `<fieldset disabled>`, so every button, field and choice inside it is off
 * by construction, including ones added later that never heard of this. Links
 * are not form controls and stay as they are; the screen around this decides
 * what a link does offline (see `ReadOnlyWhenOffline`).
 *
 * `role="none"` because this is not a group anybody needs announced: it is a
 * switch on the controls inside, and the screen says why they are off.
 */
export function OnlineOnly({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const online = useOnline();
  return (
    <fieldset
      disabled={!online}
      role="none"
      className={cn("m-0 min-w-0 border-0 p-0", className)}
    >
      {children}
    </fieldset>
  );
}
