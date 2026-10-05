"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { stopAnimations } from "@/lib/motion";
import { dropLifted, fadeIn, lift, type Lifted } from "@/lib/motion/flip";
import { MeasureBefore } from "@/lib/motion/measure-before";

type Kind = "none" | "text" | "confirm" | "receipt";

/**
 * Which look a named confirm's control is drawing:
 *
 *   `text`     the quiet words that open it ("Cancel this booking")
 *   `confirm`  the named question, over the one loud button
 *   `receipt`  what the act left ("This booking is cancelled")
 *   `none`     nothing at all
 *
 * Anything after a colon tells two looks of one kind apart, so a change
 * between them is still a change: "receipt:paused" to "receipt:resumed".
 */
export type ConfirmLook = Kind | `${Kind}:${string}`;

const kindOf = (look: ConfirmLook): Kind => look.split(":")[0] as Kind;

/**
 * A named confirm that arrives still and leaves the same way (O06 B, "Still",
 * approved 4 Oct 2026; yuvoy/motion-lab, experiments/o06-named-confirm.js).
 *
 * Every act here that ends something opens a confirm in place of the quiet
 * words that asked for it (yuvoy-operator#81), and every one of them cut: the
 * page grew by the confirm in one frame, Keep it took it away in one, and the
 * receipt replaced it in one. A confirm for something that cannot be undone
 * should not arrive with a flourish either, so nothing moves:
 *
 *   - each new look fades in where the last one stood, 150ms on the
 *     interaction curve: the confirm where the words were, the words again
 *     after Keep it, the receipt once the act has gone through;
 *   - a confirm put away without acting (Keep it, an edit that makes its
 *     question moot, a screen that takes it away) leaves as a held copy,
 *     lifted before the commit and fading out over the layout that has
 *     already changed, 150ms, accelerating away. The real change never waits
 *     for its exit, and the copy is a picture only: inert, `aria-hidden`, out
 *     of the tab order, with no ids and no names (`lift`);
 *   - a confirm that ends in its receipt does not cross-fade with it: the
 *     receipt fades in, and that is all;
 *   - nothing scrolls the confirm into view: moving the loud button under the
 *     thumb that just tapped is how a double tap ends something.
 *
 * The first paint fades nothing, unless `enter`: a control remounted in
 * answer to a tap ("Close more dates"). Under reduced motion every fade takes
 * 120ms on a linear curve; it is opacity, which reduced motion keeps.
 *
 * Focus is `useConfirmFocus`'s, and unchanged: these fades are set before the
 * paint, and its focus moves after it.
 *
 * Use: `root` on the root element of whichever look is drawn, and `frame`
 * around every return, so the confirm can be read before the commit that
 * takes it away. A screen that only ever fades a receipt in needs no `frame`.
 */
export function useStillConfirm(
  look: ConfirmLook,
  { enter = false }: { enter?: boolean } = {},
): {
  root: (element: HTMLElement | null) => void;
  frame: (body: ReactNode) => ReactNode;
} {
  /** The root of the look drawn now. */
  const drawn = useRef<HTMLElement | null>(null);
  /** The look the screen shows: the one last committed. */
  const shown = useRef<ConfirmLook | null>(enter ? null : look);
  /** Takes away a held copy that is still fading. */
  const held = useRef<(() => void) | null>(null);

  const root = useCallback((element: HTMLElement | null) => {
    drawn.current = element;
  }, []);

  // After the commit, before the paint: the new look never shows a frame at
  // full strength first.
  useLayoutEffect(() => {
    if (shown.current === look) return;
    shown.current = look;
    const element = drawn.current;
    if (!element) return;
    stopAnimations(element);
    fadeIn(element);
  }, [look]);

  // A copy still fading leaves with the control.
  useEffect(() => () => held.current?.(), []);

  const frame = (body: ReactNode) => (
    <MeasureBefore<Lifted | null>
      watch={look}
      capture={() => {
        // Read before the commit: `shown` is still the look on screen.
        const was = shown.current;
        const putAway =
          was !== null &&
          kindOf(was) === "confirm" &&
          kindOf(look) !== "receipt";
        return putAway ? lift(drawn.current) : null;
      }}
      apply={(lifted) => {
        // A change before the last copy has faded takes that copy away.
        held.current?.();
        held.current = lifted ? dropLifted(lifted) : null;
      }}
    >
      {body}
    </MeasureBefore>
  );

  return { root, frame };
}
