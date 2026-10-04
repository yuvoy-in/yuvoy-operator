"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import { cn } from "@/lib/cn";

/** One day on the strip, worked out on the server. */
export interface StripDay {
  day: string;
  href: string;
  /** "Thu 15 Oct, today, 3 departures": the link's whole name. */
  name: string;
  weekday: string;
  date: string;
  today: boolean;
  /** Anything on it: the mark under the date. */
  on: boolean;
}

/**
 * The strip's seven days, answering the press (O08 A, approved 4 Oct 2026).
 *
 * Every tap here is a trip to the server (the day is in the address), and
 * nothing used to answer the finger until it came back: on island signal a
 * tapped day looked untapped for a second or more. Now the tapped day takes
 * its fill in the frame it is pressed, and `aria-current` moves with it; the
 * day's list still waits for its answer. The day is drawn from the tap until
 * the address agrees, or goes somewhere else (back, forward). Its colours
 * change in 150ms, the mark under the date with them.
 */
export function DayStrip({ days, open }: { days: StripDay[]; open: string }) {
  const [pending, setPending] = useState<string | null>(null);
  const [answered, setAnswered] = useState(open);
  if (open !== answered) {
    setAnswered(open);
    setPending(null);
  }
  const lit = pending ?? open;

  // Back or forward while a tap waits: the history decides, not the tap.
  useEffect(() => {
    const onPop = () => setPending(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function tap(event: MouseEvent<HTMLAnchorElement>, day: string) {
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
    setPending(day === open ? null : day);
  }

  return (
    <nav aria-label="Days" className="mt-5 grid grid-cols-7 gap-1 lg:hidden">
      {days.map((d) => {
        const lighted = d.day === lit;
        return (
          <Link
            key={d.day}
            href={d.href}
            scroll={false}
            aria-label={d.name}
            aria-current={lighted ? "page" : undefined}
            onClick={(event) => tap(event, d.day)}
            className={cn(
              "rounded-control flex min-h-14 flex-col items-center justify-center border text-center",
              "ease-interaction transition-colors duration-150",
              lighted
                ? "border-forest bg-forest text-paper"
                : "border-paper-line bg-paper-deep text-forest hover:border-forest/40",
              // Today is ringed, so the dot below only ever means "something on".
              d.today && !lighted && "border-terra-deep border-2",
            )}
          >
            <span className="text-[11px] leading-none">{d.weekday}</span>
            <span className="mt-1 text-lg leading-none font-bold tabular-nums">
              {d.date}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "ease-interaction mt-1 size-1.5 rounded-full transition-[background-color] duration-150",
                !d.on ? "bg-transparent" : lighted ? "bg-paper" : "bg-forest",
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}
