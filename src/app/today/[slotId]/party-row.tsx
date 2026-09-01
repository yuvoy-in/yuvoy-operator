"use client";

import { useActionState } from "react";
import { markAttendance, type AttendanceState } from "./actions";
import { isHolding, type Party } from "@/lib/day/types";
import { cn } from "@/lib/cn";
import { RelayPanel } from "./relay-panel";

/**
 * One party on the manifest.
 *
 * Wet hands in sunlight. Every target is 56px, the state is legible without
 * reading — a filled row is arrived — and the reference is set in a mono face
 * at a size that survives being read aloud across a dock, because `reference`
 * is the only thing that matches a walking-up human to a row.
 *
 * There is no phone number here and there is nowhere to put one. See O12.
 */
export function PartyRow({
  party,
  slotId,
  departed,
}: {
  party: Party;
  slotId: string;
  /** Terminal outcomes are refused before the departure time. */
  departed: boolean;
}) {
  const [state, act, pending] = useActionState<AttendanceState, FormData>(
    markAttendance,
    {},
  );

  const holding = isHolding(party);
  const arrived = Boolean(party.arrived);
  const settled = party.state === "completed" || party.state === "no_show";

  return (
    <li
      className={cn(
        "rounded-edge border p-4",
        arrived
          ? "border-forest bg-forest/5"
          : "border-cream-line bg-cream-deep",
        holding && "border-dashed",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-lg font-bold">{party.name}</p>
        <p className="text-forest/70 text-sm">
          {party.guests} {party.guests === 1 ? "guest" : "guests"}
        </p>
      </div>

      <p className="text-forest/70 mt-1 font-mono text-sm tracking-wider">
        {party.reference}
      </p>

      {holding ? (
        <p className="text-terra-deep mt-3 text-sm font-bold">
          Still paying. Not a confirmed seat yet — they may still turn up.
        </p>
      ) : settled ? (
        <p className="text-forest/70 mt-3 text-sm font-bold">
          {party.state === "completed" ? "Completed" : "No-show"}
        </p>
      ) : (
        <form action={act} className="mt-4 flex flex-wrap gap-2">
          <input type="hidden" name="bookingId" value={party.bookingId ?? ""} />
          <input type="hidden" name="slotId" value={slotId} />

          {/*
            `arrived` is idempotent server-side — "a second tap on a wet phone
            keeps the first arrival time and is not an error somebody has to
            read while eleven people wait" — so the button stays live rather
            than disabling, and simply reads as done.
          */}
          <button
            type="submit"
            name="outcome"
            value="arrived"
            disabled={pending}
            className={cn(
              "rounded-edge dock-target label flex-1 px-5 font-bold",
              arrived
                ? "bg-forest text-cream"
                : "border-forest text-forest border-2",
            )}
          >
            {arrived ? "Here ✓" : "Here"}
          </button>

          {/*
            Terminal outcomes appear only once the trip has set off. The API
            refuses them before then (409 departure_has_not_started), and
            offering a button that will be refused is how an operator learns to
            distrust the screen.
          */}
          {departed ? (
            <>
              <button
                type="submit"
                name="outcome"
                value="completed"
                disabled={pending}
                className="rounded-edge dock-target label border-cream-line bg-cream flex-1 border px-5"
              >
                Completed
              </button>
              <button
                type="submit"
                name="outcome"
                value="no_show"
                disabled={pending}
                className="rounded-edge dock-target label border-cream-line bg-cream flex-1 border px-5"
              >
                No-show
              </button>
            </>
          ) : null}
        </form>
      )}

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      {/*
        Reaching one traveller. There is no phone number here and never will
        be — `reference` identifies them, the relay reaches them (O12). A hold
        has no bookingId, so there is nobody to address yet.
      */}
      {holding ? null : (
        <RelayPanel
          slotId={slotId}
          bookingId={party.bookingId}
          who={party.name ?? "them"}
        />
      )}
    </li>
  );
}
