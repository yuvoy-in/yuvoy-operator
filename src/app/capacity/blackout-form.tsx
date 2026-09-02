"use client";

import { useActionState, useState } from "react";
import { addBlackout, type BlackoutState } from "./actions";
import { BLACKOUT_REASONS } from "@/lib/day/capacity-types";

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
      <div
        className={
          owed > 0
            ? "rounded-edge border-terra-deep bg-cream-deep border-2 p-5"
            : "rounded-edge border-forest bg-forest/5 border p-5"
        }
      >
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
        <button
          type="button"
          onClick={onAgain}
          className="rounded-edge dock-target label border-cream-line bg-cream mt-4 w-full border px-5"
        >
          Close more dates
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-edge dock-target label border-cream-line bg-cream-deep w-full border px-5"
      >
        Close dates to new bookings
      </button>
    );
  }

  return (
    <form
      action={act}
      className="rounded-edge border-cream-line bg-cream-deep border p-5"
    >
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
            className="rounded-edge border-cream-line bg-cream mt-2 h-14 w-full border px-3 text-base"
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
            className="rounded-edge border-cream-line bg-cream mt-2 h-14 w-full border px-3 text-base"
          />
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="label text-forest/75">Why?</legend>
        <div className="mt-2 space-y-2">
          {BLACKOUT_REASONS.map((reason) => (
            <label
              key={reason.code}
              className="rounded-edge border-cream-line bg-cream flex min-h-11 cursor-pointer items-center gap-3 border px-3"
            >
              <input
                type="radio"
                name="reasonCode"
                value={reason.code}
                required
                className="size-5"
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
          className="rounded-edge border-cream-line bg-cream mt-2 w-full border p-3 text-base"
        />
      </div>

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-edge dock-target label bg-forest text-cream flex-1 px-5 font-bold"
        >
          {pending ? "Closing…" : "Close them"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-edge dock-target label border-cream-line bg-cream flex-1 border px-5"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
