"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { closeDeparture, type CloseDepartureState } from "./actions";
import { BLACKOUT_REASONS } from "@/lib/day/capacity-types";
import { Button } from "@/components/ui/button";
import { choiceClass, textareaClass } from "@/components/ui/input";

/**
 * Stop selling ONE departure — yuvoy-operator#45 item 4.
 *
 * One component, and #56's "Stop selling" reuses it, because the act is the
 * same and a second confirmation written for the hub would be a second chance
 * to get the one sentence that matters wrong.
 *
 * ## That sentence
 *
 * **Closing is not cancelling people.** "The bookings on it still stand, and
 * `note` says so when there are any." An operator who believes closing
 * cancelled them does not turn up, and the people who paid are standing on a
 * jetty. It is said before the tap, and the API's own receipt is rendered
 * verbatim after it.
 *
 * ## Why this replaced "set its seats to what is already sold"
 *
 * That worked, and it read as a trick. It also left the departure looking full
 * to whoever read the row next, with nothing to distinguish it from a boat that
 * genuinely sold out.
 */
export function CloseDeparture({
  slotId,
  title,
  time,
  onClosed,
}: {
  slotId: string;
  title: string;
  /** The departure's own start time, in its own zone. */
  time: string;
  /**
   * Hands the receipt to the day's panel, which survives the refresh that
   * takes this departure out of the list it is in (op#89 f16).
   */
  onClosed: (title: string, note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState<CloseDepartureState, FormData>(
    closeDeparture,
    {},
  );
  const router = useRouter();

  const heading = `${time} ${title} is closed to new bookings`;
  /*
    Rendered verbatim, and it is the half that stops somebody not turning up:
    "present when `existingBookings` is above zero, and clients must render it
    verbatim."
  */
  const note =
    state.note ?? "Nobody was booked on it, so there is nobody to tell.";

  /*
    The day re-reads at once, so it stops showing this departure as selling.
    It used to wait for a tap on "Show the day", because the re-read drops the
    departure out of this list and took the receipt with it; the receipt is on
    the day's panel now.
  */
  useEffect(() => {
    if (!state.done) return;
    onClosed(heading, note);
    router.refresh();
    // `done` flips once; the rest is fixed for this departure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done]);

  // Said on the day's panel from here on; here too would say it twice.
  if (state.done) return null;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold">
          {time} {title}
        </span>
        <Button variant="outline" block={false} onClick={() => setOpen(true)}>
          Stop selling
        </Button>
      </div>
    );
  }

  return (
    <form action={act}>
      <input type="hidden" name="slotId" value={slotId} />
      <p className="text-sm font-bold">
        Stop selling {time} {title}?
      </p>
      <p className="text-forest/80 mt-1 text-sm">
        New bookings stop straight away. Anybody already on it stays booked, and
        the rest of the day keeps selling.
      </p>

      <fieldset className="mt-3">
        <legend className="label text-forest/75">Why</legend>
        <div className="mt-2 space-y-2">
          {BLACKOUT_REASONS.map((reason) => (
            <label key={reason.code} className={choiceClass(false)}>
              <input
                type="radio"
                name="reasonCode"
                value={reason.code}
                required
                className="accent-terra-deep size-5 shrink-0"
              />
              <span>{reason.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-3">
        <label
          htmlFor={`close-note-${slotId}`}
          className="label text-forest/75"
        >
          A note <span className="text-forest/70">(optional)</span>
        </label>
        <textarea
          id={`close-note-${slotId}`}
          name="note"
          rows={2}
          maxLength={500}
          className={textareaClass("mt-2")}
        />
      </div>

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <Button
          type="submit"
          block={false}
          className="flex-1"
          disabled={pending}
        >
          {pending ? "Closing…" : "Stop selling it"}
        </Button>
        <Button
          variant="secondary"
          block={false}
          className="flex-1"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Keep selling
        </Button>
      </div>
    </form>
  );
}
