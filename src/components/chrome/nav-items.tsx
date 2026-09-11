"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { cn } from "@/lib/cn";
import {
  BADGES,
  NAV,
  badgeText,
  type NavBadges,
  type NavIcon,
} from "@/lib/site/nav";
import {
  BriefcaseIcon,
  CalendarIcon,
  ClockIcon,
  LayersIcon,
  TicketIcon,
} from "@/components/ui/icons";

const ICONS: Record<NavIcon, ComponentType<{ className?: string }>> = {
  today: ClockIcon,
  bookings: TicketIcon,
  /*
    The glyphs moved with the labels (yuvoy-operator#32). Today is the hours
    of one day, so it takes the clock; Bookings is a list of tickets; Calendar
    is a month, so it takes the calendar. The previous pairing had Today on a
    calendar and Capacity on a ticket, which read backwards the moment the
    tabs were named for what they are.
  */
  calendar: CalendarIcon,
  listings: LayersIcon,
  business: BriefcaseIcon,
};

/**
 * The floating tab bar (phone) and the rail (desktop) render the same
 * registry in two orientations. In the bar the active destination opens into
 * a cream pill carrying its name; the other four are discs holding only
 * their glyph, named for a screen reader.
 *
 * ## Five stops, and the width that buys
 *
 * Four discs at 48px, one open pill, `gap-1` between and `p-1.5` around comes
 * to roughly 330px with the longest label. That fits the 412px the mobile
 * suite runs at and a 360px phone; below 360px it would not, and the pill
 * scrolls rather than clipping — `overflow-x-auto` with the scrollbar hidden,
 * so the worst case is a nudge rather than a destination nobody can reach.
 *
 * ## The two counts — yuvoy-operator#42
 *
 * On a disc the count rides the glyph's corner, so a badge adds no width to a
 * bar that is already near its limit; on the open pill and on the rail it sits
 * beside the name. The bubble itself is `aria-hidden` and the number is said
 * in words as the link's name instead — "Bookings, 3 waiting on your answer" —
 * so a screen reader hears what the number is OF rather than a bare digit after
 * a label. Cream on forest and forest on cream: 11.44:1 either way.
 */
export function NavList({
  orientation,
  badges,
}: {
  orientation: "bar" | "rail";
  /** Counts for the stops that carry one. Absent means unknown: draw nothing. */
  badges?: NavBadges;
}) {
  const pathname = usePathname() ?? "";
  const bar = orientation === "bar";

  return (
    <ul className={cn("flex", bar ? "items-center gap-1" : "flex-col gap-1")}>
      {NAV.map((item) => {
        const active = item.match(pathname);
        const Icon = ICONS[item.icon];
        const badge = BADGES[item.icon];
        const raw = badge ? badges?.[badge.key] : undefined;
        // Zero draws nothing, exactly like unknown: an empty queue is not news.
        const count = typeof raw === "number" && raw > 0 ? raw : null;

        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              /*
                The count is said through the link's NAME, not a screen-reader
                span beside the label. Chromium pads an out-of-flow child with
                a space when it computes a name, so the span version announced
                "Bookings , 3 waiting on your answer" — caught by
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
                "ease-interaction flex h-12 items-center rounded-full transition-[background-color,color] duration-200",
                bar
                  ? active
                    ? "bg-cream text-forest gap-2 pr-4 pl-3.5"
                    : "text-cream/70 hover:text-cream w-12 justify-center"
                  : active
                    ? "bg-cream text-forest gap-3 px-4"
                    : "text-cream/70 hover:bg-cream/8 hover:text-cream gap-3 px-4",
              )}
            >
              <span className="relative inline-flex">
                <Icon className="size-5" />
                {count !== null && bar && !active ? (
                  <Count
                    n={count}
                    onCream={false}
                    className="absolute -top-2 -right-2.5"
                  />
                ) : null}
              </span>
              <span
                className={cn(
                  "label font-bold",
                  bar && "text-[11px]",
                  bar && !active && "sr-only",
                )}
              >
                {item.label}
              </span>
              {count !== null && (active || !bar) ? (
                <Count
                  n={count}
                  onCream={active}
                  className={bar ? undefined : "ml-auto"}
                />
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
  onCream,
  className,
}: {
  n: number;
  /** On the open pill, which is cream; everywhere else the chrome is forest. */
  onCream: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-bold tabular-nums",
        onCream
          ? "bg-forest text-cream"
          : "bg-cream text-forest ring-forest ring-2",
        className,
      )}
    >
      {badgeText(n)}
    </span>
  );
}
