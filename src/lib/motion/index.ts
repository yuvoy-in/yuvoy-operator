import { useSyncExternalStore } from "react";

/**
 * The motion system in script (approved 4 Oct 2026; the study and its
 * decisions are in yuvoy/motion-lab, the rules in yuvoy-app's
 * docs/DESIGN_SYSTEM.md, v3.1). The portal's own copy of the traveller app's
 * module, cut to what the portal uses.
 *
 * CSS carries most motion. These are the values a Web Animations call needs,
 * which cannot read `var()`: the curves mirror the `--ease-*` tokens in
 * globals.css and `motion.test.ts` fails the moment the two disagree.
 *
 * ## The portal's rules (motion-system.md, section 14)
 *
 * Productive. 200ms is the ceiling for anything but progress, and 150ms for
 * anything done dozens of times a shift. Nothing travels: a change is marked
 * (a forest tint that fades) and said (a polite live region), never sent on
 * a journey across the screen. The one long motion is the undo window,
 * because it is the information. `palette.test.ts` holds every duration in
 * the portal to that ceiling, these included.
 *
 * `--ease-cinematic` has no copy here on purpose: it is the traveller's
 * travel curve, and the portal has no travel.
 */
export const EASE = {
  /** Arriving, answering a touch. Production's own curve. */
  interaction: "cubic-bezier(0.32, 0.72, 0, 1)",
  /** A to B with both ends on screen: a list closing a gap. */
  move: "cubic-bezier(0.2, 0, 0, 1)",
  /** Leaving: accelerates away. */
  exit: "cubic-bezier(0.3, 0, 0.8, 0.15)",
} as const;

/** Durations by job, in ms. Exits are about two thirds of entrances. */
export const DURATION = {
  /** A finger going down; a leaving card. */
  press: 100,
  /** Colour, words, a chip, a crossfade, a small exit. */
  quick: 150,
  /** A routine state change, and the portal's ceiling. */
  standard: 200,
  /** The reduced-motion stand-in for any travel: a short crossfade. */
  reducedFade: 120,
  /**
   * The mark: a forest tint on what changed, fading out on a linear curve.
   * Longer than the ceiling on purpose. It is a mark that fades, not a
   * motion (the system's Mark pattern), and it is opacity, so it is kept
   * under reduced motion too.
   */
  mark: 1200,
} as const;

/**
 * How long a waiting state holds back before it appears, so a fast answer
 * never flashes one. A delay, not a duration.
 */
export const SHOW_DELAY_MS = 300;

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether the person has asked for less motion, read at the moment of use.
 * False wherever there is no `matchMedia` (the server, jsdom): the callers
 * all fall back to the instant path's sibling, never to something that moves
 * more.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
    ? window.matchMedia(QUERY).matches
    : false;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return () => {};
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/**
 * The same preference as a render value that follows a live change in the
 * system setting. The server snapshot is `false`, so the first client render
 * matches the server's HTML.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}

/**
 * Runs a Web Animation, or nothing where the element cannot animate (jsdom,
 * an old engine): every caller treats `null` as "already finished". The one
 * place in the portal that calls `animate()`, so every script motion goes
 * through this module and its durations (`palette.test.ts` holds that).
 */
export function play(
  el: Element,
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (typeof (el as HTMLElement).animate !== "function") return null;
  return el.animate(frames, options);
}

/** Resolves when an animation ends or is cancelled; at once for `null`. */
export function finished(animation: Animation | null): Promise<void> {
  if (!animation) return Promise.resolve();
  return animation.finished.then(
    () => undefined,
    () => undefined,
  );
}

/** The opacity an element is drawn at right now, keyframes included. */
export function opacityOf(el: Element): number {
  if (typeof getComputedStyle !== "function") return 1;
  const o = Number.parseFloat(getComputedStyle(el).opacity);
  return Number.isFinite(o) ? o : 1;
}

/**
 * Cancels the script-started animations an element is running (CSS
 * transitions and keyframes are left to the stylesheet). Read where the
 * element IS before calling this: a motion that starts from that reading
 * continues from the frame the old one reached, so every motion here is
 * interruptible. `getAnimations` is missing in jsdom and older engines.
 */
export function stopAnimations(el: Element): void {
  if (typeof el.getAnimations !== "function") return;
  for (const animation of el.getAnimations()) {
    const fromCss =
      (typeof CSSTransition !== "undefined" &&
        animation instanceof CSSTransition) ||
      (typeof CSSAnimation !== "undefined" &&
        animation instanceof CSSAnimation);
    if (!fromCss) animation.cancel();
  }
}
