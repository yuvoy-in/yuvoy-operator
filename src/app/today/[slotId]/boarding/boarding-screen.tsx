"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { markAttendance } from "../actions";
import { PartyRow } from "../party-row";
import {
  boardable,
  boardingFlags,
  boardingOrder,
  cashToTake,
  headcount,
  matchesParty,
  type BoardingParty,
} from "@/lib/day/boarding";
import type { PartyForClient } from "@/lib/day/types";
import { formatPaise } from "@/lib/format/money";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import { CheckIcon, SunIcon } from "@/components/ui/icons";
import { inputClass } from "@/components/ui/input";
import { panelClass } from "@/components/ui/panel";
import { Sheet } from "@/components/ui/sheet";
import { useOnline } from "@/components/ui/use-online";
import { createCheckInStore, type CheckIn } from "./check-in-store";
import { SwipeRow } from "./swipe-row";

/** One party, as the server hands it to boarding. */
export interface BoardingRow {
  party: BoardingParty;
  /** The manifest's own party, screener stripped, for its full controls. */
  client: PartyForClient;
  /** Its booking, with boarding as the way back. */
  bookingHref: string;
}

const NONE: Readonly<Record<string, CheckIn>> = {};

/**
 * Boarding mode: the manifest built for the jetty at 06:00 (operator
 * experiment D, approved 3 Oct 2026 for the manifest; online first).
 *
 * One hand, bright sun, wet fingers. A headcount read at arm's length, a
 * search that takes a name or the last four of a reference, everybody still
 * to come on top with a 64px Aboard (and a swipe to the right as its twin),
 * and a checked-in party sinking into Aboard with five seconds to Undo it.
 * Tap a party for everything else about them: the cash, a message, the
 * booking, and after the boat has left, how it ended.
 *
 * Sun mode is on by default here: only weights, sizes and opacity rungs
 * move (see `globals.css`), never a colour.
 *
 * ## Online first (owner ruling, 3 Oct 2026)
 *
 * No signal is said before a tap, and nothing is kept on the phone to send
 * later: a check-in is sent or it is not, and the row says which.
 */
