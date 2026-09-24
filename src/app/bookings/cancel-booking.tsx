"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelBooking, type CancelState } from "@/app/bookings/cancel-actions";
import { CALL_OFF_REASONS } from "@/lib/day/relay-types";
import { formatPaise } from "@/lib/format/money";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { useConfirmFocus } from "@/components/ui/use-confirm-focus";
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
 *
 * ## Quiet until it is asked for
 *
 * The control is text in the warning colour, not a pill (yuvoy-operator#81):
 * cancelling somebody's trip must not carry the weight of the safe action
 * beside it. The confirm it opens names what happens and carries the `danger`
 * pill. There is no heading over it any more: one control is not a group.
 */
export function CancelBooking({
  bookingId,
  reference,
  isCash,
  available = true,
  context = "booking",
  className = "mt-4",
  onDone,
}: {
  bookingId: string;
  reference: string;
  /** A booking the traveller pays at the counter. Decides the money sentence. */
  isCash: boolean;
  /**
   * Whether the booking can still be cancelled. The control stays MOUNTED when
   * it cannot, drawing nothing, so the receipt of a cancel survives the
   * refresh that follows it (the refreshed page no longer offers the cancel).
   */
  available?: boolean;
  /**
   * Where it sits, which decides what happens after a cancel (op#89 f16):
   *
   *   `booking`   its own page. The page behind the receipt re-reads at once,
   *               so "Collect ₹15,000" and "Cash taken" do not sit under the
   *               words "This booking is cancelled".
   *   `manifest`  a row. The row puts its other controls away (`onDone`), and
   *               "Update the list" re-reads it. Re-reading at once would take
   *               the row, and the receipt with it, straight off the list.
   */
  context?: "booking" | "manifest";
  /** Space above the control, which differs between a page and a row. */
  className?: string;
  /** Called once, when the booking is cancelled. */
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { trigger, question } = useConfirmFocus(open);
  /*
    Per booking: a manifest can hold several of these open at once, and two
    `id="cancel-note"` fields would give two labels one field (the audit, O11).
  */
  const ids = useId();
  const [state, act, pending] = useActionState<CancelState, FormData>(
    cancelBooking,
    {},
  );
  const router = useRouter();

  /*
    Both outcomes count as done, and `alreadyCancelled` is one of them: it is
    what a lost response on one bar of signal looks like, and the issue is
    explicit that "pressing again after it worked shows the booking as
    cancelled, not an error."

    `router.refresh()` rather than leaving it to `revalidatePath`: the action
    does not revalidate, because a re-render that dropped this control would
    drop its receipt too. The booking page keeps this control mounted
    (`available`), so it can re-read underneath it.
  */
  const finished = Boolean(state.done || state.alreadyCancelled);
  useEffect(() => {
    if (!finished) return;
    onDone?.();
    if (context === "booking") router.refresh();
    // `finished` flips once, from false to true; the rest are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  if (finished) {
    return (
      <Panel tone="done" role="status" className={cn(className, "p-4")}>
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
        {context === "manifest" ? (
          <div className="mt-4">
            <Button
              variant="secondary"
              block={false}
              onClick={() => router.refresh()}
            >
              Update the list
            </Button>
          </div>
        ) : null}
      </Panel>
    );
  }

  if (!available) return null;

  if (!open) {
    return (
      <div className={className}>
        <Button
          ref={trigger}
          variant="danger-quiet"
          size="md"
          block={false}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          Cancel this booking
        </Button>
      </div>
    );
  }

  return (
    <form
      action={act}
      className={cn(className, "border-paper-line border-t pt-4")}
    >
      <input type="hidden" name="bookingId" value={bookingId} />

      <p
        ref={question}
        tabIndex={-1}
        className="text-base font-bold outline-none"
      >
        Cancel {reference}?
      </p>
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
        <label htmlFor={`${ids}-note`} className="label text-forest/75">
          A note <span className="text-forest/70">(optional)</span>
        </label>
        <textarea
          id={`${ids}-note`}
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
        <label htmlFor={`${ids}-reference`} className="label text-forest/75">
          Type {reference} to confirm
        </label>
        <input
          id={`${ids}-reference`}
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
