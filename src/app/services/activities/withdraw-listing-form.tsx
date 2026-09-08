"use client";

import { useActionState, useState } from "react";
import { withdrawListing, type WithdrawState } from "./actions";
import { WITHDRAW_REASONS } from "@/lib/services/listings";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * Taking your own listing off sale — yuvoy-operator#30 §6.
 *
 * The thing an operator could not do: only an admin could, "so an operator
 * whose boat was out of the water for a month had to ask somebody at Yuvoy — a
 * queue with a portal in front of it."
 *
 * ## The sentence this whole screen exists to prevent
 *
 * **Withdrawing cancels nothing and refunds nothing.** Future departures keep
 * their rows and stop being offered; confirmed bookings are untouched and the
 * operator still owes those travellers the trip. Somebody who assumes
 * otherwise simply does not turn up, and eleven people are on a jetty.
 *
 * So it is said twice: once here, before the decision, and once afterwards
 * from the API's own `note`, rendered verbatim. The second is the one that
 * survives — a warning read before a decision is a warning skimmed.
 *
 * ## Confirmed by typing the id
 *
 * The contract's own reasoning, and the same call the departure call-off
 * makes: "a checkbox is one mis-tap on a wet phone away from taking a live
 * listing off sale."
 */
export function WithdrawListingForm({
  experienceId,
  title,
  selling,
}: {
  experienceId: string;
  title: string;
  /**
   * Whether the listing is still on sale — and the gate lives HERE rather than
   * in the parent, which is the whole reason this prop exists.
   *
   * Withdrawing revalidates, so the row re-renders with the listing no longer
   * selling. A parent that mounted this component only while `selling` was
   * true would therefore unmount it at the exact moment it has something to
   * say, and the receipt — including the sentence about bookings still owed —
   * would vanish with it.
   *
   * Fifth time this rule has decided a screen in this portal: the component
   * that produced the change is the one that must survive it.
   */
  selling: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<WithdrawState, FormData>(
    withdrawListing,
    {},
  );

  /*
    The receipt, and it outlives the form.

    Withdrawing revalidates — the list has to stop showing it as on sale the
    moment it is not — and that re-render would otherwise unmount the panel
    carrying the one thing the operator needs. Fourth time this rule has
    decided a screen in this portal.
  */
  if (state.done) {
    const { upcomingDepartures, bookingsToHonour, guestsToHonour, note } =
      state.done;
    return (
      <Panel tone={bookingsToHonour > 0 ? "alert" : "done"} className="mt-4">
        <p className="text-base font-bold">Off sale</p>
        <p className="text-forest/80 mt-2 text-sm">
          {upcomingDepartures === 1
            ? "One upcoming departure has stopped being offered."
            : `${upcomingDepartures} upcoming departures have stopped being offered.`}{" "}
          Nothing was cancelled and nothing was refunded.
        </p>

        {/*
          The API's own sentence, VERBATIM — the contract asks for exactly that,
          and it is present only when there is something still owed. Paraphrasing
          the one line that stops an operator failing to turn up would be the
          worst possible place to improve the wording.
        */}
        {note ? (
          <p className="text-terra-deep mt-3 text-sm font-bold">{note}</p>
        ) : bookingsToHonour > 0 ? (
          <p className="text-terra-deep mt-3 text-sm font-bold">
            You still owe {bookingsToHonour}{" "}
            {bookingsToHonour === 1 ? "booking" : "bookings"} — {guestsToHonour}{" "}
            {guestsToHonour === 1 ? "guest" : "guests"}. Those trips still run.
          </p>
        ) : null}

        <p className="text-forest/70 mt-3 text-sm">
          To put it back in front of travellers, send a change — it goes through
          review, like any other.
        </p>
      </Panel>
    );
  }

  // Nothing to offer once it is off sale, and nothing to show if it never was.
  if (!selling) return null;

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        variant="secondary"
        className="mt-3"
      >
        Take it off sale
      </Button>
    );
  }

  return (
    /*
      Keyed on the attempt counter so the form REMOUNTS after a refusal and
      re-reads the defaults below. Without it React keeps the reset,
      uncontrolled inputs and the values handed back are never applied.
    */
    <form key={state.attempt ?? 0} action={action} className="mt-4 space-y-4">
      <input type="hidden" name="id" value={experienceId} />

      <Panel tone="alert">
        <p className="text-sm font-bold">
          This stops new bookings. It does not cancel the ones you have.
        </p>
        <p className="text-forest/80 mt-1.5 text-sm">
          Anybody already booked still expects their trip, and you still owe it
          to them. To cancel a departure and refund its travellers, call that
          departure off from Capacity instead — one at a time, each confirmed on
          its own.
        </p>
      </Panel>

      <fieldset>
        <legend className="label text-forest/75">
          Why are you taking it off sale?
        </legend>
        <div className="mt-2 space-y-2">
          {WITHDRAW_REASONS.map((reason) => (
            <label
              key={reason.code}
              className="border-cream-line rounded-control flex min-h-14 cursor-pointer items-center gap-3 border p-3"
            >
              <input
                type="radio"
                name="reasonCode"
                value={reason.code}
                defaultChecked={state.typed?.reasonCode === reason.code}
                className="accent-forest size-5 shrink-0"
              />
              <span className="text-sm">{reason.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label
          htmlFor={`withdraw-note-${experienceId}`}
          className="label text-forest/75"
        >
          Anything to add
        </label>
        <textarea
          id={`withdraw-note-${experienceId}`}
          name="note"
          rows={2}
          className={inputClass("mt-2")}
        />
        <p className="text-forest/70 mt-1.5 text-xs">Optional. We read it.</p>
      </div>

      <div>
        <label
          htmlFor={`withdraw-confirm-${experienceId}`}
          className="label text-forest/75"
        >
          Type this listing&rsquo;s id to confirm
        </label>
        {/*
          Not a checkbox. "A checkbox is one mis-tap on a wet phone away from
          taking a live listing off sale" — the same reason calling off a
          departure asks for the departure's own id.

          The id is shown right here because it is not something anybody has
          memorised, and hiding it would turn a confirmation into a puzzle.
        */}
        <p className="text-forest/70 mt-1.5 text-xs">
          <span className="font-mono">{experienceId}</span> — for {title}
        </p>
        <input
          id={`withdraw-confirm-${experienceId}`}
          name="confirmExperienceId"
          defaultValue={state.typed?.confirmExperienceId ?? ""}
          autoComplete="off"
          spellCheck={false}
          className={inputClass("mt-2 font-mono")}
        />
      </div>

      {state.message ? (
        <p role="alert" className="text-terra-deep text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending}
          variant="primary"
          block={false}
          className="flex-1"
        >
          {pending ? "Taking it off…" : "Take it off sale"}
        </Button>
        <Button
          type="button"
          onClick={() => setOpen(false)}
          variant="secondary"
          block={false}
        >
          Not now
        </Button>
      </div>
    </form>
  );
}
