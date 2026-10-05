"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { fieldLabelClass, inputClass } from "@/components/ui/input";
import { WEEKDAYS } from "./schedule-changes";
import {
  SHORT_DAY,
  WEEK_ORDER,
  dropOwn,
  everyDay,
  giveOwn,
  setOwn,
  setUsual,
  toggleDay,
  type Departure,
  type PlanProblem,
  type WeekPlan,
} from "./week-plan";

/**
 * The week, picked rather than typed a row at a time (yuvoy-operator#111).
 *
 * Seven chips for the days it runs, then the time it leaves and its seats,
 * once, for all of them. A day that is different (a later start on Sundays,
 * more seats on Saturdays, a second boat) is set underneath, folded away
 * until it is needed. What each part means is in `week-plan.ts`; this draws
 * it and hands every change back as a whole new plan.
 *
 * ## The chips are buttons
 *
 * `aria-pressed` toggle buttons, so a keyboard reaches each with Tab and
 * flips it with Space or Enter, and a screen reader hears "Monday, toggle
 * button, pressed". Each is a 44px target: four to a row on a phone, all
 * seven from `sm` up, because seven abreast at 44px does not fit a phone's
 * sheet.
 */
export function WeekPicker({
  plan,
  onChange,
  problems,
}: {
  plan: WeekPlan;
  onChange: (plan: WeekPlan) => void;
  problems: readonly PlanProblem[];
}) {
  const ids = useId();
  const ownDays = WEEK_ORDER.filter((day) => plan.own[day]);
  /*
    Open from the start when the listing already has a day that is
    different, so what it runs is all on screen; folded otherwise, so the
    usual case reads as days, a time and seats.
  */
  const [showOwn, setShowOwn] = useState(ownDays.length > 0);
  /*
    And it stays open while a day's own departures would be refused: Save
    waits on what is marked, so what is marked is never folded out of sight.
  */
  const ownProblem = problems.some((p) => p.day !== null);
  const said = (day: number | null) =>
    problems.filter((p) => p.day === day).map((p) => p.message);

  return (
    <div className="space-y-5">
      <div role="group" aria-labelledby={`${ids}-days`}>
        <div className="flex min-h-7 items-center justify-between gap-3">
          <p id={`${ids}-days`} className={fieldLabelClass()}>
            Days it runs
          </p>
          {plan.days.length < 7 ? (
            <button
              type="button"
              onClick={() => onChange(everyDay(plan))}
              className="text-forest/80 tap-target text-sm underline underline-offset-4"
            >
              Every day
            </button>
          ) : null}
        </div>
        <DayChips
          days={WEEK_ORDER}
          isOn={(day) => plan.days.includes(day)}
          onToggle={(day) => onChange(toggleDay(plan, day))}
        />
        {plan.days.length === 0 ? (
          <p className="text-forest/70 leading-body mt-2 text-sm text-pretty">
            No weekly schedule.
          </p>
        ) : null}
      </div>

      <DepartureRows
        idBase={`${ids}-usual`}
        departures={plan.usual}
        onChange={(usual) => onChange(setUsual(plan, usual))}
        addLabel="Add another time"
        problems={said(null)}
      />

      {plan.days.length > 0 ? (
        <details
          open={showOwn || ownProblem}
          onToggle={(e) => {
            /*
              Put back here rather than by the prop: React writes `open` only
              when the prop changes, and folding by hand changes the element,
              not the prop.
            */
            const details = e.currentTarget;
            if (!details.open && ownProblem) {
              details.open = true;
              return;
            }
            setShowOwn(details.open);
          }}
          className="border-paper-line border-t pt-4"
        >
          <summary className="text-forest/80 tap-target cursor-pointer list-none text-sm underline underline-offset-4 [&::-webkit-details-marker]:hidden">
            Different on some days
          </summary>

          <div role="group" aria-labelledby={`${ids}-which`} className="mt-3">
            <p id={`${ids}-which`} className={fieldLabelClass()}>
              Which days
            </p>
            {/*
              Named apart from the chips above ("Sunday is different"), so a
              screen reader never meets two controls called "Sunday" that do
              different things.
            */}
            <DayChips
              days={WEEK_ORDER.filter((day) => plan.days.includes(day))}
              nameFor={(day) => `${WEEKDAYS[day]} is different`}
              isOn={(day) => Boolean(plan.own[day])}
              onToggle={(day) =>
                onChange(
                  plan.own[day] ? dropOwn(plan, day) : giveOwn(plan, day),
                )
              }
            />
          </div>

          {ownDays.map((day) => (
            <div
              key={day}
              role="group"
              aria-labelledby={`${ids}-own-${day}`}
              className="mt-4"
            >
              <p id={`${ids}-own-${day}`} className="text-sm font-bold">
                {WEEKDAYS[day]}
              </p>
              <DepartureRows
                idBase={`${ids}-own-${day}`}
                day={day}
                departures={plan.own[day]!}
                onChange={(departures) =>
                  onChange(setOwn(plan, day, departures))
                }
                addLabel={`Add another time on ${WEEKDAYS[day]}`}
                problems={said(day)}
              />
            </div>
          ))}
        </details>
      ) : null}
    </div>
  );
}

