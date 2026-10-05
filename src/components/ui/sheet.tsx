"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  DURATION,
  EASE,
  finished,
  opacityOf,
  play,
  prefersReducedMotion,
  stopAnimations,
} from "@/lib/motion";
import { IconButton } from "./icon-button";
import { CloseIcon } from "./icons";
import { cn } from "@/lib/cn";

/**
 * A sheet that comes up from the bottom of the screen.
 *
 * Built here rather than on `<dialog>`: `showModal()` has to be driven from an
 * effect, which means the first paint is the page WITHOUT the sheet and the
 * second is with it. On a jetty phone that is a visible flash, and the sheet is
 * the whole answer to a tap.
 *
 * What it owes the person using it, and all three were things a plain div
 * would not do:
 *
 *   - **Escape closes it.** The one gesture everybody tries.
 *   - **The page behind does not scroll.** A sheet whose backdrop scrolls
 *     loses the operator's place in the grid they opened it from.
 *   - **Focus goes in and comes back.** Opening moves focus into the sheet, so
 *     a screen reader is reading the sheet rather than the page under it, and
 *     closing puts it back on whatever opened it.
 *
 * `aria-modal` is the claim that the rest of the page is inert. It is honest
 * here because the backdrop covers it and Escape is the way out; a full focus
 * trap is the one thing this does not do, and tabbing past the last control
 * reaches the page behind rather than wrapping.
 *
 * ## Where it lives, said by how it arrives (O08 A, approved 4 Oct 2026)
 *
 * With `motion="rise"` (the calendar's inspector) the sheet rises from the
 * edge it lives on, the foot of a phone or the right of a desktop, over a
 * backdrop that fades in (200ms), and while `leaving` it goes back the way
 * it came (150ms, accelerating away), then tells `onLeft`, so its owner can
 * let it go. The moment it starts to leave it is let go in every way that
 * matters: inert, focus back on what opened it, the page scrolling again,
 * Escape no longer its own. Under reduced motion it fades in and out in
 * 120ms. Without `motion` it appears and goes in one frame, as before.
 */
export function Sheet({
  title,
  onClose,
  children,
  className,
  layout = "bottom",
  motion,
  leaving = false,
  onLeft,
}: {
  /** Named for a screen reader, and drawn as the sheet's heading. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /**
   * `inspector` is the board's: a sheet from the bottom on a phone, and on a
   * desktop a panel down the right edge, so the week it was opened from stays
   * in view beside it (operator experiment B).
   */
  layout?: "bottom" | "inspector";
  /** `rise`: arrive from its edge and leave the way it came (see above). */
  motion?: "rise";
  /** It is going: play the way out, then call `onLeft`. */
  leaving?: boolean;
  /** Told once the way out has played. */
  onLeft?: () => void;
}) {
  const inspector = layout === "inspector";
  const headingId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLButtonElement>(null);

  // The latest callbacks, for the listeners and the exit bound once.
  const latest = useRef({ onClose, onLeft });
  useEffect(() => {
    latest.current = { onClose, onLeft };
  });

  /*
    In, and back out: focus moves into the sheet, Escape closes it, and the
    page behind holds still. All three are given back once, when the sheet
    starts to leave or when it goes, whichever comes first.
  */
  const release = useRef<() => void>(() => {});
  useEffect(() => {
    const opener = document.activeElement;
    panel.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") latest.current.onClose();
    };
    document.addEventListener("keydown", onKey);

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    let released = false;
    const free = () => {
      if (released) return;
      released = true;
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
    release.current = free;
    return free;
  }, []);

  // The way in: from the edge it lives on, before the first paint.
  useLayoutEffect(() => {
    const el = panel.current;
    const tint = backdrop.current;
    if (motion !== "rise" || !el || !tint) return;
    if (prefersReducedMotion()) {
      const fade = { duration: DURATION.reducedFade, easing: "linear" };
      play(el, [{ opacity: 0 }, { opacity: 1 }], fade);
      play(tint, [{ opacity: 0 }, { opacity: 1 }], fade);
      return;
    }
    const timing = { duration: DURATION.standard, easing: EASE.interaction };
    play(
      el,
      [{ transform: offEdge(inspector) }, { transform: "none" }],
      timing,
    );
    play(tint, [{ opacity: 0 }, { opacity: 1 }], timing);
    // Once, on arrival: a sheet that is still open never rises again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The way out: back the way it came, from wherever the way in had got to.
  useEffect(() => {
    const el = panel.current;
    const tint = backdrop.current;
    if (!leaving) return;
    release.current();
    if (!el || !tint) {
      latest.current.onLeft?.();
      return;
    }
    const reduced = prefersReducedMotion();
    const from = getComputedStyle(el).transform;
    const panelOpacity = opacityOf(el);
    const tintOpacity = opacityOf(tint);
    stopAnimations(el);
    stopAnimations(tint);
    const timing = reduced
      ? {
          duration: DURATION.reducedFade,
          easing: "linear",
          fill: "forwards" as const,
        }
      : {
          duration: DURATION.quick,
          easing: EASE.exit,
          fill: "forwards" as const,
        };
    const out = reduced
      ? play(el, [{ opacity: panelOpacity }, { opacity: 0 }], timing)
      : play(
          el,
          [
            { transform: from && from !== "none" ? from : "none" },
            { transform: offEdge(inspector) },
          ],
          timing,
        );
    play(tint, [{ opacity: tintOpacity }, { opacity: 0 }], timing);
    let live = true;
    void finished(out).then(() => {
      if (live) latest.current.onLeft?.();
    });
    return () => {
      live = false;
    };
  }, [leaving, inspector]);

  return (
    <div
      inert={leaving}
      className={cn(
        "fixed inset-0 z-50 flex items-end justify-center",
        inspector && "lg:items-stretch lg:justify-end",
      )}
    >
      {/*
        The backdrop is a button so a tap outside closes the sheet, which is
        the second gesture everybody tries. Hidden from the accessibility tree:
        Escape and the close control are the two ways out that are announced,
        and a third unnamed one in the middle of them is noise.
      */}
      <button
        ref={backdrop}
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="bg-forest/40 absolute inset-0 cursor-default"
      />
      <div
        ref={panel}
        // A change inside the sheet moves only what follows it in the sheet.
        data-motion-scope=""
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className={cn(
          "rounded-t-card border-paper-line bg-paper text-forest relative max-h-[88vh] w-full max-w-xl overflow-y-auto border p-5 pb-8 outline-none",
          inspector &&
            "lg:rounded-l-card lg:h-full lg:max-h-none lg:max-w-md lg:rounded-tr-none",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={headingId} className="font-display text-2xl">
            {title}
          </h2>
          <IconButton
            label="Close"
            variant="onPaper"
            onClick={onClose}
            className="-mt-1 shrink-0"
          >
            <CloseIcon className="size-5" />
          </IconButton>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

/**
 * Just past the edge the sheet lives on: the foot of a phone, or the right of
 * a desktop for the board's inspector (whose panel stands down that edge from
 * `lg`, 64rem, in the classes above).
 */
function offEdge(inspector: boolean): string {
  const right =
    inspector &&
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(min-width: 64rem)").matches;
  return right ? "translateX(100%)" : "translateY(100%)";
}
