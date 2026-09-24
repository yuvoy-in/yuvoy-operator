"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { closeDeparture, type CloseDepartureState } from "./actions";
import { BLACKOUT_REASONS } from "@/lib/day/capacity-types";
import { Button } from "@/components/ui/button";
import { useConfirmFocus } from "@/components/ui/use-confirm-focus";
import { choiceClass, textareaClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * Stop selling ONE departure — yuvoy-operator#45 item 4.
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
 *
 * ## Quiet, and inside the departure (yuvoy-operator#84 s7, #81)
 *
 * It lives in the departure's own opened row now, not in a list under the
 * day, and it is text in the warning colour until it is asked for: stopping a
 * sale is destructive, so it is demoted below the seat controls and its
 * confirm carries the loud button.
 *
 * The receipt is kept HERE. The departure stays in its day after it closes, so
 * this component stays mounted through the re-read that turns the row Closed:
 * `available` goes false and the receipt is still what it draws.
 *
 * The listing hub opens it straight on the question (#85 s8), from its own
 * Manage row, so the one confirm serves both screens.
 */
export function CloseDeparture({
  slotId,
  title,
  time,
  available,
  startOpen = false,
  onKeep,
  onBusyChange,
}: {
  slotId: string;
  title: string;
  /** The departure's own start time, in its own zone. */
  time: string;
  /** Whether it is still selling, so there is anything to stop. */
  available: boolean;
  /** Opens on the question, for a screen that already asked which act. */
  startOpen?: boolean;
  /** Where "Keep selling" goes when the screen that opened this closes it. */
  onKeep?: () => void;
  /**
   * Told while the close is running, so a screen that can take this away
   * holds it until the receipt is in (the audit, O8).
   */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const { trigger, question } = useConfirmFocus(open);
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
    The day re-reads at once, so the departure's row stops saying it sells.
    The action does not revalidate, because a re-render used to take the
    receipt with it; the receipt stays here now, and the refresh only moves
    the row underneath it.
  */
  useEffect(() => {
    if (!state.done) return;
    router.refresh();
    // `done` flips once; the rest is fixed for this departure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done]);

  useEffect(() => {
    onBusyChange?.(pending);
  }, [pending, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  if (state.done) {
    return (
      <Panel tone="done" role="status" className="p-4">
        <p className="text-sm font-bold">{heading}</p>
        <p className="text-forest/80 mt-1 text-sm">{note}</p>
      </Panel>
    );
  }

  if (!available) return null;

  if (!open) {
    return (
      <div>
        <Button
          ref={trigger}
          variant="danger-quiet"
          size="md"
          block={false}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          Stop selling
        </Button>
      </div>
    );
  }

  return (
    <form action={act} className="border-paper-line border-t pt-4">
      <input type="hidden" name="slotId" value={slotId} />
      <p
        ref={question}
        tabIndex={-1}
        className="text-sm font-bold outline-none"
      >
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
          className={textareaClass("bg-paper mt-2")}
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
          variant="danger"
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
          onClick={() => (onKeep ? onKeep() : setOpen(false))}
        >
          Keep selling
        </Button>
      </div>
    </form>
  );
}
