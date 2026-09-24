"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Focus for a confirm that opens in place of the control that asked for it
 * (the audit before release, O1).
 *
 * Every act here that ends something is quiet text that opens its own confirm
 * (yuvoy-operator#81), and each takes itself away when it does, so a keyboard
 * or screen-reader user's focus fell to the page: nothing read the question
 * out, and the next Tab started again from the top of the screen. The same
 * happened on the way out, when "Keep it" took itself away.
 *
 * So, with the two refs this returns (callback refs, so they fit a `<p>`, an
 * `<h2>` or a `Button` alike):
 *
 *   - on opening, focus moves to the confirm's QUESTION, rendered with
 *     `tabIndex={-1}`, so a screen reader reads what is being asked and the
 *     next Tab reaches the confirm's first control;
 *   - on closing without acting, focus goes back to whatever opened it: a
 *     control that stayed on screen (a Manage row's act, which opens the
 *     confirm already asked), or else the quiet `trigger`, drawn again in its
 *     place. That holds when the screen that opened the confirm closes it by
 *     taking it away altogether.
 *
 * It only ever puts back focus that was LOST, sitting on the page body. A
 * confirm closed because somebody chose something else never takes focus
 * away from what they chose, and one that ends in its receipt leaves focus
 * alone.
 */
export function useConfirmFocus(open: boolean): {
  trigger: (element: HTMLElement | null) => void;
  question: (element: HTMLElement | null) => void;
} {
  const trigger = useRef<HTMLElement | null>(null);
  const question = useRef<HTMLElement | null>(null);
  /** What had focus when the confirm opened, if it was still on screen. */
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      const active = document.activeElement;
      opener.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      question.current?.focus();
    } else if (!open && wasOpen.current) {
      restore(opener.current, trigger.current);
    }
    wasOpen.current = open;
  }, [open]);

  // Taken away while open, by a screen that closes it from outside.
  useEffect(
    () => () => {
      if (wasOpen.current) restore(opener.current, null);
    },
    [],
  );

  const triggerRef = useCallback((element: HTMLElement | null) => {
    trigger.current = element;
  }, []);
  const questionRef = useCallback((element: HTMLElement | null) => {
    question.current = element;
  }, []);
  return { trigger: triggerRef, question: questionRef };
}

function restore(opener: HTMLElement | null, trigger: HTMLElement | null) {
  const active = document.activeElement;
  const lost = !active || active === document.body;
  if (!lost) return;
  (opener?.isConnected ? opener : trigger)?.focus();
}
