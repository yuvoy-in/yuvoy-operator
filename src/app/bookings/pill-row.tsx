"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { pillScrollLeft } from "@/lib/bookings/list";
import { cn } from "@/lib/cn";
import {
  DURATION,
  EASE,
  opacityOf,
  play,
  prefersReducedMotion,
  SHOW_DELAY_MS,
} from "@/lib/motion";
import { dropLifted, fadeIn, lift, type Lifted } from "@/lib/motion/flip";
import { MeasureBefore } from "@/lib/motion/measure-before";
import { scrollLeftTo } from "@/lib/motion/scroll";
import { buttonClass } from "@/components/ui/button";

/** One pill: which bookings, where they are, and how many (unknown: null). */
export interface Pill {
  key: string;
  label: string;
  href: string;
  count: number | null;
}

/**
 * Whether a pill's tap is still waiting on its answer, shared by the row and
 * the rows it chooses (`PillPanel`), so the list under a lit pill can say
 * it is on its way. The page wraps both in `PillSwap`.
 */
const Waiting = createContext<{
  waiting: boolean;
  setWaiting: (waiting: boolean) => void;
} | null>(null);

export function PillSwap({ children }: { children: ReactNode }) {
  const [waiting, setWaiting] = useState(false);
  const value = useMemo(() => ({ waiting, setWaiting }), [waiting]);
  return <Waiting value={value}>{children}</Waiting>;
}

/**
 * The four pills, in one row that scrolls sideways and never wraps
 * (yuvoy-operator#83 s4).
 *
 * A wrapped row read as two groups rather than one choice. On a phone the
 * row is wider than the sheet, so it bleeds to the sheet's edges and scrolls
 * under them, which is also what says there is more to the right. The padding
 * inside the scroller is the room a focus ring needs: an overflowing box clips
 * whatever is drawn outside it, including a ring on its first or last pill.
 *
 * ## The tap is answered at once (O05 B, approved 4 Oct 2026)
 *
 * A pill is a link and the address holds the place, so back and refresh
 * restore it. But the rows are the server's, and on one bar of signal the
 * answer can take seconds, during which a tap used to answer nothing at all.
 * Now the tapped pill fills in the frame it is tapped (`aria-current` moves
 * with it), the row scrolls smoothly to centre it (200ms, `--ease-move`;
 * any finger on the row stops that), and the rows under it wait for their
 * route: dimmed once they have kept the operator waiting 300ms, then
 * cross-faded when they come (`PillPanel`). The pill is drawn from the tap
 * until the address agrees, or until the address goes somewhere else.
 *
 * The selected pill is scrolled into view without motion when the screen
 * opens, and only the row moves: `scrollIntoView` would also scroll the
 * page, which on a screen that has just opened is a jump nobody asked for.
 */
