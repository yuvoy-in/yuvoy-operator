"use client";

import { useActionState } from "react";
import { confirmSeats, type ConfirmSeatsState } from "@/app/calendar/actions";
import { Button } from "@/components/ui/button";
import { Panel, panelClass } from "@/components/ui/panel";

/**
 * Departures off sale because nobody confirmed their seats, and one tap to
 * confirm them all (yuvoy-operator#94 items 1 and 2).
 *
 * "Seats set by hand stop being offered to travellers once nobody has
 * confirmed them for two days." Sky diving had 19 of 20 departures off sale
 * for exactly this and no screen said so. The counts come from the listing
 * (`departuresNotOnSale`, `departuresGoingOffSaleSoon`); Home adds them up
 * across listings and sends no `experienceId`, a listing's hub sends its own.
 *
 * Always mounted where it is used, drawing nothing when there is nothing to
 * confirm, so its receipt survives the re-read that brings the counts to 0.
 */
export function ConfirmSeats({
  experienceId,
  notOnSale,
  goingOffSoon,
}: {
  /** One listing, or every listing when absent. */
  experienceId?: string;
  notOnSale: number;
  goingOffSoon: number;
}) {
  const [state, act, pending] = useActionState<ConfirmSeatsState, FormData>(
    confirmSeats,
    {},
  );

  if (state.confirmed !== undefined) {
    const n = state.confirmed;
    return (
      <Panel tone="done" role="status" className="p-4">
        <p className="text-base font-bold">
          {n === 0
            ? "Nothing needed confirming"
            : n === 1
              ? "Seats confirmed on 1 departure"
              : `Seats confirmed on ${n} departures`}
        </p>
        <p className="text-forest/80 mt-1.5 text-sm">
          {n === 0
            ? "Every departure in the next 12 months was already confirmed."
            : "Anything that was off sale only for this is back on sale. The seat counts are as they were."}
        </p>
      </Panel>
    );
  }

  if (notOnSale + goingOffSoon <= 0) return null;

  return (
    <form action={act} className={panelClass("alert", "p-4")}>
      {experienceId ? (
        <input type="hidden" name="experienceId" value={experienceId} />
      ) : null}
      <p className="text-base font-bold">
        {notOnSale > 0
          ? notOnSale === 1
            ? "1 departure is not on sale"
            : `${notOnSale} departures are not on sale`
          : goingOffSoon === 1
            ? "1 departure goes off sale within a day"
            : `${goingOffSoon} departures go off sale within a day`}
      </p>
      <p className="text-forest/80 mt-1.5 text-sm">
        {notOnSale > 0
          ? "Nobody has confirmed their seats for two days, so travellers cannot book them."
          : "Unless somebody confirms their seats, travellers stop being able to book them."}
        {notOnSale > 0 && goingOffSoon > 0
          ? ` ${goingOffSoon} more ${goingOffSoon === 1 ? "goes" : "go"} off sale within a day.`
          : ""}{" "}
        Confirming keeps the seat counts as they are.
      </p>
      {state.message ? (
        <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="mt-3">
        {pending ? "Confirming…" : "Confirm seats for the next 12 months"}
      </Button>
    </form>
  );
}