export function BoardingScreen({
  slotId,
  kicker,
  title,
  departed,
  calledOff,
  seats,
  rows,
  timezone,
  canManage,
  doneHref,
}: {
  slotId: string;
  /** "Boarding · 11:30 · Beach 3 dive hut". */
  kicker: string;
  /** "11:30 Try-dive at Nemo Reef". */
  title: string;
  departed: boolean;
  calledOff: boolean;
  /** "5 of 8 seats sold", from the day's departures, or null when unread. */
  seats: string | null;
  rows: BoardingRow[];
  timezone: string;
  canManage: boolean;
  /** Back to the departure. */
  doneHref: string;
}) {
  const router = useRouter();
  const online = useOnline();
  const [sun, setSun] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [store] = useState(() => createCheckInStore(slotId, markAttendance));
  const checkIns = useSyncExternalStore(store.subscribe, store.get, () => NONE);

  // The API has it: re-read, so the manifest says arrived and the time.
  useEffect(() => {
    store.onSent(() => router.refresh());
    return () => store.onSent(null);
  }, [store, router]);

  // Sent, never dropped, when the screen goes or the phone is put away.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") store.flush();
    };
    const onPageHide = () => store.flush();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      store.flush();
    };
  }, [store]);

  // Once the manifest shows somebody arrived, the phone's copy has done its job.
  useEffect(() => {
    for (const { party } of rows) {
      if (party.arrived && checkIns[party.bookingId])
        store.settle(party.bookingId);
    }
  }, [rows, checkIns, store]);

  const parties = rows.map((r) => r.party);
  const held = new Set(
    Object.entries(checkIns)
      .filter(([, c]) => c.phase !== "failed")
      .map(([id]) => id),
  );
  const { toCome, aboard } = boardingOrder(parties, held);
  const count = headcount(parties, held);
  const cash = cashToTake(parties);
  const byId = new Map(rows.map((r) => [r.party.bookingId, r]));
  const shown = (p: BoardingParty) => matchesParty(p, query);
  const opened = open ? byId.get(open) : undefined;
  const canCheckIn = online && !departed && !calledOff;

  const checkIn = useCallback(
    (id: string) => {
      if (canCheckIn) store.hold(id);
    },
    [canCheckIn, store],
  );

  return (
    <div data-sun={sun ? "on" : "off"} className="pb-28 lg:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="label text-forest/75">{kicker}</p>
          <h1 className="font-display tracking-display mt-1 text-3xl leading-tight">
            {title}
          </h1>
        </div>
        <button
          type="button"
          aria-pressed={sun}
          onClick={() => setSun((on) => !on)}
          className={cn(
            buttonClass({ variant: "secondary", size: "md", block: false }),
            "shrink-0 gap-1.5",
          )}
        >
          <SunIcon className="size-4" />
          Sun mode
        </button>
      </div>

      {/*
        The number read at arm's length: guests aboard of guests booked.
        Said again, politely, each time it moves.
      */}
      <p aria-live="polite" className="mt-6 flex items-baseline gap-2">
        <span className="font-display text-7xl leading-none tabular-nums">
          {count.aboard}
        </span>{" "}
        <span className="text-forest/80 text-2xl">of</span>{" "}
        <span className="font-display text-7xl leading-none tabular-nums">
          {count.booked}
        </span>{" "}
        <span className="text-2xl font-bold">aboard</span>
      </p>
      {/*
        Joined with real separators, not a flex gap: a gap is space to the
        eye and nothing to a screen reader, which read "2 parties to
        come₹9,000 to take".
      */}
      <p className="text-forest/80 mt-3 text-base">
        {[
          <span key="come">
            <b className="text-forest">{toCome.length}</b>{" "}
            {toCome.length === 1 ? "party to come" : "parties to come"}
          </span>,
          ...(cash !== null && cash > 0
            ? [
                <span key="cash">
                  <b className="text-forest">{formatPaise(cash)}</b> to take
                </span>,
              ]
            : []),
          ...(seats ? [<span key="seats">{seats}</span>] : []),
        ].flatMap((part, i) => (i === 0 ? [part] : [" · ", part]))}
      </p>

      {!online ? (
        <div role="status" className={panelClass("alert", "mt-5 p-4")}>
          <p className="text-terra-deep text-base font-bold">No signal</p>
          <p className="text-forest/80 mt-1 text-sm">
            Nothing you tap is saved until the signal is back. Who is aboard is
            as it was when this loaded.
          </p>
        </div>
      ) : null}

      {calledOff ? (
        <p className={panelClass("alert", "mt-5 p-4 text-base font-bold")}>
          This departure was called off. Nobody boards it.
        </p>
      ) : null}

      <div className="mt-5">
        <label htmlFor="boarding-find" className="sr-only">
          Find a party by name or the last four of their reference
        </label>
        <input
          id="boarding-find"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or last 4"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          className={inputClass("rounded-full")}
        />
      </div>

      {rows.length === 0 ? (
        <div className={panelClass("raised", "mt-5")}>
          <p className="text-base font-bold">Nobody is booked on this one.</p>
          <p className="text-forest/80 mt-1 text-sm">
            {departed
              ? "It left with nobody aboard."
              : "It stays on sale until bookings close."}
          </p>
        </div>
      ) : null}

      {query.trim() && rows.length > 0 && !parties.some(shown) ? (
        <p role="status" className="text-forest/80 mt-5 text-base">
          Nobody on this departure by that name or reference.
        </p>
      ) : null}

      {toCome.length > 0 ? (
        <section aria-labelledby="boarding-to-come" className="mt-6">
          <h2 id="boarding-to-come" className="label text-forest/75">
            {departed ? "To close out" : "To come"} · {toCome.length}
          </h2>
          <ul className="mt-2 space-y-2">
            {toCome.filter(shown).map((party) => {
              const row = byId.get(party.bookingId)!;
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
                <li key={party.bookingId}>
                  <SwipeRow
                    enabled={can}
                    onCommit={() => checkIn(party.bookingId)}
                  >
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
                        <span className="block text-lg leading-tight font-bold">
                          {party.name}
                        </span>
                        <span className="text-forest/80 block text-sm">
                          {party.guests === 1
                            ? "1 guest"
                            : `${party.guests} guests`}
                          {" · "}
                          <span className="tracking-wider slashed-zero tabular-nums">
                            {party.reference}
                          </span>
                        </span>
                        {flags.length > 0 ? (
                          <span className="text-terra-deep mt-0.5 block text-sm font-bold">
                            {flags.join(" · ")}
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
                    <p
                      role="alert"
                      className="text-terra-deep mt-1 px-1 text-sm font-bold"
                    >
                      {party.name}: {failed.message}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {aboard.length > 0 ? (
        <section aria-labelledby="boarding-aboard" className="mt-8">
          <h2 id="boarding-aboard" className="label text-forest/75">
            Aboard · {aboard.length}
          </h2>
          <ul className="mt-2 space-y-2">
            {aboard.filter(shown).map((party) => {
              const state = checkIns[party.bookingId];
              const holding = state?.phase === "holding";
              return (
                <li
                  key={party.bookingId}
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
                      <span className="block text-base leading-tight font-bold">
                        {party.name}
                      </span>
                      <span className="text-forest/80 block text-sm">
                        {party.guests === 1
                          ? "1 guest"
                          : `${party.guests} guests`}
                        {" · "}
                        {holding
                          ? "Checking in"
                          : state?.phase === "sending"
                            ? "Sending…"
                            : "Aboard"}
                      </span>
                    </span>
                  </button>
                  {holding ? (
                    <button
                      type="button"
                      onClick={() => store.undo(party.bookingId)}
                      className="border-forest/25 hover:border-forest dock-target label shrink-0 rounded-full border px-5 font-bold"
                    >
                      Undo
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* The way off this screen is at the foot, under the thumb. */}
      <div className="bg-paper border-paper-line fixed inset-x-0 bottom-0 z-30 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:static lg:mt-10 lg:border-0 lg:bg-transparent lg:p-0">
        <div className="mx-auto max-w-2xl">
          <Link href={doneHref} className={buttonClass({ className: "h-16" })}>
            {departed || calledOff ? "Done" : "Done boarding"}
          </Link>
        </div>
      </div>

      {opened ? (
        <Sheet
          title={opened.party.name}
          onClose={() => {
            setOpen(null);
            // What was done in the sheet (cash, a check-in) is on the API;
            // the list re-reads it rather than guessing.
            router.refresh();
          }}
        >
          <ul>
            <PartyRow
              party={opened.client}
              slotId={slotId}
              departed={departed}
              screening={opened.party.signal}
              cash={opened.party.cash}
              timezone={timezone}
              canManage={canManage}
              bookingHref={opened.bookingHref}
              unread={opened.party.unread}
            />
          </ul>
        </Sheet>
      ) : null}
    </div>
  );
}
