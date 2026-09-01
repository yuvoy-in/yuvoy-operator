"use client";

import { useActionState, useState } from "react";
import { callOffDeparture, type CallOffState } from "./actions";
import { CALL_OFF_REASONS } from "@/lib/day/relay-types";
import { formatPaise } from "@/lib/format/money";

/**
 * This departure cannot run.
 *
 * The founding use case of the whole product — a storm handled from a phone —
 * and the only action in the portal that cannot be undone. It cancels the
 * departure, cancels every booking on it, refunds all of them **in full**,
 * releases the holds and tells everybody, in one transaction.
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
      <section className="rounded-edge border-terra-deep bg-cream-deep mt-10 border-2 p-5">
        {/*
          The banner at the top of the page already says the departure is off —
          it renders from the manifest, which the call-off revalidated. This
          panel is the receipt, so it leads with what the action DID rather
          than repeating the state.
        */}
        <h2 className="text-base font-bold">What that did</h2>
        <p className="text-forest/80 mt-2 text-sm">
          Everybody has been told and refunded in full.
        </p>
        <dl className="border-cream-line mt-4 grid grid-cols-2 gap-4 border-t pt-4">
          <Figure
            label="Bookings cancelled"
            value={String(r.bookingsCancelled)}
          />
          <Figure label="Guests affected" value={String(r.guestsAffected)} />
          <Figure label="Refunded" value={formatPaise(r.refundedPaise)} />
          <Figure label="Holds released" value={String(r.holdsReleased)} />
        </dl>
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
        Calling off a departure needs an owner or a manager.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="mt-10">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-edge dock-target label border-terra-deep text-terra-deep w-full border-2 px-5 font-bold"
        >
          This departure cannot run
        </button>
      </div>
    );
  }

  return (
    <form
      action={act}
      className="rounded-edge border-terra-deep mt-10 border-2 p-5"
    >
      <h2 className="text-base font-bold">Call off this departure</h2>
      <p className="text-forest/80 mt-2 text-sm">
        Everybody on it is cancelled and refunded <strong>in full</strong>, the
        holds are released, and everybody is told. This cannot be undone.
      </p>

      <input type="hidden" name="slotId" value={slotId} />

      <fieldset className="mt-5">
        <legend className="label text-forest/75">Why?</legend>
        <div className="mt-2 space-y-2">
          {CALL_OFF_REASONS.map((reason) => (
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
        <label htmlFor="call-off-note" className="label text-forest/75">
          Anything to add (optional)
        </label>
        <textarea
          id="call-off-note"
          name="note"
          rows={2}
          maxLength={500}
          className="rounded-edge border-cream-line bg-cream-deep mt-2 w-full border p-3 text-base"
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
          className="rounded-edge border-cream-line bg-cream-deep mt-2 h-14 w-full border px-4 font-mono text-base"
        />
      </div>

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <div className="mt-5 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-edge dock-target label border-terra-deep text-terra-deep flex-1 border-2 px-5 font-bold"
        >
          {pending ? "Cancelling…" : "Call it off"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-edge dock-target label border-cream-line bg-cream flex-1 border px-5"
        >
          Keep it
        </button>
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
