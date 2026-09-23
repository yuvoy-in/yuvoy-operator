"use client";

import { useActionState, useState } from "react";
import { callOffDeparture, type CallOffState } from "./actions";
import { CALL_OFF_REASONS } from "@/lib/day/relay-types";
import { formatPaise } from "@/lib/format/money";
import { Button } from "@/components/ui/button";
import { choiceClass, inputClass, textareaClass } from "@/components/ui/input";
import { panelClass } from "@/components/ui/panel";
import { cn } from "@/lib/cn";

/**
 * Calling a departure off: "Call this departure off", the words used
 * everywhere else in the product (yuvoy-operator#88 s3). It read "This
 * departure cannot run".
 *
 * The founding use case of the whole product — a storm handled from a phone —
 * and the only action in the portal that cannot be undone. It cancels the
 * departure, cancels every booking on it, refunds everything paid online **in
 * full**, releases the holds and messages everyone booked, in one
 * transaction. Cash taken at the counter is not refunded by anybody but the
 * operator, and both the confirmation and the receipt say so (op#95).
 *
 * Two things about the design are not decoration:
 *
 * **The confirmation is the departure's own id, typed.** Not a checkbox. "A
 * checkbox is one mis-tap on a wet phone away from cancelling a full boat."
 *
 * **The numbers come back.** Somebody who has just cancelled fourteen people's
 * day should see that it happened, and how much money went back — otherwise
 * the most consequential action in the product ends in silence.
 *
 * **Quiet until it is asked for** (yuvoy-operator#81 t5). It sat alone at the
 * foot of the manifest in the same shape as every other control. It is text
 * in the warning colour now, and the confirm it opens names the departure and
 * what happens to the people on it, over the loud button.
 */
