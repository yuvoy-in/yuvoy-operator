"use client";

import { useActionState, useState } from "react";
import { addDepartures, type DepartureState } from "./actions";
import type { OperatorListing } from "@/lib/day/types";
import {
  DEFAULT_CUTOFF_HOURS,
  DEFAULT_DURATION_MINUTES,
  WEEKDAYS,
  countDepartures,
  departureCount,
  departureProblem,
} from "@/lib/day/departures";
import { MAX_SEATS } from "@/lib/day/capacity-types";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { Panel, panelClass } from "@/components/ui/panel";

/**
 * Adding departures — the one thing the capacity screen could not do.
 *
 * ## The hazard this form is shaped around
 *
 * `POST /slots` creates the cross product of a date range and a list of times.
 * "Next Saturday at seven" and "every day for the next fortnight at seven" are
 * one untouched date field apart, and Yuvoy sells a seat on every departure
 * either produces. A confirmation dialog would not help — the operator would
 * be confirming the same misunderstanding.
 *
 * So the number is on the button, live, before anything is sent:
 * **"Add 3 departures"**. `countDepartures` is the same function the Server
 * Action re-runs, so the form cannot say one number and send another.
 *
 * ## `created: 0` is not an error
 *
 * "Dates that already have a departure at that time are left alone … a retry
 * after a timeout does not sell the same boat twice." The receipt says which
 * of the two happened rather than showing a failure over an idempotent no-op,
 * because an operator told "nothing was added" reasonably tries again.
 */
export function DepartureForm({
  listings,
  today,
}: {
  /** `null` means the listings could not be fetched. See `listListings`. */
  listings: OperatorListing[] | null;
  today: string;
}) {
  /*
    Remounted per batch, for the reason the blackout form is: `useActionState`
    keeps its last result for the life of the component, so one batch replaced
    the form with its receipt until the operator navigated away and back.
  */
  const [round, setRound] = useState(0);
  return (
    <DepartureRound
      key={round}
      listings={listings}
      today={today}
      onAgain={() => setRound((r) => r + 1)}
    />
  );
}

