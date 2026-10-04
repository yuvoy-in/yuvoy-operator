import { DURATION, EASE, play, prefersReducedMotion, stopAnimations } from ".";

/**
 * A figure changing to a new value, in the two ways the portal draws it. Each
 * takes the figure arriving and the one leaving, drawn over it in the same
 * place (callers draw the leaving one from an attribute, so the old number is
 * never text). Either may be missing; what is there still plays.
 *
 * `rollFigure` is the operator's own change, said with direction: a
 * headcount as a party boards (O07 A), the Bookings count as a request is
 * answered (O02 A). `crossFadeFigure` is a change the operator did not make,
 * seen without anything moving (O01 A). Under reduced motion both are a
 * 120ms cross-fade on a linear curve.
 */

/**
 * How long the old figure takes to roll away: seven tenths of the 200ms the
 * new one takes to arrive, which is 140ms. The lab's shared roll
 * (yuvoy/motion-lab, kit/motion.js, `duration * 0.7`) leaves in that, for
 * O07 as for the traveller's T14, and the traveller's `RollingNumber` writes
 * the same derivation, so the two products roll alike.
 */
export const ROLL_OUT_MS = Math.round(DURATION.standard * 0.7);

/**
 * The new figure comes up from below when the value rises and down from
 * above when it falls, six tenths of its height, 200ms on the interaction
 * curve; the old one leaves the other way in `ROLL_OUT_MS`, accelerating
 * away.
 */
export function rollFigure(
  arriving: HTMLElement | null,
  leaving: HTMLElement | null,
  up: boolean,
): void {
  if (prefersReducedMotion()) {
    reducedCrossFade(arriving, leaving);
    return;
  }
  // Six tenths of the figure's height: far enough to read as a roll.
  const height = arriving?.offsetHeight || leaving?.offsetHeight || 0;
  const travel = height * 0.6 * (up ? 1 : -1);
  if (arriving) {
    stopAnimations(arriving);
    play(
      arriving,
      [
        { opacity: 0, transform: `translateY(${travel}px)` },
        { opacity: 1, transform: "none" },
      ],
      {
        duration: DURATION.standard,
        easing: EASE.interaction,
        fill: "backwards",
      },
    );
  }
  if (leaving) {
    play(
      leaving,
      [
        { opacity: 1, transform: "none" },
        { opacity: 0, transform: `translateY(${-travel}px)` },
      ],
      { duration: ROLL_OUT_MS, easing: EASE.exit, fill: "forwards" },
    );
  }
}

/**
 * The old figure fades out where it stood as the new one fades in, 150ms
 * each, the new one on the interaction curve and the old one accelerating
 * away.
 */
export function crossFadeFigure(
  arriving: HTMLElement | null,
  leaving: HTMLElement | null,
): void {
  if (prefersReducedMotion()) {
    reducedCrossFade(arriving, leaving);
    return;
  }
  if (arriving) {
    stopAnimations(arriving);
    play(arriving, [{ opacity: 0 }, { opacity: 1 }], {
      duration: DURATION.quick,
      easing: EASE.interaction,
      fill: "backwards",
    });
  }
  if (leaving) {
    play(leaving, [{ opacity: 1 }, { opacity: 0 }], {
      duration: DURATION.quick,
      easing: EASE.exit,
      fill: "forwards",
    });
  }
}

function reducedCrossFade(
  arriving: HTMLElement | null,
  leaving: HTMLElement | null,
): void {
  const fade = { duration: DURATION.reducedFade, easing: "linear" };
  if (arriving) {
    stopAnimations(arriving);
    play(arriving, [{ opacity: 0 }, { opacity: 1 }], {
      ...fade,
      fill: "backwards",
    });
  }
  if (leaving) {
    play(leaving, [{ opacity: 1 }, { opacity: 0 }], {
      ...fade,
      fill: "forwards",
    });
  }
}
