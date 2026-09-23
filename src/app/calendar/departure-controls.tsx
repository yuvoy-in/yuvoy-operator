"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { setCapacity, type CapacityState } from "./actions";
import { CloseDeparture } from "./close-departure";
import { CounterSale } from "./counter-sale";
import type { OperatorSlot } from "@/lib/day/types";
import { seatsUnconfirmed } from "@/lib/day/off-sale";
import { marketTime } from "@/lib/format/market-time";
import { helpHref } from "@/lib/help/types";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";

/**
 * Everything inside an opened departure on the calendar (yuvoy-operator#84
 * s7).
 *
 * Every departure used to be an open form: a seat box, a Set seats button and
 * a counter-sales button repeated for each one, which is how a fortnight came
 * to be about thirty phone screens long. The controls now sit behind the
 * departure's own row and are drawn only when somebody opens it.
 *
 * ## In the order an operator reaches for them
 *
 *   1. What is sold and how it sells, and why it is not on sale when it is not
 *      (the API's own sentence).
 *   2. "Who is booked": the way into the departure itself.
 *   3. Confirm the seats, as the one primary button, only when that is what
 *      is keeping it off sale.
 *   4. The seat count, then a counter sale.
 *   5. Stop selling, last and quiet, because it is the destructive one.
 *
 * A staff login gets 1 and 2: every write here is OWNER, ADMIN or MANAGER, and
 * a control the API would refuse is not offered.
 */