function DepartureRound({
  listings,
  today,
  onAgain,
}: {
  listings: OperatorListing[] | null;
  today: string;
  onAgain: () => void;
}) {
  const [state, act, pending] = useActionState<DepartureState, FormData>(
    addDepartures,
    {},
  );
  const [open, setOpen] = useState(false);

  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [times, setTimes] = useState<string[]>(["07:00"]);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [more, setMore] = useState(false);

  const spansDays = toDate > fromDate;
  /*
    The weekday chips only exist while the range spans days, so when it
    collapses to one day their inputs unmount and nothing is submitted for
    them — while this component still holds whatever was ticked. Read from the
    same condition that renders them, or the preview filters by a weekday the
    form is no longer sending: "nothing to add" over a plan the server would
    happily create.
  */
  const plan = {
    fromDate,
    toDate,
    times,
    weekdays: spansDays ? weekdays : [],
  };
  const count = countDepartures(plan);
  /*
    The same function the action runs, on every keystroke. Shown rather than
    enforced with `min`/`max`: native constraint validation blocks the submit
    behind a browser tooltip, and the reasons here are sentences — "no day in
    that range matches the days you picked" is not something a tooltip says.
  */
  const problem = departureProblem(plan, today);

  if (state.result) {
    const { created, asked, note } = state.result;
    return (
      <Panel tone={created > 0 ? "done" : "raised"}>
        {created > 0 ? (
          <>
            <p className="text-base font-bold">
              {departureCount(created)} added
            </p>
            {created < asked ? (
              /*
                Asked for more than were made: the rest already existed. Said
                plainly, because the alternative is an operator counting rows
                and concluding the portal dropped some.
              */
              <p className="text-forest/80 mt-2 text-sm">
                {asked - created} of the {asked} you asked for already had a
                departure at that time, so those were left alone.
              </p>
            ) : (
              /*
                NOT "they are on sale from now" — yuvoy-operator#30 §4.

                That was untrue for a draft listing, an unpriced one, a
                withdrawn one, and an operator who is not selling. Production
                currently holds a draft listing with hundreds of departures no
                traveller can book, every one of which this sentence claimed
                was selling.

                `GET /slots` gains `onSale` and `notOnSaleReason` in migration
                0055, which is what will let this screen say WHICH of those it
                is. Until then it says the part that is true of every case —
                the departure exists — and does not claim the sale.
              */
              <p className="text-forest/80 mt-2 text-sm">
                They exist now. Whether travellers can book them depends on the
                activity being on sale — check it on{" "}
                <a
                  href="/services/activities"
                  className="underline underline-offset-2"
                >
                  Activities
                </a>
                . You can change the seats on each one below.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-base font-bold">Nothing to add</p>
            <p className="text-forest/80 mt-2 text-sm">
              Every one of those days and times already has a departure, so
              nothing was changed. Pressing again is safe — it never sells the
              same boat twice.
            </p>
          </>
        )}
        {note ? <p className="text-forest/80 mt-2 text-sm">{note}</p> : null}
        <Button onClick={onAgain} variant="secondary" className="mt-4">
          Add more departures
        </Button>
      </Panel>
    );
  }

  /*
    Two absences, two sentences, and they must not be collapsed into one.

    `null` — the fetch failed. Nothing is known about this operator's trips and
    a retry is the answer. Saying "you appear to have none" here would send
    somebody to message us about a problem that was ours and momentary.

    `[]` — the fetch worked and found nothing. There is no `GET /experiences`,
    so listings are read off the departures they appear on, and a schedule that
    ran out more than four months ago is invisible. That IS worth a message to
    us, and it is raised on yuvoy-api#63. A free-text listing id would be worse
    than either: the id is not something anybody has.
  */
  if (listings === null) {
    return (
      <Panel tone="alert">
        <p className="text-base font-bold">
          We could not load your trips just now
        </p>
        <p className="text-forest/80 mt-2 text-sm">
          Everything below still works — this is only the list of trips to add a
          departure to. Reload the page to try again.
        </p>
      </Panel>
    );
  }

  if (listings.length === 0) {
    return (
      <Panel>
        <p className="text-base font-bold">Adding a departure</p>
        <p className="text-forest/80 mt-2 text-sm">
          We cannot show your trips here yet — the only place they appear is on
          departures you already have, and there are none within four months
          either side of today.
        </p>
        {/*
          "Message us and we will add the first one for you" stopped being true
          when the portal gained listing creation (yuvoy-operator#30 §4). An
          operator with no departures now has a screen that can make one — and
          telling them to message us instead is a day of waiting for something
          they could do in a minute.
        */}
        <p className="text-forest/80 mt-2 text-sm">
          If you have an activity already, add a departure to it below. If you
          have not written one yet, start on{" "}
          <a
            href="/services/activities"
            className="underline underline-offset-2"
          >
            Activities
          </a>
          .
        </p>
      </Panel>
    );
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="secondary">
        Add departures
      </Button>
    );
  }

  return (
    <form action={act} className={panelClass()}>
      <p className="text-base font-bold">Add departures</p>
      <p className="text-forest/80 mt-2 text-sm">
        One day, or a pattern across a stretch of days. Yuvoy starts selling
        each one as soon as it exists.
      </p>

      {/* ---------------------------------------------------- which trip -- */}
      <div className="mt-4">
        <label htmlFor="experienceId" className="label text-forest/75">
          Which trip
        </label>
        {listings.length === 1 ? (
          <>
            <input
              type="hidden"
              id="experienceId"
              name="experienceId"
              value={listings[0].id}
            />
            {/*
              Stated rather than offered as a choice of one. An operator adding
              departures to the wrong trip is the mistake with no undo on this
              screen, so the name is on the page either way.
            */}
            <p className="mt-2 text-base font-bold">{listings[0].title}</p>
          </>
        ) : (
          <select
            id="experienceId"
            name="experienceId"
            required
            defaultValue=""
            className={inputClass("mt-2 px-3")}
          >
            <option value="" disabled>
              Choose a trip
            </option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* --------------------------------------------------------- dates -- */}
      <div className="mt-4 flex gap-3">
        <div className="flex-1">
          <label htmlFor="fromDate" className="label text-forest/75">
            First day
          </label>
          <input
            id="fromDate"
            name="fromDate"
            type="date"
            min={today}
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              // A last day now before the first is a range nobody meant. It
              // follows rather than becoming an error to read and fix.
              if (e.target.value > toDate) setToDate(e.target.value);
            }}
            required
            className={inputClass("px-3")}
          />
        </div>
        <div className="flex-1">
          <label htmlFor="toDate" className="label text-forest/75">
            Last day
          </label>
          <input
            id="toDate"
            name="toDate"
            type="date"
            min={fromDate}
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            required
            className={inputClass("px-3")}
          />
        </div>
      </div>

      {/* --------------------------------------------------------- times -- */}
      <fieldset className="mt-4">
        <legend className="label text-forest/75">
          {times.length === 1 ? "Departure time" : "Departure times"}
        </legend>
        <div className="mt-2 space-y-2">
          {times.map((time, i) => (
            <div key={i} className="flex gap-2">
              <input
                id={i === 0 ? "times" : `times-${i}`}
                name="times"
                type="time"
                required
                aria-label={`Departure time ${i + 1}`}
                value={time}
                onChange={(e) =>
                  setTimes(times.map((t, j) => (j === i ? e.target.value : t)))
                }
                className={inputClass("px-3")}
              />
              {times.length > 1 ? (
                <Button
                  type="button"
                  onClick={() => setTimes(times.filter((_, j) => j !== i))}
                  variant="outline"
                  block={false}
                  aria-label={`Remove departure time ${i + 1}`}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        {times.length < 12 ? (
          <Button
            type="button"
            onClick={() => setTimes([...times, ""])}
            variant="outline"
            size="sm"
            block={false}
            className="mt-2"
          >
            Add another time
          </Button>
        ) : null}
      </fieldset>

      {/* ------------------------------------------------------ weekdays -- */}
      {spansDays ? (
        <fieldset className="mt-4">
          <legend className="label text-forest/75">
            Which days (leave all off for every day)
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {WEEKDAYS.map((day) => {
              const on = weekdays.includes(day.value);
              return (
                <label
                  key={day.value}
                  className={
                    "rounded-control relative flex h-11 min-w-14 cursor-pointer items-center justify-center border px-3 text-sm " +
                    "has-[:focus-visible]:ring-forest has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2 " +
                    (on
                      ? "border-forest bg-forest text-cream"
                      : "border-cream-line bg-cream text-forest")
                  }
                >
                  {/*
                    Transparent and filling the chip, rather than `sr-only`.

                    A visually-hidden checkbox has no hit area of its own: the
                    label forwards a tap, so it works for a finger, but the
                    control cannot be pointed at directly and a keyboard user
                    focusing it gets no ring, because there is nothing on
                    screen to draw one around. Sizing the input to the chip
                    gives it back both — the ring is drawn on the label through
                    `has-[:focus-visible]`, and the whole chip is the target.
                    Caught by an e2e that could not click it.
                  */}
                  <input
                    type="checkbox"
                    name="weekdays"
                    value={day.value}
                    checked={on}
                    onChange={() =>
                      setWeekdays(
                        on
                          ? weekdays.filter((w) => w !== day.value)
                          : [...weekdays, day.value],
                      )
                    }
                    aria-label={day.label}
                    className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
                  />
                  <span aria-hidden="true">{day.short}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {/* --------------------------------------------------------- seats -- */}
      <div className="mt-4">
        <label htmlFor="seats" className="label text-forest/75">
          Seats on each departure
        </label>
        <input
          id="seats"
          name="seats"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_SEATS}
          defaultValue={6}
          required
          className={inputClass("mt-2 w-28 text-lg")}
        />
        <p className="text-forest/70 mt-2 text-xs">
          What you are selling to Yuvoy — not what the boat holds.
        </p>
      </div>

      {/* ------------------------------------------------- more options -- */}
      {more ? (
        <div className="border-cream-line mt-4 space-y-4 border-t pt-4">
          <div>
            <label htmlFor="capacity" className="label text-forest/75">
              What the boat holds (optional)
            </label>
            <input
              id="capacity"
              name="capacity"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_SEATS}
              className={inputClass("mt-2 w-28 text-lg")}
            />
            <p className="text-forest/70 mt-2 text-xs">
              Only if you also sell at the jetty. Left empty it is the same as
              the seats above.
            </p>
          </div>
          <div>
            <label htmlFor="durationMinutes" className="label text-forest/75">
              How long it runs, in minutes
            </label>
            <input
              id="durationMinutes"
              name="durationMinutes"
              type="number"
              inputMode="numeric"
              min={15}
              max={1440}
              defaultValue={DEFAULT_DURATION_MINUTES}
              className={inputClass("mt-2 w-28 text-lg")}
            />
          </div>
          <div>
            <label htmlFor="cutoffHours" className="label text-forest/75">
              Bookings close this many hours before
            </label>
            <input
              id="cutoffHours"
              name="cutoffHours"
              type="number"
              inputMode="numeric"
              min={0}
              max={168}
              defaultValue={DEFAULT_CUTOFF_HOURS}
              className={inputClass("mt-2 w-28 text-lg")}
            />
          </div>
        </div>
      ) : (
        <Button
          type="button"
          onClick={() => setMore(true)}
          variant="outline"
          size="sm"
          block={false}
          className="mt-4"
        >
          More options
        </Button>
      )}

      {/* ------------------------------------------------------- the count */}
      {problem ? (
        <p role="status" className="text-terra-deep mt-4 text-sm font-bold">
          {problem.message}
        </p>
      ) : (
        /*
          The number, before the button rather than after the fact. This is the
          whole guard against a fortnight of departures created by an untouched
          date field — a batch that is wrong is wrong here, where it costs a
          glance rather than a support conversation.
        */
        <p role="status" className="text-forest/80 mt-4 text-sm">
          That is <strong>{departureCount(count)}</strong>
          {spansDays ? ` between ${fromDate} and ${toDate}` : ` on ${fromDate}`}
          . Yuvoy sells seats on every one.
        </p>
      )}

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button
          type="submit"
          disabled={pending}
          block={false}
          className="flex-1"
        >
          {pending
            ? "Adding…"
            : problem
              ? "Add departures"
              : `Add ${departureCount(count)}`}
        </Button>
        <Button
          onClick={() => setOpen(false)}
          variant="secondary"
          block={false}
          className="flex-1"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
