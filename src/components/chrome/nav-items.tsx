"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { cn } from "@/lib/cn";
import { DURATION, stopAnimations } from "@/lib/motion";
import { crossFadeFigure, rollFigure } from "@/lib/motion/figure";
import { fadeOut } from "@/lib/motion/flip";
import { takeAnswersSent } from "@/components/requests/answered";
import {
  BADGES,
  badgeText,
  navFor,
  type NavBadges,
  type NavIcon,
} from "@/lib/site/nav";
import {
  BriefcaseIcon,
  CalendarIcon,
  ClockIcon,
  RupeeIcon,
  TicketIcon,
} from "@/components/ui/icons";

const ICONS: Record<NavIcon, ComponentType<{ className?: string }>> = {
  /*
    The glyphs moved with the labels (yuvoy-operator#32). Home is the hours of
    one day, so it keeps the clock; Bookings is a list of tickets; Calendar is a
    month, so it takes the calendar.

    Money is the rupee sign (yuvoy-operator#96): the currency of every figure
    behind the stop, and an open glyph among four closed shapes, so it is told
    apart at a glance rather than read.
  */
  home: ClockIcon,
  bookings: TicketIcon,
  calendar: CalendarIcon,
  money: RupeeIcon,
  business: BriefcaseIcon,
};

/**
 * The floating tab bar (phone) and the rail (desktop) render the same
 * registry in two orientations, filtered to what this login is shown
 * (`navFor`): a staff phone has no Money stop.
 *
 * ## Every stop labelled, always (yuvoy-operator#80 t6)
 *
 * The bar used to open only the current stop into a named pill and leave the
 * rest as bare glyphs, so the one label on screen was the one place nobody
 * needed it. Every stop now carries its word under its glyph. Five of them
 * share the pill's width equally: a word gets (width - 60px) / 5 - 4px, which
 * on a 360px phone is 56px and holds "Bookings" (48.8px in the 12px nav
 * voice, measured) with room either side, and each stop is still a 48px-tall
 * target. Below 21rem (336px) the bar steps down to 11px (44.7px) rather than
 * cut the word. No stop scrolls out of reach at any common width.
 *
 * ## The two counts (yuvoy-operator#42)
 *
 * On the bar the count rides the glyph's corner, so it adds no width; on the
 * rail it sits at the end of the row. The bubble itself is `aria-hidden` and
 * the number is said in words as the link's name instead ("Bookings, 3
 * waiting on your answer"), so a screen reader hears what the number is OF
 * rather than a bare digit after a label. Paper on forest and forest on
 * paper: 13.11:1 either way.
 */
