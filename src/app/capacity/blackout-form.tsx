"use client";

import { useActionState, useState } from "react";
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
 */
export function BlackoutForm({ today }: { today: string }) {
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
      onAgain={() => setRound((r) => r + 1)}
    />
  );
}

function BlackoutRound({
  today,
  onAgain,
}: {
  today: string;
  onAgain: () => void;
}) {
  const [state, act, pending] = useActionState<BlackoutState, FormData>(
    addBlackout,
    {},
  );
  const [open, setOpen] = useState(false);

  if (state.result) {
    const owed = state.result.existingBookings;
    return (
      <Panel tone={owed > 0 ? "alert" : "done"}>
        <p className="text-base font-bold">
          Those dates are closed to new bookings
        </p>
        {owed > 0 ? (
          <>
            <p className="text-terra-deep mt-2 text-sm font-bold">
              You still owe {owed} {owed === 1 ? "booking" : "bookings"}.
              Closing the calendar did not cancel them.
            </p>
            <p className="text-forest/90 mt-2 text-sm">
              {state.result.note ||
                "That includes anybody mid-checkout — their hold predates the closure and can still complete. Run them, or call each one off from its own departure."}
            </p>
          </>
        ) : (
          <p className="text-forest/80 mt-2 text-sm">
            Nothing was booked on them, so nobody is owed anything.
          </p>
        )}
        <Button onClick={onAgain} variant="secondary" className="mt-4">
          Close more dates
        </Button>
      </Panel>
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
    <form action={act} className={panelClass()}>
      <p className="text-base font-bold">Close dates to new bookings</p>
      <p className="text-forest/80 mt-2 text-sm">
        This stops new sales. It does <strong>not</strong> cancel bookings you
        already have.
      </p>

      <div className="mt-4 flex gap-3">
        <div className="flex-1">
          <label htmlFor="from" className="label text-forest/75">
            First day
          </label>
          <input
            id="from"
            name="from"
            type="date"
            min={today}
            defaultValue={today}
            required
            className={inputClass("bg-cream mt-2 px-3")}
          />
        </div>
        <div className="flex-1">
          <label htmlFor="to" className="label text-forest/75">
            Last day
          </label>
          <input
            id="to"
            name="to"
            type="date"
            min={today}
            defaultValue={today}
            required
            className={inputClass("bg-cream mt-2 px-3")}
          />
        </div>
      </div>

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
        <label htmlFor="blackout-note" className="label text-forest/75">
          Anything to add (optional)
        </label>
        <textarea
          id="blackout-note"
          name="note"
          rows={2}
          maxLength={500}
          className={textareaClass("bg-cream mt-2")}
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
          {pending ? "Closing…" : "Close them"}
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
