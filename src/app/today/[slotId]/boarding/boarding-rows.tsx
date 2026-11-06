"use client";

import {
  boardable,
  boardingFlags,
  type BoardingParty,
} from "@/lib/day/boarding";
import { buttonClass } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";
import { UndoWindow } from "@/components/ui/undo-window";
import { HOLD_MS, type CheckIn, type CheckInStore } from "./check-in-store";
import { SwipeRow } from "./swipe-row";

/**
 * One party still to come (or to close out): its name, guests, reference and
 * flags, with Aboard and the swipe as its twin. Moved out of
 * `boarding-screen.tsx` unchanged.
 */
export function ToComeRow({
  party,
  checkIns,
  canCheckIn,
  departed,
  setOpen,
  checkIn,
}: {
  party: BoardingParty;
  checkIns: Readonly<Record<string, CheckIn>>;
  canCheckIn: boolean;
  departed: boolean;
  setOpen: (id: string) => void;
  checkIn: (id: string) => void;
}) {
  const failed = checkIns[party.bookingId];
  const flags = boardingFlags(party);
  const spoken = [
    party.name,
    party.guests === 1 ? "1 guest" : `${party.guests} guests`,
    `reference ${party.reference}`,
    ...flags,
  ].join(", ");
  const can = canCheckIn && boardable(party);
  return (
    <li data-party={party.bookingId} data-flip="">
      <SwipeRow enabled={can} onCommit={() => checkIn(party.bookingId)}>
        <div
          className={panelClass(
            "raised",
            "flex min-h-[4.5rem] items-center gap-3 px-4 py-2",
          )}
        >
          <button
            type="button"
            onClick={() => setOpen(party.bookingId)}
            aria-label={`${spoken}. Open`}
            className="min-w-0 flex-1 py-1 text-left"
          >
            <span className="block text-lg leading-tight font-bold text-balance">
              {party.name}
            </span>
            <span className="text-forest/80 block text-sm">
              {party.guests === 1 ? "1 guest" : `${party.guests} guests`}
              {/*
                The reference moves down whole rather than
                breaking at its own hyphen ("YV-" / "CANCEL2B"
                at 320px): it is what an operator reads
                against a phone at the jetty. An inline block
                still wraps inside if it is ever wider than
                the column, so it can never overflow.
              */}
              {"\u00a0· "}
              <span className="tracking-ref inline-block max-w-full slashed-zero tabular-nums">
                {party.reference}
              </span>
            </span>
            {flags.length > 0 ? (
              <span className="text-terra-deep mt-0.5 block text-sm font-bold">
                {flags.join("\u00a0· ")}
              </span>
            ) : null}
          </button>
          {departed ? (
            <button
              type="button"
              onClick={() => setOpen(party.bookingId)}
              aria-label={`Close out ${party.name}`}
              className={buttonClass({
                variant: "secondary",
                block: false,
                className: "h-16 shrink-0",
              })}
            >
              Close out
            </button>
          ) : (
            <button
              type="button"
              onClick={() => checkIn(party.bookingId)}
              disabled={!can}
              aria-label={`Aboard: check in ${party.name}`}
              className={buttonClass({
                block: false,
                className: "h-16 shrink-0 gap-1.5",
              })}
            >
              <CheckIcon className="size-5" />
              Aboard
            </button>
          )}
        </div>
      </SwipeRow>
      {failed?.phase === "failed" ? (
        <p role="alert" className="text-terra-deep mt-1 px-1 text-sm font-bold">
          {party.name}: {failed.message}
        </p>
      ) : null}
    </li>
  );
}

/**
 * One party aboard, with Undo for the five seconds a check-in is held.
 * Moved out of `boarding-screen.tsx` unchanged.
 */
export function AboardRow({
  party,
  checkIns,
  keptHere,
  store,
  move,
  setOpen,
}: {
  party: BoardingParty;
  checkIns: Readonly<Record<string, CheckIn>>;
  keptHere: ReadonlySet<string>;
  store: CheckInStore;
  move: (id: string) => void;
  setOpen: (id: string) => void;
}) {
  const state = checkIns[party.bookingId];
  const holding = state?.phase === "holding";
  return (
    <li
      data-party={party.bookingId}
      data-flip=""
      className={panelClass(
        "done",
        "flex min-h-16 items-center gap-3 px-4 py-2",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(party.bookingId)}
        className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left"
      >
        <CheckIcon className="size-6 shrink-0" />
        <span className="min-w-0">
          <span className="block text-base leading-tight font-bold text-balance">
            {party.name}
          </span>
          <span className="text-forest/80 block text-sm">
            {party.guests === 1 ? "1 guest" : `${party.guests} guests`}
            {"\u00a0· "}
            {holding
              ? "Checking in"
              : state?.phase === "sending"
                ? "Sending…"
                : keptHere.has(party.bookingId)
                  ? "Saved on this phone"
                  : "Aboard"}
          </span>
        </span>
      </button>
      {holding ? (
        <button
          type="button"
          onClick={() => {
            if (store.undo(party.bookingId)) {
              move(party.bookingId);
            }
          }}
          className="border-forest/25 hover:border-forest dock-target text-button relative shrink-0 rounded-full border px-5 font-bold"
        >
          Undo
          {/*
          The five seconds in which Undo still works, as a
          hairline that empties under the word (O07 A).
        */}
          <UndoWindow
            until={state.until}
            hold={HOLD_MS}
            className="inset-x-5 bottom-2 h-0.5"
          />
        </button>
      ) : null}
    </li>
  );
}
