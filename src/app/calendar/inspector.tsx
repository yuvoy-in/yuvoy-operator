import Link from "next/link";
import { RequestQueue } from "@/app/bookings/request-queue";
import { CallOffPanel } from "@/app/today/[slotId]/call-off-panel";
import { RelayPanel } from "@/app/today/[slotId]/relay-panel";
import type { RequestView } from "@/lib/day/request-view";
import { isHolding, type Manifest, type OperatorSlot } from "@/lib/day/types";
import { marketTime } from "@/lib/format/market-time";
import { shortDate } from "@/lib/home/words";
import { withFrom } from "@/lib/site/back-to";
import { CheckIcon } from "@/components/ui/icons";
import { DepartureControls } from "./departure-controls";
import { InspectorSheet } from "./inspector-sheet";

/** How many people the inspector names before it says "and N more". */
const NAMED = 8;

/**
 * Everything about one departure, over the board it was opened from
 * (operator experiment B): who is on it, the requests waiting on it, its
 * seats, a counter sale, a message to everyone booked, stopping it, and
 * calling it off, quiet and last. One place for a departure on ANY day the
 * board can show, which is what the fortnight never was (audit 5.1).
 *
 * The parties are the manifest's, read only when a departure is opened;
 * none of what the manifest keeps off a page (the screener) reaches this
 * one, which reads names, guests and whether they have arrived.
 */
export function DepartureInspector({
  slot,
  day,
  manifest,
  requests,
  here,
  closeHref,
  canManage,
  canWrite,
  canSellAtCounter,
}: {
  slot: OperatorSlot;
  /** The departure's market day, `YYYY-MM-DD`. */
  day: string;
  /** `null` when the manifest did not load: the rest still works. */
  manifest: Manifest | null;
  /** Seat requests waiting on this departure. */
  requests: RequestView[];
  /** The board's address with this departure open: every way back. */
  here: string;
  /** The board without it. */
  closeHref: string;
  /** OWNER, ADMIN or MANAGER. */
  canManage: boolean;
  /** `canManage`, on a business that is not suspended. */
  canWrite: boolean;
  /** Anybody signed in, on a business that is not suspended. */
  canSellAtCounter: boolean;
}) {
  const time = marketTime(slot.startsAt, slot.timezone);
  const calledOff = slot.status === "cancelled";
  const parties = (manifest?.parties ?? []).filter((p) => !isHolding(p));
  const named = parties.slice(0, NAMED);
  const meeting = manifest?.meetingPoint?.trim();

  return (
    <InspectorSheet title={`${time} ${slot.title}`} closeHref={closeHref}>
      <p className="text-forest/80 -mt-3 text-sm">
        {shortDate(day)}
        {meeting ? ` · ${meeting}` : ""}
      </p>

      <section aria-labelledby="inspector-who" className="mt-5">
        <h3 id="inspector-who" className="label text-forest/75">
          Who is on it
        </h3>
        {manifest === null ? (
          <p className="text-forest/80 mt-2 text-sm">
            Who is on it did not load. The manifest has them.
          </p>
        ) : parties.length === 0 ? (
          <p className="text-forest/80 mt-2 text-sm">Nobody booked yet</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {named.map((party) => (
              <li
                key={party.bookingId ?? party.reference}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <Link
                  href={withFrom(`/bookings/${party.bookingId}`, here)}
                  className="tap-target decoration-forest/40 hover:decoration-forest min-w-0 truncate font-bold underline underline-offset-4"
                >
                  {party.name}
                </Link>
                <span className="text-forest/80 flex shrink-0 items-center gap-1.5">
                  {party.guests ?? 0} {party.guests === 1 ? "guest" : "guests"}
                  {party.arrived ? (
                    <>
                      <CheckIcon className="size-4" />
                      <span className="sr-only">arrived</span>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
            {parties.length > NAMED ? (
              <li className="text-forest/80 text-sm">
                and {parties.length - NAMED} more on the manifest
              </li>
            ) : null}
          </ul>
        )}
      </section>

      {requests.length > 0 ? (
        <section aria-labelledby="inspector-asking" className="mt-6">
          <h3 id="inspector-asking" className="label text-forest/75">
            Asking for seats
          </h3>
          <div className="mt-2">
            <RequestQueue
              views={requests}
              empty="No requests waiting"
              canAnswer={canManage}
              canAccept={canWrite}
              pinPill={false}
            />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="inspector-seats" className="mt-6">
        <h3 id="inspector-seats" className="label text-forest/75">
          Seats and sales
        </h3>
        <div className="mt-2">
          <DepartureControls
            slot={slot}
            canManage={canWrite}
            canSellAtCounter={canSellAtCounter}
            from={here}
          />
        </div>
      </section>

      {!calledOff && parties.length > 0 ? (
        <section className="mt-6">
          <RelayPanel slotId={slot.id} who="everyone booked" />
        </section>
      ) : null}

      {/*
        Last, and quiet (yuvoy-operator#81): it cannot be taken back. Offered
        while suspended too, as on the departure itself: a business on hold
        can always stop a trip it has sold (#50).
      */}
      <CallOffPanel
        slotId={slot.id}
        alreadyCalledOff={calledOff}
        canManage={canManage}
        time={time}
        className="mt-8"
      />
    </InspectorSheet>
  );
}
