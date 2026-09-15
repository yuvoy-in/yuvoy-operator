"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelBooking, type CancelState } from "@/app/bookings/cancel-actions";
import { CALL_OFF_REASONS } from "@/lib/day/relay-types";
import { formatPaise } from "@/lib/format/money";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { choiceClass, inputClass, textareaClass } from "@/components/ui/input";

/**
 * Cancelling one booking — yuvoy-operator#43 item 4.
 *
 * One component, used on the booking's own screen and reused by the manifest
 * row (#56), because the act is the same and the confirmation must not differ
 * between the two places somebody can reach it from.
 *
 * ## Why the reference is typed back
 *
 * The contract says it and gives the reason: `confirmReference` is "not a
 * boolean: this cannot be undone, and a checkbox is one mis-tap away from the
 * wrong party." On a manifest of eleven names, a confirm dialog with a button
 * is one wet thumb from cancelling somebody else's holiday and refunding it in
 * full. Typing `YV-4K2M9P7Q` cannot be done by accident.
 *
 * ## What the confirmation must say about money
 *
 * A card booking refunds everything paid online. A cash booking refunds
 * nothing, because nothing reached us — and if the business already took the
 * notes, the response says so and they are the ones holding them. Those are
 * opposite facts, so the copy is chosen by whether this is a cash booking
 * rather than being written to cover both.
 */
export function CancelBooking({
  bookingId,
  reference,
  isCash,
  onCancelled,
}: {
  bookingId: string;
  reference: string;
  /** A booking the traveller pays at the counter. Decides the money sentence. */
  isCash: boolean;
  /**
   * Called once the booking is cancelled, so a caller that is not a whole page
   * can react. The booking screen refreshes; #56's manifest row closes itself.
   */
  onCancelled?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState<CancelState, FormData>(
    cancelBooking,
    {},
  );
  const router = useRouter();

  /*
    Both outcomes reload, and `alreadyCancelled` is one of them: it is what a
    lost response on one bar of signal looks like, and the issue is explicit
    that "pressing again after it worked shows the booking as cancelled, not an
    error."

    `router.refresh()` rather than leaving it to `revalidatePath`: the action
    revalidates the route, but this component's caller may be a manifest row
    inside a page that has not re-fetched, and the returned figures have to stay
    on screen while the page behind them catches up.
  */
  const finished = Boolean(state.done || state.alreadyCancelled);

  if (finished) {
    return (
      <Panel tone="done" role="status" className="mt-4 p-4">
        <p className="text-base font-bold">This booking is cancelled</p>
        {state.done ? (
          <>
            <p className="text-forest/80 mt-2 text-sm">
              {formatPaise(state.done.refundedPaise)} refunded.{" "}
              {state.done.seatsReleased === 1
                ? "1 seat is back on the departure."
                : `${state.done.seatsReleased} seats are back on the departure.`}
            </p>
            {/*
              The API's own sentence, rendered verbatim. It is present only with
              `cashToGiveBackPaise` and it says the money is with the business
              and is theirs to hand back — which is the one thing a refund
              figure of ₹0 does not say.
            */}
            {state.done.note ? (
              <p className="text-forest/80 mt-2 text-sm">{state.done.note}</p>
            ) : null}
          </>
        ) : (
          /*
            Nothing to report, and that is the honest answer: "retrying after it
            worked answers `409 already_cancelled` and refunds nothing twice."
          */
          <p className="text-forest/80 mt-2 text-sm">
            It was already cancelled, and nothing was refunded twice.
          </p>
        )}
        <div className="mt-4">
          <Button
            variant="secondary"
            block={false}
            onClick={() => {
              onCancelled?.();
              router.refresh();
            }}
          >
            Show the booking
          </Button>
        </div>
      </Panel>
    );
  }

  if (!open) {
    return (
      <div className="mt-4">
        <Button variant="danger" onClick={() => setOpen(true)}>
          Cancel this booking
        </Button>
      </div>
    );
  }

  return (
    <form action={act} className="border-paper-line mt-4 border-t pt-4">
      <input type="hidden" name="bookingId" value={bookingId} />

      <p className="text-base font-bold">Cancel {reference}?</p>
      <p className="text-forest/80 mt-1.5 text-sm">
        {/*
          Opposite facts, so they are not merged. A cash booking refunds nothing
          because nothing reached us; saying "refunded in full" on one would
          promise a traveller money that was never taken.
        */}
        {isCash
          ? "Nothing is refunded online. Their seats go back on the departure."
          : "Everything they paid online is refunded in full. Their seats go back on the departure."}
      </p>

      <fieldset className="mt-4">
        <legend className="label text-forest/75">Why they cannot go</legend>
        <div className="mt-2 space-y-2">
          {CALL_OFF_REASONS.map((reason) => (
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

      <div className="mt-4">
        <label htmlFor="cancel-note" className="label text-forest/75">
          A note <span className="text-forest/70">(optional)</span>
        </label>
        <textarea
          id="cancel-note"
          name="note"
          rows={2}
          maxLength={500}
          aria-invalid={state.field === "note" || undefined}
          className={textareaClass("mt-2")}
        />
        {/*
          Said, because it changes what somebody writes. "Kept on the record of
          the cancellation. Never rendered into a message, the same rule as the
          relay" — an operator who thinks the traveller reads this writes a
          different note.
        */}
        <p className="text-forest/70 mt-1.5 text-xs">
          For your record. The traveller never sees it.
        </p>
      </div>

      <div className="mt-4">
        <label htmlFor="confirm-reference" className="label text-forest/75">
          Type {reference} to confirm
        </label>
        <input
          id="confirm-reference"
          name="confirmReference"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          required
          aria-invalid={state.field === "confirmReference" || undefined}
          className={inputClass("mt-2 font-mono")}
        />
        <p className="text-forest/70 mt-1.5 text-xs">
          Letter case and spaces do not matter. This cannot be undone.
        </p>
      </div>

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button
          type="submit"
          variant="danger"
          block={false}
          className="flex-1"
          disabled={pending}
        >
          {pending ? "Cancelling…" : "Cancel the booking"}
        </Button>
        <Button
          variant="secondary"
          block={false}
          className="flex-1"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Keep it
        </Button>
      </div>
    </form>
  );
}
