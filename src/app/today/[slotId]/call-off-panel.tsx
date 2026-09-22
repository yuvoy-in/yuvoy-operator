"use client";

import { useActionState, useState } from "react";
import { callOffDeparture, type CallOffState } from "./actions";
import { CALL_OFF_REASONS } from "@/lib/day/relay-types";
import { formatPaise } from "@/lib/format/money";
import { Button } from "@/components/ui/button";
import { choiceClass, inputClass, textareaClass } from "@/components/ui/input";
import { panelClass } from "@/components/ui/panel";

/**
 * This departure cannot run.
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
 */
export function CallOffPanel({
  slotId,
  alreadyCalledOff,
  canManage,
}: {
  slotId: string;
  alreadyCalledOff: boolean;
  canManage: boolean;
}) {
  const [state, act, pending] = useActionState<CallOffState, FormData>(
    callOffDeparture,
    {},
  );
  const [open, setOpen] = useState(false);

  if (state.result) {
    const r = state.result;
    return (
      <section className={panelClass("alert", "mt-10")}>
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
      <p className="text-forest/70 mt-10 text-sm">
        Calling off a departure needs an owner, an admin or a manager.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="mt-10">
        <Button onClick={() => setOpen(true)} variant="danger">
          This departure cannot run
        </Button>
      </div>
    );
  }

  return (
    <form action={act} className={panelClass("alert", "bg-paper mt-10")}>
      <h2 className="text-base font-bold">Call off this departure</h2>
      {/*
        The whole consequence, named before the tap (op#81 t5), including the
        part the call-off does not do: cash taken at the counter goes back
        from the operator's hand, not from us.
      */}
      <p className="text-forest/80 mt-2 text-sm">
        Every booking on it is cancelled and everything paid online is refunded{" "}
        <strong>in full</strong>. Holds are released and we message everyone
        booked. Anyone who paid you in cash gets it back from you. This cannot
        be undone.
      </p>

      <input type="hidden" name="slotId" value={slotId} />

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
        <label htmlFor="call-off-note" className="label text-forest/75">
          Anything to add (optional)
        </label>
        <textarea
          id="call-off-note"
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
        <label htmlFor="confirm-slot" className="label text-forest/75">
          Type the departure id to confirm
        </label>
        <p className="text-forest/70 mt-1 text-xs">
          It is <code className="font-mono font-bold">{slotId}</code>. Typing it
          is deliberate: a checkbox is one mis-tap away from cancelling a full
          boat.
        </p>
        <input
          id="confirm-slot"
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
          onClick={() => setOpen(false)}
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
