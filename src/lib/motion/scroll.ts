import { DURATION, EASE, prefersReducedMotion } from ".";

/**
 * A row that scrolls itself somewhere, smoothly (O05 B): the Bookings pills
 * centring the one just tapped.
 *
 * Not `scrollTo({ behavior: "smooth" })`, whose speed is the browser's and is
 * often half a second: the portal's ceiling is 200ms, and the A-to-B curve
 * (`--ease-move`) is the system's, so the scroll is played here, one frame
 * at a time, on that curve. A scroll position is the one thing CSS cannot
 * ease, which is why this is script.
 *
 * Reduced motion: it lands in one frame. Anything a finger does to the row
 * stops it where it is (`cancel`), because a person scrolling outranks the
 * screen scrolling.
 */

/**
 * `cubic-bezier(x1, y1, x2, y2)` as a function of progress, solved for x by
 * bisection: exact to well under a pixel on a 200ms scroll, and dependent on
 * nothing.
 */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const at = (a: number, b: number, t: number) =>
    ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 30; i += 1) {
      const e = at(x1, x2, t) - x;
      if (Math.abs(e) < 1e-6) break;
      if (e < 0) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return at(y1, y2, t);
  };
}

/**
 * `--ease-move`, the A-to-B curve, as a function: read from `EASE.move`
 * (which motion.test.ts holds to the stylesheet's token), so the scroll can
 * never drift from the curve CSS uses.
 */
export const easeMove = (() => {
  const [x1, y1, x2, y2] = (EASE.move.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  return cubicBezier(x1, y1, x2, y2);
})();

/**
 * Scrolls `el` sideways to `left` over 200ms on `--ease-move`, from wherever
 * it is now; in one frame under reduced motion or where there is no frame to
 * wait for. Returns the way to stop it.
 */
export function scrollLeftTo(el: HTMLElement, left: number): () => void {
  const from = el.scrollLeft;
  if (
    prefersReducedMotion() ||
    typeof requestAnimationFrame !== "function" ||
    Math.abs(left - from) < 1
  ) {
    el.scrollLeft = left;
    return () => {};
  }
  let frame = 0;
  let start: number | null = null;
  const step = (now: number) => {
    if (start === null) start = now;
    const k = Math.min(1, (now - start) / DURATION.standard);
    el.scrollLeft = from + (left - from) * easeMove(k);
    if (k < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
