"use client";

import { useActionState, useState } from "react";
import {
  recordOfflineSale,
  takeBackOfflineSale,
  type OfflineSaleState,
  type TakeBackState,
} from "./actions";
import type { OperatorSlot } from "@/lib/day/types";
import { Button } from "@/components/ui/button";
import { useConfirmFocus } from "@/components/ui/use-confirm-focus";
import { inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * Seats sold at the operator's own counter, reported so we stop selling them.
 *
 * Remounted for each sale by its parent: `useActionState` keeps its last
 * result for the life of the component, so after one sale the receipt
 * replaced the form for good and the second walk-up sale of the morning needed
 * a navigation away and back. A new key is a new form.
 *
 * What a counter sale is and why an oversell is still recorded is in help
 * (yuvoy-operator#80 t4). The form keeps the one thing it must say: an
 * oversell is an incident, never a tick.
 *
 * ## "That was a mistake" (yuvoy-api#226, op#89 f12)
 *
 * The receipt is the one screen that knows a wrong count was just recorded,
 * so the correction lives on it: a mistyped 20 instead of 2 takes the whole
 * boat and refuses every accept on the departure. It is quiet text behind a
 * confirm that names what happens, because taking back a sale that was real
 * puts seats on sale that somebody is already sitting in (#81). Once taken
 * back, the receipt says the new state and the old controls go (#89 f16).
 *
 * Offered to everybody who may record one, which is everybody signed in, and
 * only when the API returned the entry's `id`: an older API did not, and then
 * there is nothing the undo could name.
 */
export function CounterSale({
  slot,
  initiallyOpen,
  onAgain,
}: {
  slot: OperatorSlot;
  initiallyOpen: boolean;
  /** Another sale to record: a fresh form, not the last receipt. */
  onAgain: () => void;
}) {
  const [saleState, sell, selling] = useActionState<OfflineSaleState, FormData>(
    recordOfflineSale,
    {},
  );
  const [takeState, takeBack, takingBack] = useActionState<
    TakeBackState,
    FormData
  >(takeBackOfflineSale, {});
  const [sellingOpen, setSellingOpen] = useState(initiallyOpen);

  const oversold = saleState.result?.oversold;
  const saleId = saleState.result?.id;

  const again = (
    <Button onClick={onAgain} variant="secondary" className="mt-4">
      Record another sale
    </Button>
  );

  if (takeState.result) {
    const taken = takeState.result;
    return (
      <Panel tone="done" role="status" className="p-4">
        {"already" in taken ? (
          <p className="text-sm font-bold">
            Already taken back. Its seats are on sale again.
          </p>
        ) : (
          <>
            <p className="text-sm font-bold">
              {seatCount(taken.seatsTakenBack)} taken back and on sale again
            </p>
            <p className="text-forest/80 mt-1.5 text-sm">
              {taken.seatsRemaining} left for us to sell ·{" "}
              {taken.totalSoldOffline} sold at the counter in total.
            </p>
          </>
        )}
        {/*
          An incident the sale raised stays open whatever happens here: "if
          the report left travellers without a seat when you made it, that
          happened, and somebody at our end closes it" (yuvoy-api#226).
        */}
        {oversold?.incidentId ? (
          <p className="text-forest/80 mt-1.5 text-sm">
            Incident {oversold.incidentId} stays open until we close it.
          </p>
        ) : null}
        {again}
      </Panel>
    );
  }

  const undo =
    saleId && saleState.result ? (
      <TakeBack
        slotId={slot.id}
        saleId={saleId}
        seats={saleState.result.seatsRecorded}
        incident={Boolean(oversold)}
        state={takeState}
        act={takeBack}
        pending={takingBack}
      />
    ) : null;

  if (oversold) {
    /*
      The one screen in the portal where a green tick would be actively
      harmful. `oversold` present means travellers who paid us now have no
      seat, so this renders as the incident it is, names the bookings, and
      carries the incident id somebody will quote.
    */
    return (
      <Panel tone="alert" className="bg-paper p-4">
        <p className="text-terra-deep text-base font-bold">
          This oversold the departure
        </p>
        <p className="text-forest/90 mt-2 text-sm">
          {oversold.message ||
            `${oversold.guests} ${oversold.guests === 1 ? "guest" : "guests"} who paid us no longer have a seat.`}
        </p>
        {oversold.bookings.length > 0 ? (
          <>
            <p className="label text-forest/75 mt-3">Bookings affected</p>
            <ul className="mt-1.5 space-y-1">
              {oversold.bookings.map((ref) => (
                <li key={ref} className="font-mono text-sm tracking-wider">
                  {ref}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {oversold.incidentId ? (
          <p className="text-forest/70 mt-3 text-xs">
            Incident {oversold.incidentId}. Yuvoy has been told. Quote that if
            you call.
          </p>
        ) : null}
        <p className="text-forest/90 mt-3 text-sm font-bold">
          The sale was still recorded. Sort the seats out before the boat
          leaves.
        </p>
        {undo}
        {again}
      </Panel>
    );
  }

  if (saleState.result) {
    return (
      <Panel tone="done" className="p-4">
        <p className="text-sm font-bold">
          {saleState.result.seatsRecorded} recorded at your counter
        </p>
        <p className="text-forest/80 mt-1.5 text-sm">
          {saleState.result.seatsRemaining} left for us to sell ·{" "}
          {saleState.result.totalSoldOffline} sold at the counter in total.
        </p>
        {undo}
        {again}
      </Panel>
    );
  }

  if (sellingOpen) {
    return (
      <form action={sell} className="border-paper-line border-t pt-4">
        <input type="hidden" name="slotId" value={slot.id} />
        <label htmlFor={`offline-${slot.id}`} className="label text-forest/75">
          Seats you sold at your counter
        </label>
        <input
          id={`offline-${slot.id}`}
          name="seats"
          type="number"
          inputMode="numeric"
          min={1}
          max={200}
          required
          className={inputClass("bg-paper mt-2 w-28 text-lg")}
        />

        {saleState.message ? (
          <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
            {saleState.message}
          </p>
        ) : null}

        <div className="mt-4 flex gap-2">
          <Button
            type="submit"
            disabled={selling}
            block={false}
            className="flex-1"
          >
            {selling ? "Recording…" : "Record it"}
          </Button>
          <Button
            onClick={() => setSellingOpen(false)}
            variant="secondary"
            block={false}
            className="flex-1"
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <Button onClick={() => setSellingOpen(true)} variant="secondary">
      I sold seats at my counter
    </Button>
  );
}

function seatCount(n: number): string {
  return n === 1 ? "1 seat" : `${n} seats`;
}

/**
 * The correction, asked before it is sent.
 *
 * Quiet text until tapped, then a question that says what happens: the seats
 * go back on sale on Yuvoy straight away, and an incident the sale raised is
 * not withdrawn by it. The loud button is inside the question, never outside.
 */
function TakeBack({
  slotId,
  saleId,
  seats,
  incident,
  state,
  act,
  pending,
}: {
  slotId: string;
  saleId: string;
  /** What the entry recorded, so the question names it. */
  seats: number;
  /** Whether the sale oversold the departure and raised an incident. */
  incident: boolean;
  state: TakeBackState;
  act: (form: FormData) => void;
  pending: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const { trigger, question } = useConfirmFocus(asking);

  if (!asking) {
    return (
      <div className="mt-3">
        <Button
          ref={trigger}
          variant="danger-quiet"
          size="md"
          block={false}
          aria-expanded={false}
          onClick={() => setAsking(true)}
        >
          That was a mistake
        </Button>
      </div>
    );
  }

  return (
    <form action={act} className="border-paper-line mt-4 border-t pt-4">
      <input type="hidden" name="slotId" value={slotId} />
      <input type="hidden" name="saleId" value={saleId} />
      <p
        ref={question}
        tabIndex={-1}
        className="text-sm font-bold outline-none"
      >
        Take back the {seatCount(seats)} you just recorded?
      </p>
      <p className="text-forest/80 mt-1 text-sm">
        {seats === 1 ? "It goes" : "They go"} back on sale straight away. Only
        do this if {seats === 1 ? "it was" : "they were"} not sold.
        {incident ? " The incident stays open until we close it." : ""}
      </p>
      {state.message ? (
        <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
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
          {pending
            ? "Taking back…"
            : seats === 1
              ? "Take it back"
              : "Take them back"}
        </Button>
        <Button
          variant="secondary"
          block={false}
          className="flex-1"
          disabled={pending}
          onClick={() => setAsking(false)}
        >
          {seats === 1 ? "Keep it" : "Keep them"}
        </Button>
      </div>
    </form>
  );
}
