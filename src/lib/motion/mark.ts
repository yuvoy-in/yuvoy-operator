import { DURATION } from ".";

/** Set on a row this module had to position, and cleared with it. */
const POSITIONED = "motionMarkPositioned";

/**
 * Marks what changed: a forest tint laid over it that fades out over 1.2s
 * (the system's Mark pattern; O01, O03, O08). The portal's answer to a change
 * the operator did not make, or made somewhere they cannot see: nothing
 * moves, and the eye is told where to look.
 *
 * The tint is its own element (`.motion-mark` in globals.css), so the fade is
 * opacity on one layer and never a repaint of the row, and it is
 * `aria-hidden`: the change itself is said in words, by the screen's live
 * region. It plays the same under reduced motion (`data-motion`), because a
 * tint is colour, not motion.
 *
 * Laid over the row rather than rendered by it, so any row can be marked,
 * including the server-rendered ones on the calendar, without each learning
 * to draw one. A row marked again while it fades starts again from full.
 */
export function markChange(el: Element | null): void {
  if (!(el instanceof HTMLElement) || !el.isConnected) return;
  el.querySelector(":scope > .motion-mark")?.remove();

  /*
    The tint fills its row's box, so the row must be its containing block.
    Where it is not one, it is made one for as long as a tint is on it, and
    the flag says this module did that, so only this module undoes it.
  */
  if (getComputedStyle(el).position === "static") {
    el.style.position = "relative";
    el.dataset[POSITIONED] = "";
  }

  const tint = document.createElement("span");
  tint.className = "motion-mark";
  tint.setAttribute("aria-hidden", "true");
  tint.setAttribute("data-motion", "");
  el.appendChild(tint);

  let done = false;
  const clear = () => {
    if (done) return;
    done = true;
    tint.remove();
    if (
      !el.querySelector(":scope > .motion-mark") &&
      POSITIONED in el.dataset
    ) {
      el.style.removeProperty("position");
      delete el.dataset[POSITIONED];
    }
  };
  tint.addEventListener("animationend", clear, { once: true });
  /*
    A row that is not drawn (a desktop's copy of a phone-only list) never
    runs its animation and so never ends it: the tint goes on time anyway.
  */
  setTimeout(clear, DURATION.mark + 100);
}
