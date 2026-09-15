"use client";

import { useActionState, useId, useState } from "react";
import { addBlackout, type BlackoutState } from "./actions";
import { BLACKOUT_REASONS } from "@/lib/day/capacity-types";
import { Button } from "@/components/ui/button";
import { choiceClass, inputClass, textareaClass } from "@/components/ui/input";
import { Panel, panelClass } from "@/components/ui/panel";

/**
 * Closing dates to new bookings.
 *
 * **Closing dates is not cancelling people**, and that misunderstanding is the
 * whole reason this needs a considered result rather than a tick: "an operator
 * who assumes closing the calendar cancelled the bookings will simply not turn
 * up."
 *
 * So when the API reports bookings still owed, that is what the screen leads
 * with — including people mid-checkout, whose holds predate the closure and
 * can still complete.
 *
 * ## One day, from its Manage panel — yuvoy-operator#45
 *
 * Given a `day`, the same form closes that day alone: the dates are fixed to
 * it, the words name it, and a day that is already closed says so rather than
 * offering to close it again. There is no reopen — no endpoint removes a
 * closure — and the screen says that instead of leaving somebody to look for
 * a button that does not exist.
 */
export interface ClosingDay {
  /** `YYYY-MM-DD`, in the market's calendar. */
  date: string;
  /** How the calendar names it: "Today", "Tomorrow", or the date written out. */
  label: string;
  /** Every departure still running on it is already closed. */
  closed: boolean;
}

export function BlackoutForm({
  today,
  day,
}: {
  today: string;
  day?: ClosingDay;
}) {
  /*
    Remounted per closure. `useActionState` keeps its last result for the
    life of the component, so one closure replaced the form with its receipt
    until the operator navigated away and back. A new key is a new form.
  */
  const [round, setRound] = useState(0);
  return (
    <BlackoutRound
      key={round}
      today={today}
      day={day}
      onAgain={() => setRound((r) => r + 1)}
    />
  );
}

function BlackoutRound({
  today,
  day,
  onAgain,
}: {
  today: string;
  day?: ClosingDay;
  onAgain: () => void;
}) {
  const [state, act, pending] = useActionState<BlackoutState, FormData>(
    addBlackout,
    {},
  );
  // A day's form is already inside the panel somebody opened to reach it.
  const [open, setOpen] = useState(Boolean(day));
  /*
    Unique per form. The calendar can hold this form more than once — the
    range closure at the top and a day's inside its Manage panel — and two
    `id="from"` inputs would give two labels one field and fail the audit.
  */
  const id = useId();
  /** "Today" reads as "today" mid-sentence; a date keeps its capitals. */
  const spoken = day
    ? /^(Today|Tomorrow)$/.test(day.label)
      ? day.label.toLowerCase()
      : day.label
    : "";

  if (state.result) {
    const owed = state.result.existingBookings;
    return (
      <Panel tone={owed > 0 ? "alert" : "done"}>
        <p className="text-base font-bold">
          {day
            ? `${day.label} is closed to new bookings`
            : "Those dates are closed to new bookings"}
        </p>
        {owed > 0 ? (
          <>
            <p className="text-terra-deep mt-2 text-sm font-bold">
              You still owe {owed} {owed === 1 ? "booking" : "bookings"}.
              Closing the calendar did not cancel them.
            </p>
            <p className="text-forest/90 mt-2 text-sm">
              {state.result.note ||
                "That includes anybody mid-checkout. Their hold predates the closure and can still complete. Run them, or call each one off from its own departure."}
            </p>
          </>
        ) : (
          <p className="text-forest/80 mt-2 text-sm">
            {day
              ? "Nothing was booked on it, so nobody is owed anything."
              : "Nothing was booked on them, so nobody is owed anything."}
          </p>
        )}
        {day ? null : (
          <Button onClick={onAgain} variant="secondary" className="mt-4">
            Close more dates
          </Button>
        )}
      </Panel>
    );
  }

  if (day?.closed) {
    return (
      <p className="text-forest/80 text-sm">
        {`${day.label} is already closed to new bookings. Reopening a closed day is not something the portal can do yet.`}
      </p>
    );
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="secondary">
        Close dates to new bookings
      </Button>
    );
  }

  return (
    <form action={act} className={day ? undefined : panelClass()}>
      <p className="text-base font-bold">
        {day
          ? `Close ${spoken} to new bookings`
          : "Close dates to new bookings"}
      </p>
      <p className="text-forest/80 mt-2 text-sm">
        This stops new sales. It does <strong>not</strong> cancel bookings you
        already have.
      </p>

      {day ? (
        <>
          <input type="hidden" name="from" value={day.date} />
          <input type="hidden" name="to" value={day.date} />
        </>
      ) : (
        <div className="mt-4 flex gap-3">
          <div className="flex-1">
            <label htmlFor={`${id}-from`} className="label text-forest/75">
              First day
            </label>
            <input
              id={`${id}-from`}
              name="from"
              type="date"
              min={today}
              defaultValue={today}
              required
              className={inputClass("bg-paper mt-2 px-3")}
            />
          </div>
          <div className="flex-1">
            <label htmlFor={`${id}-to`} className="label text-forest/75">
              Last day
            </label>
            <input
              id={`${id}-to`}
              name="to"
              type="date"
              min={today}
              defaultValue={today}
              required
              className={inputClass("bg-paper mt-2 px-3")}
            />
          </div>
        </div>
      )}

      <fieldset className="mt-4">
        <legend className="label text-forest/75">Why?</legend>
        <div className="mt-2 space-y-2">
          {BLACKOUT_REASONS.map((reason) => (
            <label key={reason.code} className={choiceClass()}>
              <input
                type="radio"
                name="reasonCode"
                value={reason.code}
                required
                className="accent-terra-deep size-5"
              />
              <span className="text-sm">{reason.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <label htmlFor={`${id}-note`} className="label text-forest/75">
          Anything to add (optional)
        </label>
        <textarea
          id={`${id}-note`}
          name="note"
          rows={2}
          maxLength={500}
          className={textareaClass("bg-paper mt-2")}
        />
      </div>

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
          {pending ? "Closing…" : day ? `Close ${spoken}` : "Close them"}
        </Button>
        {day ? null : (
          <Button
            onClick={() => setOpen(false)}
            variant="secondary"
            block={false}
            className="flex-1"
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