/** A row of day chips, Monday first: pressed is on. */
function DayChips({
  days,
  nameFor = (day) => WEEKDAYS[day],
  isOn,
  onToggle,
}: {
  days: readonly number[];
  /** The chip's name; it begins with its word, "Mon" in "Monday". */
  nameFor?: (day: number) => string;
  isOn: (day: number) => boolean;
  onToggle: (day: number) => void;
}) {
  return (
    <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
      {days.map((day) => {
        const on = isOn(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            aria-label={nameFor(day)}
            onClick={() => onToggle(day)}
            className={cn(
              "ease-interaction h-11 rounded-full border text-sm font-bold transition-colors duration-200",
              on
                ? "border-forest bg-forest text-paper"
                : "border-paper-line bg-paper-deep text-forest hover:border-forest/40",
            )}
          >
            {SHORT_DAY[day]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The departures of the usual days, or of one day: a time and seats each.
 * The last one cannot be removed, because a day with no departure does not
 * run: untick it instead, or put it back on the usual departures.
 */
function DepartureRows({
  idBase,
  day,
  departures,
  onChange,
  addLabel,
  problems,
}: {
  idBase: string;
  /** The day these are, for names that say which; absent for the usual. */
  day?: number;
  departures: Departure[];
  onChange: (departures: Departure[]) => void;
  addLabel: string;
  problems: string[];
}) {
  const ofDay = day === undefined ? "" : `, ${WEEKDAYS[day]}`;
  const update = (index: number, change: Partial<Departure>) =>
    onChange(departures.map((d, i) => (i === index ? { ...d, ...change } : d)));

  return (
    <div>
      <ul className="space-y-3">
        {departures.map((d, i) => (
          <li key={i} className="flex flex-wrap items-end gap-2">
            <div>
              <label
                htmlFor={`${idBase}-time-${i}`}
                className={fieldLabelClass()}
              >
                Leaves at<span className="sr-only">{ofDay}</span>
              </label>
              <input
                id={`${idBase}-time-${i}`}
                type="time"
                value={d.startTime}
                onChange={(e) => update(i, { startTime: e.target.value })}
                className={inputClass("mt-1 h-11 w-auto")}
              />
            </div>
            <div>
              <label
                htmlFor={`${idBase}-seats-${i}`}
                className={fieldLabelClass()}
              >
                Seats<span className="sr-only">{ofDay}</span>
              </label>
              <input
                id={`${idBase}-seats-${i}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={200}
                /*
                  Empty while it is being retyped, rather than snapping to 0:
                  `planProblems` says what a seat count must be until it is
                  one.
                */
                value={Number.isFinite(d.seats) ? d.seats : ""}
                onChange={(e) =>
                  update(i, {
                    seats: e.target.value === "" ? NaN : Number(e.target.value),
                  })
                }
                className={inputClass("mt-1 h-11 w-24")}
              />
            </div>
            {departures.length > 1 ? (
              <Button
                variant="secondary"
                size="md"
                block={false}
                onClick={() => onChange(departures.filter((_, at) => at !== i))}
              >
                {/*
                  The space belongs to the visible word: an accessible name
                  joins each child's text with its whitespace trimmed, so a
                  space that starts the hidden span would be lost.
                */}
                Remove{" "}
                <span className="sr-only">
                  {day === undefined ? "" : `${WEEKDAYS[day]} `}
                  {d.startTime || "this time"}
                </span>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {problems.map((problem) => (
        <p key={problem} className="text-terra-deep mt-2 text-sm font-bold">
          {problem}
        </p>
      ))}
      <Button
        variant="secondary"
        size="md"
        block={false}
        className="mt-3"
        onClick={() =>
          onChange([
            ...departures,
            /*
              No time is guessed: an empty one is a gap the operator can see
              and fill, where a made-up 09:00 is a departure nobody chose.
            */
            { startTime: "", seats: departures[departures.length - 1].seats },
          ])
        }
      >
        {addLabel}
      </Button>
    </div>
  );
}
