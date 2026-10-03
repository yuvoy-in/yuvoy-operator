"use client";

import { useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";

/**
 * The board's inspector: everything about one departure, over the week it
 * was opened from (operator experiment B).
 *
 * The content is the server's, rendered for the departure the URL names; this
 * only frames it. A sheet from the bottom on a phone, a panel down the right
 * edge on a desktop. Closing it is a navigation to the same week and day
 * without the departure, so Back, a refresh and a pasted link all agree with
 * what is on screen, and the page does not jump to the top to do it.
 */
export function InspectorSheet({
  title,
  closeHref,
  children,
}: {
  title: string;
  closeHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const close = useCallback(
    () => router.replace(closeHref, { scroll: false }),
    [router, closeHref],
  );
  return (
    <Sheet title={title} onClose={close} layout="inspector">
      {children}
    </Sheet>
  );
}
