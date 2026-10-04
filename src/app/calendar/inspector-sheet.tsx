"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";
import { OnlineOnly } from "@/components/ui/online-only";

/**
 * The board's inspector: everything about one departure, over the week it
 * was opened from (operator experiment B).
 *
 * The content is the server's, rendered for the departure the URL names; this
 * only frames it. A sheet from the bottom on a phone, a panel down the right
 * edge on a desktop. Closing it is a navigation to the same week and day
 * without the departure, so Back, a refresh and a pasted link all agree with
 * what is on screen, and the page does not jump to the top to do it.
 *
 * With no signal that navigation cannot be fetched, and Next would fall back
 * to the browser's "no internet" page. So offline it closes here instead and
 * puts the same address in the bar; the board re-reads it when the signal is
 * back. Everything inside that changes something is off until then
 * (`OnlineOnly`); the close button is the sheet's own and stays on.
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
  /*
    Which departure was closed here, so a different one opened in the same
    place (the sheet is reused, not remounted) is shown, not hidden.
  */
  const opened = `${title}\n${closeHref}`;
  const [closedHere, setClosedHere] = useState<string | null>(null);
  if (closedHere !== null && closedHere !== opened) setClosedHere(null);
  const close = useCallback(() => {
    if (!navigator.onLine) {
      window.history.replaceState(null, "", closeHref);
      setClosedHere(opened);
      return;
    }
    router.replace(closeHref, { scroll: false });
  }, [router, closeHref, opened]);
  if (closedHere === opened) return null;
  return (
    <Sheet title={title} onClose={close} layout="inspector">
      <OnlineOnly>{children}</OnlineOnly>
    </Sheet>
  );
}