export function DepartureControls({
  slot,
  canManage,
}: {
  slot: OperatorSlot;
  /** OWNER, ADMIN or MANAGER, on a business that is not suspended. */
  canManage: boolean;
}) {
  /*
    The counter-sale form is remounted for each sale: `useActionState` keeps
    its last result for the life of the component, so after one sale the
    receipt would replace the form for good. A new key is a new form.
  */
  const [round, setRound] = useState(0);
  const calledOff = slot.status === "cancelled";
  const time = marketTime(slot.startsAt, slot.timezone);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5 text-sm">
        <p className="text-forest/80">
          {slot.sold} of {slot.seats} sold · {slot.remaining} left
          {/*
            How it sells, as a fact rather than a paragraph. Said only when the
            API says which: defaulting to instant booking would claim held
            seats on a departure holding none.
          */}
          {slot.bookingMode === "allotment"
            ? " · Instant booking"
            : slot.bookingMode === "request"
              ? " · You answer each request"
              : ""}
        </p>
        {/*
          Why it is not selling, in the API's own sentence: "render this when you
          meet a reason you do not recognise", and for the ones this build does
          know it is still the best sentence available. It changes what somebody
          does next, which is why it is the one sentence that stays.
        */}
        {slot.onSale === false && slot.notOnSaleDetail ? (
          <p className="text-forest/90">{slot.notOnSaleDetail}</p>
        ) : null}
      </div>

      {/*
        The way to the departure itself: who is booked on it, telling them
        something, and calling it off. "Who is booked", not "Who is booked, and
        calling it off" (yuvoy-operator#96 item 6): a label that scans.
      */}
      <Link
        href={`/today/${slot.id}`}
        className="text-forest decoration-forest/40 inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4"
      >
        Who is booked
      </Link>

      {canManage && !calledOff ? (
        <>
          <ConfirmDepartureSeats slot={slot} />
          <SeatsForm slot={slot} />
          <CounterSale
            key={round}
            slot={slot}
            // "Record another sale" means another sale, not another button:
            // the fresh form opens straight onto the field.
            initiallyOpen={round > 0}
            onAgain={() => setRound((r) => r + 1)}
          />
          <CloseDeparture
            slotId={slot.id}
            title={slot.title}
            time={time}
            available={slot.status === "open"}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * Confirm one departure's seats, as they are (yuvoy-operator#94).
 *
 * "Seats set by hand stop being offered to travellers once nobody has
 * confirmed them for two days." Saving the count again is that confirmation
 * ("the same confirmation that saving a seat count with `PATCH /slots/{id}`
 * makes"), so this is the seat form with the number it already has, named for
 * what it does.
 *
 * Mounted for every departure that is still selling, drawing nothing unless
 * the seats are what keeps it off sale. After the re-read puts it back on
 * sale the receipt is still here, because the component never unmounted.
 */
export function ConfirmDepartureSeats({ slot }: { slot: OperatorSlot }) {
  const [state, act, pending] = useActionState<CapacityState, FormData>(
    setCapacity,
    {},
  );

  if (state.seats !== undefined && !state.message) {
    return (
      <p role="status" className="text-sm font-bold">
        {state.seats === 1
          ? "1 seat confirmed as it was."
          : `${state.seats} seats confirmed as they were.`}
      </p>
    );
  }

  if (!seatsUnconfirmed(slot)) return null;

  return (
    <form action={act}>
      <input type="hidden" name="slotId" value={slot.id} />
      <input type="hidden" name="seats" value={slot.seats} />
      <input type="hidden" name="sold" value={slot.sold} />
      <Button type="submit" disabled={pending}>
        {pending
          ? "Confirming…"
          : slot.seats === 1
            ? "Confirm 1 seat"
            : `Confirm ${slot.seats} seats`}
      </Button>
      {/*
        What confirming means is not obvious from the word, and it is not a
        decision anybody should make blind, so it is one tap away in help
        rather than a paragraph under every departure (#80 t4).
      */}
      <Link
        href={helpHref("confirming-seats")}
        className="text-forest/80 decoration-forest/40 mt-1 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
      >
        Why seats need confirming
      </Link>
      {state.message ? (
        <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/**
 * One departure's seat count.
 *
 * The refusal is the point: "you cannot reduce a departure below what is
 * already sold." The floor is said under the box, and the API's own 409
 * copy is rendered verbatim when it refuses, because it says what to do
 * instead.
 */
export function SeatsForm({ slot }: { slot: OperatorSlot }) {
  const [state, act, saving] = useActionState<CapacityState, FormData>(
    setCapacity,
    {},
  );

  return (
    <form action={act}>
      <input type="hidden" name="slotId" value={slot.id} />
      {/*
        The sold count is sent so the floor can be checked before the round
        trip. The API enforces it regardless; this only saves an operator on a
        jetty from waiting to be told.
      */}
      <input type="hidden" name="sold" value={slot.sold} />

      <label htmlFor={`seats-${slot.id}`} className="label text-forest/75">
        Seats offered
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id={`seats-${slot.id}`}
          name="seats"
          type="number"
          inputMode="numeric"
          /*
            Deliberately NOT `min={slot.sold}`. Native constraint validation
            would block the submit with a browser tooltip ("Value must be
            greater than or equal to 5") and the operator would never see the
            reason. The contract asks clients to render its refusal copy
            verbatim, because that copy says what to do instead.
          */
          min={0}
          max={200}
          defaultValue={state.seats ?? slot.seats}
          required
          aria-describedby={
            slot.sold > 0 ? `seats-floor-${slot.id}` : undefined
          }
          className={inputClass("bg-paper w-28 text-lg")}
        />
        <Button
          type="submit"
          disabled={saving}
          variant="outline"
          block={false}
          className="flex-1"
        >
          {saving ? "Saving…" : "Set seats"}
        </Button>
      </div>
      {/*
        The floor, because it changes the number somebody types. The rest of
        what this box used to say is in help.
      */}
      {slot.sold > 0 ? (
        <p
          id={`seats-floor-${slot.id}`}
          className="text-forest/70 mt-1.5 text-xs"
        >
          {slot.sold} already sold, so it cannot go lower.
        </p>
      ) : null}

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
          {state.message}
        </p>
      ) : null}
      {state.seats !== undefined && !state.message ? (
        <p role="status" className="text-forest/80 mt-2 text-sm font-bold">
          Now offering {state.seats}.
        </p>
      ) : null}
    </form>
  );
}