export function CallOffPanel({
  slotId,
  alreadyCalledOff,
  canManage,
  time,
  startOpen = false,
  onKeep,
  className = "mt-10",
}: {
  slotId: string;
  alreadyCalledOff: boolean;
  canManage: boolean;
  /** The departure's own start time, "09:00", which the confirm names. */
  time?: string;
  /**
   * Opens on the confirm, for a screen that already asked (the listing hub's
   * Manage row), so nobody taps "call off" twice to reach it.
   */
  startOpen?: boolean;
  /** Where "Keep it" goes when the screen that opened this should close it. */
  onKeep?: () => void;
  /**
   * The space above it: the foot of a manifest wants a gap, a row on the
   * listing hub does not.
   */
  className?: string;
}) {
  const [state, act, pending] = useActionState<CallOffState, FormData>(
    callOffDeparture,
    {},
  );
  const [open, setOpen] = useState(startOpen);

  if (state.result) {
    const r = state.result;
    return (
      <section className={panelClass("alert", className)}>
        {/*
          The banner at the top of the page already says the departure is off —
          it renders from the manifest, which the call-off revalidated. This
          panel is the receipt, so it leads with what the action DID rather
          than repeating the state.
        */}
        <h2 className="text-base font-bold">What that did</h2>
        {/*
          It said "Everybody has been told and refunded in full". Neither half
          is the call-off's to promise: the refund is everything paid ONLINE,
          and a traveller who paid at the counter gets nothing back from us.
        */}
        <p className="text-forest/80 mt-2 text-sm">
          Every booking on it is cancelled, and everything paid online goes back
          in full.
        </p>
        <dl className="border-paper-line mt-4 grid grid-cols-2 gap-4 border-t pt-4">
          <Figure
            label="Bookings cancelled"
            value={String(r.bookingsCancelled)}
          />
          <Figure label="Guests affected" value={String(r.guestsAffected)} />
          <Figure
            label="Refunded online"
            value={formatPaise(r.refundedPaise)}
          />
          <Figure label="Holds released" value={String(r.holdsReleased)} />
        </dl>
        {r.giveBack ? (
          <div className="border-paper-line mt-4 border-t pt-4">
            <p className="text-terra-deep text-base font-bold">
              You are holding {formatPaise(r.giveBack.totalPaise)} in cash
            </p>
            <p className="text-forest/80 mt-1.5 text-sm">
              {r.giveBack.parties.length === 1
                ? "1 party paid you at the counter, so nothing of theirs reached us to refund."
                : `${r.giveBack.parties.length} parties paid you at the counter, so nothing of theirs reached us to refund.`}{" "}
              Hand it back, then record it on the list at the top of this
              departure.
            </p>
          </div>
        ) : null}
      </section>
    );
  }

  if (alreadyCalledOff) return null;

  /*
    STAFF cannot call this off. Saying so up front beats letting somebody type
    a departure id and then read a 403 — the contract refuses the write, and
    the person needs to go and find an owner, not retry.
  */
  if (!canManage) {
    return (
      <p className={cn("text-forest/70 text-sm", className)}>
        Calling off a departure needs an owner, an admin or a manager.
      </p>
    );
  }

  if (!open) {
    return (
      <div className={className}>
        <Button
          onClick={() => setOpen(true)}
          variant="danger-quiet"
          size="md"
          block={false}
        >
          Call this departure off
        </Button>
      </div>
    );
  }

  return (
    <form
      action={act}
      className={panelClass("alert", cn("bg-paper", className))}
    >
      <h2 className="text-base font-bold">
        {time ? `Call off ${time}?` : "Call off this departure?"}
      </h2>
      {/*
        The whole consequence, named before the tap (op#81 t5), including the
        part the call-off does not do: cash taken at the counter goes back
        from the operator's hand, not from us (op#95).
      */}
      <p className="text-forest/80 mt-2 text-sm">
        Everyone booked is cancelled, and everything paid online is refunded{" "}
        <strong>in full</strong>. Anyone who paid you in cash gets it back from
        you. We message everyone booked. This cannot be undone.
      </p>

      <input type="hidden" name="slotId" value={slotId} />
      {/*
        Ids carry the departure: the listing hub can hold one of these open on
        more than one row, and a repeated id gives two labels one field.
      */}

      <fieldset className="mt-5">
        <legend className="label text-forest/75">Why?</legend>
        <div className="mt-2 space-y-2">
          {CALL_OFF_REASONS.map((reason) => (
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
        <label
          htmlFor={`call-off-note-${slotId}`}
          className="label text-forest/75"
        >
          Anything to add (optional)
        </label>
        <textarea
          id={`call-off-note-${slotId}`}
          name="note"
          rows={2}
          maxLength={500}
          className={textareaClass("mt-2")}
        />
        <p className="text-forest/70 mt-1.5 text-xs">
          Shown on their booking page. Never sent to a phone.
        </p>
      </div>

      <div className="mt-4">
        <label
          htmlFor={`confirm-slot-${slotId}`}
          className="label text-forest/75"
        >
          Type the departure id to confirm
        </label>
        {/*
          The id, because nobody has it memorised. Why it is typed rather than
          ticked is the design's reason, not the operator's, and it went.
        */}
        <p className="text-forest/70 mt-1 text-xs">
          It is <code className="font-mono font-bold">{slotId}</code>.
        </p>
        <input
          id={`confirm-slot-${slotId}`}
          name="confirmSlotId"
          type="text"
          autoComplete="off"
          required
          className={inputClass("mt-2 font-mono")}
        />
      </div>

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <div className="mt-5 flex gap-2">
        <Button
          type="submit"
          disabled={pending}
          variant="danger"
          block={false}
          className="flex-1"
        >
          {pending ? "Cancelling…" : "Call it off"}
        </Button>
        <Button
          onClick={() => (onKeep ? onKeep() : setOpen(false))}
          variant="secondary"
          block={false}
          className="flex-1"
        >
          Keep it
        </Button>
      </div>
    </form>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label text-forest/70">{label}</dt>
      <dd className="font-display mt-1 text-2xl leading-none">{value}</dd>
    </div>
  );
}
