"use client";

import { useActionState, useState } from "react";
import { recordOfflineSale, type OfflineSaleState } from "./actions";
import type { OperatorSlot } from "@/lib/day/types";
import { Button } from "@/components/ui/button";
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
  const [sellingOpen, setSellingOpen] = useState(initiallyOpen);

  const oversold = saleState.result?.oversold;

  const again = (
    <Button onClick={onAgain} variant="secondary" className="mt-4">
      Record another sale
    </Button>
  );

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
