"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { cn } from "@/lib/cn";
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
 * share the pill's width equally: on a 360px phone that is about 60px each,
 * which holds "Bookings" (about 48px at 11px) with room either side, and each
 * stop is still a 48px-tall target. No stop scrolls out of reach at any
 * common width.
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
                {count !== null && bar ? (
                  <Count
                    n={count}
                    onPaper={active}
                    className="absolute -top-1.5 -right-3"
                  />
                ) : null}
              </span>
              <span
                className={cn(
                  "font-bold",
                  bar
                    ? "max-w-full truncate text-[11px] leading-none"
                    : "label",
                )}
              >
                {item.label}
              </span>
              {count !== null && !bar ? (
                <Count n={count} onPaper={active} className="ml-auto" />
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** One count. Decorative: the link says the number in words. */
function Count({
  n,
  onPaper,
  className,
}: {
  n: number;
  /** On the current stop, which is paper; everywhere else the chrome is forest. */
  onPaper: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-bold tabular-nums",
        onPaper
          ? "bg-forest text-paper ring-paper ring-2"
          : "bg-paper text-forest ring-forest ring-2",
        className,
      )}
    >
      {badgeText(n)}
    </span>
  );
}