export function PillRow({
  label,
  selected,
  pills,
}: {
  /** The navigation's accessible name. */
  label: string;
  /** Which pill the address names. */
  selected: string;
  pills: Pill[];
}) {
  const row = useRef<HTMLElement>(null);
  const swap = useContext(Waiting);
  const setWaiting = swap?.setWaiting;

  /*
    The pill tapped and not yet answered. Cleared the moment the address
    changes, to whatever it changes to: the address is the truth.
  */
  const [pending, setPending] = useState<string | null>(null);
  const [answered, setAnswered] = useState(selected);
  if (selected !== answered) {
    setAnswered(selected);
    setPending(null);
  }
  const lit = pending ?? selected;

  const stop = useRef<() => void>(() => {});
  const centre = useCallback((key: string, smooth: boolean) => {
    const el = row.current;
    const pill = Array.from(
      el?.querySelectorAll<HTMLElement>("[data-pill]") ?? [],
    ).find((p) => p.dataset.pill === key);
    if (!el || !pill) return;
    const to = pillScrollLeft(
      pill.offsetLeft,
      pill.offsetWidth,
      el.clientWidth,
      el.scrollWidth,
    );
    stop.current();
    if (smooth) {
      stop.current = scrollLeftTo(el, to);
    } else {
      el.scrollLeft = to;
      stop.current = () => {};
    }
  }, []);

  /*
    The address answered: centred without motion when the screen opens,
    smoothly after (a step back to another pill), carrying on from wherever
    the tap's own scroll has got to.
  */
  const opened = useRef(false);
  useEffect(() => {
    centre(selected, opened.current);
    opened.current = true;
    setWaiting?.(false);
  }, [selected, centre, setWaiting]);

  // A finger on the row outranks the row scrolling itself.
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const halt = () => stop.current();
    const options = { passive: true } as const;
    el.addEventListener("pointerdown", halt, options);
    el.addEventListener("wheel", halt, options);
    el.addEventListener("touchstart", halt, options);
    return () => {
      el.removeEventListener("pointerdown", halt);
      el.removeEventListener("wheel", halt);
      el.removeEventListener("touchstart", halt);
      stop.current();
    };
  }, []);

  // Back or forward while a tap is waiting: the history decides, not the tap.
  useEffect(() => {
    const onPop = () => {
      setPending(null);
      setWaiting?.(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [setWaiting]);

  function tap(event: MouseEvent<HTMLAnchorElement>, key: string) {
    // A new tab or a new window is the browser's, and changes nothing here.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    centre(key, true);
    if (key === selected) {
      // Back to the pill the address already names: nothing to wait for.
      setPending(null);
      setWaiting?.(false);
      return;
    }
    setPending(key);
    setWaiting?.(true);
  }

  return (
    <nav
      ref={row}
      aria-label={label}
      className="no-scrollbar relative -mx-6 mt-5 flex gap-2 overflow-x-auto px-6 py-1.5 sm:-mx-10 sm:px-10"
    >
      {pills.map((pill) => {
        const on = pill.key === lit;
        return (
          <Link
            key={pill.key}
            href={pill.href}
            data-pill={pill.key}
            aria-current={on ? "page" : undefined}
            onClick={(event) => tap(event, pill.key)}
            className={buttonClass({
              variant: on ? "primary" : "secondary",
              size: "md",
              block: false,
              // The fill changes in the frame it is tapped: no colour fade.
              motion: "press",
              className: cn(on && "pointer-events-none"),
            })}
          >
            {pill.label}
            {pill.count !== null ? (
              <span className="tabular-nums">{pill.count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** How far the rows under a waiting pill dim: still readable, plainly stale. */
const DIM = 0.55;

/**
 * The rows a pill chooses, changing with it (O05 B): the old rows fade out
 * (100ms, accelerating away) over the new ones fading in (150ms), instead of
 * being replaced in one frame. The old rows are a held copy taken before the
 * commit that removes them (`MeasureBefore`), so the new ones never wait.
 *
 * While a pill's tap is waiting on a slow answer, the old rows dim after
 * 300ms (150ms) and the list says it is busy, so the lit pill is never over
 * the wrong rows for long without a sign. A change of search or filter is
 * not a pill and is not cross-faded.
 *
 * Reduced motion: both fades take 120ms on a linear curve; the dim stays,
 * because it is opacity, and it carries the meaning.
 */
export function PillPanel({
  view,
  children,
}: {
  view: string;
  children: ReactNode;
}) {
  const waiting = useContext(Waiting)?.waiting ?? false;
  const box = useRef<HTMLDivElement>(null);
  const dimming = useRef<Animation | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!waiting || !el) return;
    const timer = setTimeout(() => {
      setBusy(true);
      const reduced = prefersReducedMotion();
      dimming.current = play(
        el,
        [{ opacity: opacityOf(el) }, { opacity: DIM }],
        reduced
          ? {
              duration: DURATION.reducedFade,
              easing: "linear",
              fill: "forwards",
            }
          : { duration: DURATION.quick, easing: EASE.exit, fill: "forwards" },
      );
    }, SHOW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setBusy(false);
      // Answered without a new list (the same pill again): back to full.
      const dim = dimming.current;
      dimming.current = null;
      if (!dim) return;
      const from = opacityOf(el);
      dim.cancel();
      if (from < 1) {
        play(el, [{ opacity: from }, { opacity: 1 }], {
          duration: DURATION.quick,
          easing: EASE.interaction,
        });
      }
    };
  }, [waiting]);

  return (
    <MeasureBefore<Lifted | null>
      watch={view}
      capture={() => lift(box.current)}
      apply={(lifted) => {
        const el = box.current;
        if (!el) return;
        dimming.current?.cancel();
        dimming.current = null;
        if (lifted) dropLifted(lifted, el, DURATION.press);
        fadeIn(el);
      }}
    >
      <div ref={box} aria-busy={busy || undefined}>
        {children}
      </div>
    </MeasureBefore>
  );
}
