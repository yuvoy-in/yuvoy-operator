"use client";

import type { Dispatch, SetStateAction } from "react";
import type { BoardingParty } from "@/lib/day/boarding";
import { formatPaise } from "@/lib/format/money";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import { SunIcon } from "@/components/ui/icons";
import { Roll } from "@/components/ui/roll";

/**
 * The top of boarding mode: the kicker, the heading and the Sun mode switch.
 * Moved out of `boarding-screen.tsx` unchanged.
 */
export function BoardingHeading({
  mode,
  time,
  where,
  experience,
  sun,
  setSun,
}: {
  mode: string;
  time: string;
  where: string;
  experience: string;
  sun: boolean;
  setSun: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {/*
          Pretty, so a meeting point that runs onto a second line takes
          more than its last word with it (sun mode sets this larger). A
          no-break space before each dot, so no line ever starts with one.
        */}
        <p className="label text-forest/75 text-pretty tabular-nums">
          {[mode, time].filter(Boolean).join("\u00a0· ")}
          {where ? (
            <>
              {"\u00a0· "}
              <span className="voice-host">{where}</span>
            </>
          ) : null}
        </p>
        {/* The time on the board, untracked, and the name in the host's words. */}
        <h1 className="font-display tracking-display leading-display mt-1 text-3xl text-balance">
          {time ? (
            <span className="font-board tracking-normal tabular-nums">
              {time}
            </span>
          ) : null}
          {time && experience ? " " : null}
          {experience ? <span className="voice-host">{experience}</span> : null}
        </h1>
      </div>
      <button
        type="button"
        aria-pressed={sun}
        onClick={() => setSun((on) => !on)}
        className={cn(
          buttonClass({ variant: "secondary", size: "md", block: false }),
          "shrink-0 gap-1.5",
        )}
      >
        <SunIcon className="size-4" />
        Sun mode
      </button>
    </div>
  );
}

/**
 * The headcount and the line under it: parties to come, cash to take and
 * seats sold. Moved out of `boarding-screen.tsx` unchanged.
 */
export function BoardingCount({
  count,
  toCome,
  cash,
  seats,
}: {
  count: { aboard: number; booked: number };
  toCome: readonly BoardingParty[];
  cash: number | null;
  seats: string | null;
}) {
  return (
    <>
      {/*
      The number read at arm's length: guests aboard of guests booked.
      Said again, politely, each time it moves.
    */}
      <p aria-live="polite" className="mt-6 flex items-baseline gap-2">
        <span className="font-board text-7xl leading-none tabular-nums">
          <Roll value={count.aboard} />
        </span>{" "}
        <span className="text-forest/80 text-2xl">of</span>{" "}
        <span className="font-board text-7xl leading-none tabular-nums">
          {count.booked}
        </span>{" "}
        <span className="text-2xl font-bold">aboard</span>
      </p>
      {/*
      Joined with real separators, not a flex gap: a gap is space to the
      eye and nothing to a screen reader, which read "2 parties to
      come₹9,000 to take". Each fact holds together and the line breaks
      only after a dot (a no-break space sits before it), so a wrap never
      strands "sold" or opens a line with "·".
    */}
      <p className="text-forest/80 mt-3 text-base">
        {[
          <span key="come" className="whitespace-nowrap">
            <b className="text-forest">{toCome.length}</b>{" "}
            {toCome.length === 1 ? "party to come" : "parties to come"}
          </span>,
          ...(cash !== null && cash > 0
            ? [
                <span key="cash" className="whitespace-nowrap">
                  <b className="text-forest">{formatPaise(cash)}</b> to take
                </span>,
              ]
            : []),
          ...(seats
            ? [
                <span key="seats" className="whitespace-nowrap">
                  {seats}
                </span>,
              ]
            : []),
        ].flatMap((part, i) => (i === 0 ? [part] : ["\u00a0· ", part]))}
      </p>
    </>
  );
}
