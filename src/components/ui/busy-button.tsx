"use client";

import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "@/lib/cn";
import { DURATION } from "@/lib/motion";
import { MeasureBefore } from "@/lib/motion/measure-before";
import {
  buttonClass,
  type ButtonSize,
  type ButtonVariant,
} from "./button-class";

/**
 * A Button that can be pending (O04 A, approved 4 Oct 2026): what `Button`
 * draws once it is given `pending`.
 *
 * ## Alive, not switched off
 *
 * A pending submit used to be `disabled`, so the one button the operator had
 * just pressed faded to 55%, the look of a control that is unavailable, for
 * as long as the action ran. Now:
 *
 *   - It keeps its full colour, and stays focusable, so focus is never
 *     dropped onto the page while the work runs.
 *   - It says it is busy: `aria-busy` and `aria-disabled`.
 *   - A second tap is refused here, not by the look: the click is cancelled
 *     before it can submit its form again. That covers Enter in a field too,
 *     which submits a form by clicking its button.
 *   - Its words cross-fade to the working verb and back (150ms; 120ms under
 *     reduced motion): the old words fade out where they stood, over the
 *     new ones fading in.
 *   - A 16px ring turns beside the words, but only once the answer has kept
 *     the operator waiting 300ms; a fast answer never flashes one. It keeps
 *     its room from the first frame of the wait, so the button changes width
 *     once, with its words. Under reduced motion it holds still.
 *
 * The cross-fade needs the old words' place, read before the commit that
 * swaps them (`MeasureBefore`): an inline button changes width with its
 * words, so where the new words sit says nothing about where the old ones
 * were.
 */
export function BusyButton({
  pending,
  pendingLabel,
  children,
  variant,
  size,
  block,
  className,
  type,
  onClick,
  ref,
  "aria-disabled": ariaDisabled,
  ...props
}: {
  pending: boolean;
  pendingLabel?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  ref?: Ref<HTMLButtonElement>;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  /*
    Each change of `pending` is one swap of the words, counted, so the two
    layers of a swap are fresh elements (their animations start on mount)
    and the old words are let go once their fade has played. Worked out
    while rendering, React's "storing information from previous renders".
  */
  const [was, setWas] = useState(pending);
  const [swaps, setSwaps] = useState(0);
  const [faded, setFaded] = useState(0);
  if (pending !== was) {
    setWas(pending);
    setSwaps((n) => n + 1);
  }

  const words = useRef<HTMLSpanElement>(null);
  const leaving = useRef<HTMLSpanElement>(null);

  const changes = pendingLabel !== undefined;
  const shown = pending && changes ? pendingLabel : children;
  const old = pending ? children : pendingLabel;
  const fading = changes && swaps > 0 && faded !== swaps;

  /*
    The old words are let go once their fade has played. On a timer rather
    than `animationend`, which never fires for a button that is not drawn
    (inside a closed panel), and which no test environment raises.
  */
  useEffect(() => {
    if (!fading) return;
    const timer = setTimeout(() => setFaded(swaps), DURATION.quick + 50);
    return () => clearTimeout(timer);
  }, [fading, swaps]);

  return (
    <button
      ref={ref}
      type={type}
      aria-busy={pending || undefined}
      aria-disabled={pending || ariaDisabled || undefined}
      data-pending={pending ? "" : undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={buttonClass({
        variant,
        size,
        block,
        className: cn(
          // While busy a press changes nothing, so it does not look as if it did.
          "motion-control relative aria-busy:cursor-progress aria-busy:active:scale-100",
          className,
        ),
      })}
      {...props}
    >
      <MeasureBefore
        watch={pending}
        capture={() => placeOf(words.current)}
        apply={(place) => {
          const el = leaving.current;
          if (!el || !place) return;
          el.style.left = `${place.left}px`;
          el.style.top = `${place.top}px`;
        }}
      >
        {/*
          The words, in a box that lays its contents out exactly as the
          button did (the button's own gap, inherited), so an icon beside
          the words sits where it always has.
        */}
        <span
          key={swaps}
          ref={words}
          data-motion=""
          className={cn(
            "inline-flex items-center gap-[inherit]",
            fading && "motion-in",
          )}
        >
          {shown}
        </span>
        {pending ? (
          <span
            aria-hidden="true"
            data-motion=""
            className="motion-busy-ring"
          />
        ) : null}
        {fading ? (
          <span
            key={`was-${swaps}`}
            aria-hidden="true"
            data-motion=""
            className="motion-out pointer-events-none absolute inset-0 gap-[inherit] overflow-hidden rounded-full"
          >
            <span
              ref={leaving}
              className="absolute inline-flex items-center gap-[inherit] whitespace-nowrap"
            >
              {old}
            </span>
          </span>
        ) : null}
      </MeasureBefore>
    </button>
  );
}

/** Where the words sit inside their button, before a swap moves them. */
function placeOf(el: HTMLElement | null): { left: number; top: number } | null {
  return el ? { left: el.offsetLeft, top: el.offsetTop } : null;
}
