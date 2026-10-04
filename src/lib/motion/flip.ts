import {
  DURATION,
  EASE,
  opacityOf,
  play,
  prefersReducedMotion,
  stopAnimations,
} from ".";

/**
 * Showing where things went, without laying anything out per frame (FLIP):
 * measure where they were, let the change land in one layout, then play each
 * one back from where it was to where it is, as a transform. And a held copy
 * of what left, drawn where it stood while it fades, so the real change never
 * waits for its exit.
 *
 * Both readings of "where it was" come from `MeasureBefore`, which takes them
 * while the old layout is still on screen.
 *
 * Reduced motion: nothing slides; the copies still fade, in 120ms.
 */

/** At most this many things move at once (the system's budget per screen). */
export const MAX_SLIDES = 8;

/**
 * The boundary a change's motion stays inside: the sheet or screen it
 * happened on (`data-motion-scope`), so a row closing up inside a sheet
 * never moves the page behind it.
 */
export function scopeOf(el: Element): Element {
  return el.closest("[data-motion-scope]") ?? document.body;
}

/**
 * What a change at `el` pushes or pulls: everything after it, level by
 * level, up to its scope. Whether each one really moves is measured, not
 * assumed: a fixed foot, a sticky column or the other side of a two-column
 * layout measures the same before and after, and is left alone.
 */
export function followersOf(
  el: Element,
  scope: Element = scopeOf(el),
): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (
    let node: Element | null = el;
    node && node !== scope && node !== document.body;
    node = node.parentElement
  ) {
    for (let next = node.nextElementSibling; next;) {
      if (next instanceof HTMLElement) out.push(next);
      next = next.nextElementSibling;
    }
  }
  return out;
}

export type Tops = Map<HTMLElement, number>;

/** Where each element is drawn now, transforms included, by its top edge. */
export function topsOf(els: Iterable<HTMLElement>): Tops {
  const tops: Tops = new Map();
  for (const el of els) {
    if (!el.isConnected || el.getClientRects().length === 0) continue;
    tops.set(el, el.getBoundingClientRect().top);
  }
  return tops;
}

/**
 * Plays each element from where it was (`before`) to where it is now: 200ms
 * on `--ease-move`, the A-to-B curve. Nearest first and at most
 * `MAX_SLIDES`; one that is out of sight both before and after does not
 * move, because nobody would see it. A slide still running is caught where
 * it is drawn (the reading includes it), so a second change mid-slide
 * carries on from there rather than jumping.
 */
export function slideFrom(before: Tops): void {
  if (prefersReducedMotion() || typeof window === "undefined") return;
  const viewport = window.innerHeight || 0;
  let moving = 0;
  for (const [el, top] of before) {
    if (moving >= MAX_SLIDES) break;
    if (!el.isConnected) continue;
    stopAnimations(el);
    // Something else owns its transform (a swipe, a centring): leave it be.
    const owned = getComputedStyle(el).transform;
    if (owned && owned !== "none") continue;
    const now = el.getBoundingClientRect();
    const dy = top - now.top;
    if (Math.abs(dy) < 0.5) continue;
    const seen = (y: number) => y < viewport && y + now.height > 0;
    if (!seen(top) && !seen(now.top)) continue;
    play(el, [{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
      duration: DURATION.standard,
      easing: EASE.move,
    });
    moving += 1;
  }
}

/** A copy of something about to leave, and where it stood. */
export interface Lifted {
  copy: HTMLElement;
  rect: DOMRect;
  opacity: number;
}

/**
 * Takes a copy of what is about to leave, drawn exactly as it is: the boxes
 * ticked and the words typed come with it (an input's cloning copies its
 * value). Call it before the commit (`MeasureBefore`).
 *
 * The copy is a picture, nothing more: `inert` and `aria-hidden`, with no
 * ids (no second element answers to a label) and no names (nothing in it is
 * ever submitted with a form it happens to land in).
 */
export function lift(el: Element | null): Lifted | null {
  if (!(el instanceof HTMLElement) || !el.isConnected) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  const copy = el.cloneNode(true) as HTMLElement;
  for (const node of [copy, ...copy.querySelectorAll("[id]")]) {
    node.removeAttribute("id");
  }
  for (const node of copy.querySelectorAll("[name]")) {
    node.removeAttribute("name");
  }
  copy.setAttribute("aria-hidden", "true");
  copy.setAttribute("data-motion", "");
  copy.inert = true;
  return { copy, rect, opacity: opacityOf(el) };
}

/** The nearest ancestor of `anchor` that scrolls, or none: the page. */
function scrollerOf(anchor: Element): HTMLElement | null {
  for (
    let node = anchor.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/**
 * Draws a lifted copy where it stood on screen, over the layout that has
 * already changed, and fades it out: 150ms, accelerating away (`exit`), from
 * the opacity it had; 120ms on a linear curve under reduced motion. Gone
 * from the page once it has faded, whatever happens.
 *
 * It is drawn in a fixed layer the size of what it was seen through: the
 * scroller `anchor` sits in (a sheet's panel, which it is clipped to, and
 * drawn above), or the window. Fixed, so it never makes the page or the
 * sheet longer than it now is: a confirm that leaves a shorter page lets the
 * scroll settle at once, as it always has, with the copy fading where it was
 * seen. Below the floating bar on a page, above everything in a sheet.
 */
export function dropLifted(
  lifted: Lifted,
  anchor: Element,
  duration: number = DURATION.quick,
): void {
  const { copy, rect, opacity } = lifted;
  const scroller = scrollerOf(anchor);
  const seen = scroller
    ? scroller.getBoundingClientRect()
    : { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("data-motion", "");
  layer.inert = true;
  Object.assign(layer.style, {
    position: "fixed",
    top: `${seen.top}px`,
    left: `${seen.left}px`,
    width: `${seen.width}px`,
    height: `${seen.height}px`,
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: scroller ? "60" : "20",
  });
  Object.assign(copy.style, {
    position: "absolute",
    top: `${rect.top - seen.top}px`,
    left: `${rect.left - seen.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    overflow: "hidden",
    animation: "none",
    transform: "none",
  });
  layer.appendChild(copy);
  document.body.appendChild(layer);

  const reduced = prefersReducedMotion();
  const fade = play(copy, [{ opacity }, { opacity: 0 }], {
    duration: reduced ? DURATION.reducedFade : duration,
    easing: reduced ? "linear" : EASE.exit,
    fill: "forwards",
  });
  const gone = () => layer.remove();
  if (!fade) {
    gone();
    return;
  }
  fade.finished.then(gone, gone);
}

/**
 * Fades an element in where it already stands: 150ms on the interaction
 * curve, after `delay`; 120ms on a linear curve and at once under reduced
 * motion. Fills backwards only, so once it has played the element is drawn
 * by its own styles again.
 */
export function fadeIn(el: Element, delay = 0): Animation | null {
  const reduced = prefersReducedMotion();
  return play(
    el,
    [{ opacity: 0 }, { opacity: 1 }],
    reduced
      ? { duration: DURATION.reducedFade, easing: "linear", fill: "backwards" }
      : {
          duration: DURATION.quick,
          delay,
          easing: EASE.interaction,
          fill: "backwards",
        },
  );
}