export function NavList({
  orientation,
  badges,
  canManage = false,
}: {
  orientation: "bar" | "rail";
  /** Counts for the stops that carry one. Absent means unknown: draw nothing. */
  badges?: NavBadges;
  /** OWNER, ADMIN or MANAGER. Unknown draws no Money stop. */
  canManage?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const bar = orientation === "bar";

  return (
    <ul className={cn("flex", bar ? "items-stretch gap-1" : "flex-col gap-1")}>
      {navFor({ canManage }).map((item) => {
        const active = item.match(pathname);
        const Icon = ICONS[item.icon];
        const badge = BADGES[item.icon];
        const raw = badge ? badges?.[badge.key] : undefined;
        // Zero draws nothing, exactly like unknown: an empty queue is not news.
        const count = typeof raw === "number" && raw > 0 ? raw : null;

        return (
          <li key={item.href} className={bar ? "min-w-0 flex-1" : undefined}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              /*
                The count is said through the link's NAME, not a screen-reader
                span beside the label. Chromium pads an out-of-flow child with
                a space when it computes a name, so the span version announced
                "Bookings , 3 waiting on your answer", caught by
                `e2e/shell.spec.ts`, which asserts the name exactly. The name
                still starts with the visible label, so voice control's "click
                Bookings" keeps working (SC 2.5.3).
              */
              aria-label={
                count !== null && badge
                  ? `${item.label}, ${count} ${badge.spoken}`
                  : undefined
              }
              className={cn(
                "ease-interaction flex h-12 rounded-full transition-[background-color,color] duration-200",
                bar
                  ? "flex-col items-center justify-center gap-1 px-0.5"
                  : "items-center gap-3 px-4",
                active
                  ? "bg-paper text-forest"
                  : cn(
                      "text-paper/70 hover:text-paper",
                      !bar && "hover:bg-paper/8",
                    ),
              )}
            >
              <span className="relative inline-flex">
                <Icon className="size-5" />
                {badge && bar ? (
                  <Count
                    n={count}
                    onPaper={active}
                    answers={badge.key === "bookings"}
                    className="absolute -top-1.5 -right-3"
                  />
                ) : null}
              </span>
              <span
                className={cn(
                  "text-xs font-bold",
                  bar &&
                    "max-w-full truncate text-[11px] leading-none min-[21rem]:text-xs",
                )}
              >
                {item.label}
              </span>
              {badge && !bar ? (
                <Count
                  n={count}
                  onPaper={active}
                  answers={badge.key === "bookings"}
                  className="ml-auto"
                />
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One count. Decorative: the link says the number in words.
 *
 * When it changes under the operator (a request arriving, one answered on
 * another phone), the number cross-fades in place, 150ms (O01 A, approved
 * 4 Oct 2026): the bubble stays where it is and only its figure changes, so
 * the change is seen without anything moving.
 *
 * When the operator's own answer lowers the Bookings count, it rolls down
 * instead (O02 A): the new number comes down from above as the old one
 * leaves below. The answer store marks each answer it sends, and the fall
 * that follows takes the mark (`takeAnswersSent`), once; a fall nobody here
 * marked is somebody else's, and cross-fades. Of the two twins drawn (the
 * bar on a phone, the rail on a desktop) only the one on screen takes it.
 *
 * At zero the bubble fades away (150ms) rather than vanishing, and the first
 * number drawn simply appears. Under reduced motion each change is a 120ms
 * cross-fade.
 */
function Count({
  n,
  onPaper,
  answers = false,
  className,
}: {
  /** Absent is zero or unknown, and draws no bubble. */
  n: number | null;
  /** On the current stop, which is paper; everywhere else the chrome is forest. */
  onPaper: boolean;
  /** The Bookings count, which the operator's answers lower. */
  answers?: boolean;
  className?: string;
}) {
  const [shown, setShown] = useState(n);
  const [was, setWas] = useState<number | null>(null);
  const [changes, setChanges] = useState(0);
  if (n !== shown) {
    setWas(shown);
    setShown(n);
    setChanges((c) => c + 1);
  }

  const bubble = useRef<HTMLSpanElement>(null);
  const now = useRef<HTMLSpanElement>(null);
  const old = useRef<HTMLSpanElement>(null);
  /** The change last drawn, so letting the old figure go replays nothing. */
  const drawn = useRef(0);
  useLayoutEffect(() => {
    if (changes === 0 || changes === drawn.current) return;
    drawn.current = changes;
    const el = bubble.current;
    // The twin that is not on screen draws nothing and takes nothing.
    if (!el || el.getClientRects().length === 0) return;
    stopAnimations(el);
    const from = was ?? 0;
    const to = shown ?? 0;
    const answered = answers && to < from && takeAnswersSent(from - to);
    if (to === 0) {
      fadeOut(el);
      return;
    }
    if (from === 0 || badgeText(from) === badgeText(to)) return;
    if (answered) rollFigure(now.current, old.current, false);
    else crossFadeFigure(now.current, old.current);
  }, [changes, was, shown, answers]);

  // The old figure, and a bubble fading away, are let go once they have
  // played.
  useEffect(() => {
    if (was === null) return;
    const timer = setTimeout(() => setWas(null), DURATION.standard + 50);
    return () => clearTimeout(timer);
  }, [was, changes]);

  if (shown === null && was === null) return null;
  return (
    <span
      ref={bubble}
      aria-hidden="true"
      className={cn(
        "relative inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-bold tabular-nums",
        onPaper
          ? "bg-forest text-paper ring-paper ring-2"
          : "bg-paper text-forest ring-forest ring-2",
        className,
      )}
    >
      <span key={changes} ref={now}>
        {shown !== null ? badgeText(shown) : null}
      </span>
      {/*
        The old figure is drawn from an attribute, not as text, so the link's
        text is still the one number while it leaves.
      */}
      {was !== null ? (
        <span
          key={`was-${changes}`}
          ref={old}
          data-was={badgeText(was)}
          className="pointer-events-none absolute inset-0 flex items-center justify-center before:content-[attr(data-was)]"
        />
      ) : null}
    </span>
  );
}
