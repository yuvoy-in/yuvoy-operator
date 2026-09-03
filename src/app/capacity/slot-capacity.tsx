"use client";

import { useActionState, useState } from "react";
import {
  recordOfflineSale,
  setCapacity,
  type CapacityState,
  type OfflineSaleState,
} from "./actions";
import type { OperatorSlot } from "@/lib/day/types";
import { marketDay, marketTime } from "@/lib/format/market-time";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { inputClass } from "@/components/ui/input";
import { Panel, panelClass } from "@/components/ui/panel";

/**
 * One departure's capacity, and the counter sales against it.
 *
 * Two writes, deliberately far apart on the row: changing what is offered is
 * routine, and reporting a counter sale can turn out to be an incident.
 */
export function SlotCapacity({ slot }: { slot: OperatorSlot }) {
  const [seatsState, setSeats, savingSeats] = useActionState<
    CapacityState,
    FormData
  >(setCapacity, {});
  /*
    The counter-sale form is remounted for each sale. `useActionState` keeps
    its last result for the life of the component, so after one sale the
    receipt replaced the form for good — the second walk-up sale of the
    morning needed a navigation away and back. A new key is a new form.
  */
  const [round, setRound] = useState(0);

  return (
    <li className={panelClass()}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-2xl leading-none">
          {marketTime(slot.startsAt, slot.timezone)}
        </span>
        <Chip>{marketDay(slot.startsAt, slot.timezone)}</Chip>
      </div>
      <p className="mt-2 text-base font-bold">{slot.title}</p>
      <p className="text-forest/70 mt-1 text-sm">
        {slot.sold} of {slot.seats} sold · {slot.remaining} left
      </p>

      {/* ------------------------------------------------ seats offered -- */}
      <form action={setSeats} className="mt-4">
        <input type="hidden" name="slotId" value={slot.id} />
        {/*
          The sold count is sent so the floor can be checked before the round
          trip. The API enforces it regardless — this only saves an operator
          on a jetty from waiting to be told.
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
              would block the submit with a browser tooltip — "Value must be
              greater than or equal to 5" — and the operator would never see
              the reason. The contract asks clients to render its refusal copy
              verbatim because that copy says what to do instead, so the form
              has to be allowed to submit and be refused.
            */
            min={0}
            max={200}
            defaultValue={seatsState.seats ?? slot.seats}
            required
            className={inputClass("bg-cream w-28 text-lg")}
          />
          <Button
            type="submit"
            disabled={savingSeats}
            variant="outline"
            block={false}
            className="flex-1"
          >
            {savingSeats ? "Saving…" : "Set seats"}
          </Button>
        </div>
        <p className="text-forest/70 mt-1.5 text-xs">
          {slot.sold > 0
            ? `Cannot go below ${slot.sold} — that is what is already sold. Setting it to exactly ${slot.sold} closes the departure without stranding anyone.`
            : "Nothing sold yet, so this can be anything up to 200."}
        </p>

        {seatsState.message ? (
          <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
            {seatsState.message}
          </p>
        ) : null}
        {seatsState.seats !== undefined && !seatsState.message ? (
          <p className="text-forest/80 mt-2 text-sm font-bold">
            Now offering {seatsState.seats}.
          </p>
        ) : null}
      </form>

      {/* ------------------------------------------------ counter sales -- */}
      <CounterSale
        key={round}
        slot={slot}
        // "Record another sale" means another sale, not another button: the
        // fresh form opens straight onto the field.
        initiallyOpen={round > 0}
        onAgain={() => setRound((r) => r + 1)}
      />
    </li>
  );
}

function CounterSale({
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
      seat — so this renders as the incident it is, names the bookings,
      and carries the incident id somebody will quote.
    */
    return (
      <Panel tone="alert" className="bg-cream mt-5 p-4">
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
      <Panel tone="done" className="mt-5 p-4">
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
      <form action={sell} className="border-cream-line mt-5 border-t pt-4">
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
          className={inputClass("bg-cream mt-2 w-28 text-lg")}
        />
        <p className="text-forest/70 mt-1.5 text-xs">
          So we stop selling them. This is a report, not a request — it is
          recorded even if it oversells the boat, because refusing it would not
          un-sell the seats.
        </p>

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
    <Button
      onClick={() => setSellingOpen(true)}
      variant="secondary"
      className="mt-5"
    >
      I sold seats at my counter
    </Button>
  );
}
