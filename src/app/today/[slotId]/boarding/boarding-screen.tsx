"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
import { useChrome } from "@/components/chrome/chrome-context";
import { KeptOnThisPhone } from "@/components/chrome/kept-on-this-phone";
import { offlineWrites, writesFor } from "@/lib/site/offline-writes";
import { DURATION } from "@/lib/motion";
import {
  dropLifted,
  fadeIn,
  lift,
  slideFrom,
  topsOf,
  type Lifted,
  type Tops,
} from "@/lib/motion/flip";
import { MeasureBefore } from "@/lib/motion/measure-before";
import { Roll } from "@/components/ui/roll";
import { UndoWindow } from "@/components/ui/undo-window";
import { createCheckInStore, HOLD_MS, type CheckIn } from "./check-in-store";
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
 * ## With no signal (operator experiment D; owner go-ahead, 4 Oct 2026)
 *
 * It shipped online first (owner ruling, 3 Oct 2026). Now a check-in, and the
 * cash taken in a party's sheet, are kept on this phone when they cannot be
 * sent and go when the signal is back, from whichever screen is open (the
 * API makes both safe to send twice). The strip says what is kept and, once
 * sent, when, and who had already been done from somewhere else. Closing out,
 * messages and cancelling wait for the signal. See `KeptOnThisPhone`.
 *
 * ## Where the party went (O07 A, approved 4 Oct 2026)
 *
 * A tap on Aboard (or the swipe) used to move the row into Aboard in one
 * frame, from under the thumb into a list usually below the fold. Now the
 * eye can follow it: the row fades out of To come (100ms, a held copy drawn
 * where it was) while the rows under it close up, it fades in at its place
 * in Aboard (150ms, from 100ms) while the rows there make room (each slide
 * 200ms on `--ease-move`, measured before the commit), and the headcount
 * rolls up (`Roll`). Undo plays the same the other way. A hairline under
 * Undo empties across the five seconds in which it still works. What
 * arrives from the server (a party checked in on another phone) lands as it
 * always has. Under reduced motion nothing slides or rolls: the row and the
 * count cross-fade in 120ms, and the hairline steps once a second. Sun mode
 * is untouched.
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
  const { userId } = useChrome();
  const [sun, setSun] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [store] = useState(() => createCheckInStore(slotId, markAttendance));
  // Kept as the person signed in; with nobody known, it fails instead.
  useEffect(() => {
    store.onKeep(
      userId
        ? (bookingId, tappedAt) => {
            offlineWrites.add({
              kind: "arrived",
              userId,
              slotId,
              bookingId,
              at: tappedAt,
            });
            return true;
          }
        : null,
    );
    return () => store.onKeep(null);
  }, [store, userId, slotId]);
  const checkIns = useSyncExternalStore(store.subscribe, store.get, () => NONE);
  const kept = useSyncExternalStore(
    offlineWrites.subscribe,
    offlineWrites.list,
    offlineWrites.serverList,
  );
  const keptHere = new Set(
    writesFor(kept, userId, slotId)
      .filter((w) => w.kind === "arrived")
      .map((w) => w.bookingId),
  );

  // The API has it: re-read, so the manifest says arrived and the time.
  useEffect(() => {
    store.onSent(() => {
      if (navigator.onLine) router.refresh();
    });
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
  const held = new Set([
    ...Object.entries(checkIns)
      .filter(([, c]) => c.phase !== "failed")
      .map(([id]) => id),
    ...keptHere,
  ]);
  const { toCome, aboard } = boardingOrder(parties, held);
  const count = headcount(parties, held);
  const cash = cashToTake(parties);
  const byId = new Map(rows.map((r) => [r.party.bookingId, r]));
  const shown = (p: BoardingParty) => matchesParty(p, query);
  const opened = open ? byId.get(open) : undefined;
  // With no signal it is kept on the phone, as the person signed in.
  const canCheckIn = (online || Boolean(userId)) && !departed && !calledOff;

  /*
    The party the operator just moved between the lists, and a count of
    moves, which is what the motion watches: a move is the one change here
    that is shown travelling (see above).
  */
  const [moved, setMoved] = useState<{ id: string; n: number } | null>(null);
  const move = useCallback((id: string) => {
    setMoved((was) => ({ id, n: (was?.n ?? 0) + 1 }));
  }, []);

  const checkIn = useCallback(
    (id: string) => {
      if (!canCheckIn) return;
      // Already on its way: a second tap moves nothing, so nothing is shown moving.
      const phase = store.get()[id]?.phase;
      if (phase === "sending" || phase === "sent") return;
      move(id);
      store.hold(id);
    },
    [canCheckIn, store, move],
  );

  const board = useRef<HTMLDivElement>(null);
  /** The row a party is drawn in now, in whichever list. */
  const rowOf = (id: string | undefined) =>
    Array.from(
      board.current?.querySelectorAll<HTMLElement>("li[data-party]") ?? [],
    ).find((li) => li.dataset.party === id) ?? null;

  return (
    <div ref={board} data-sun={sun ? "on" : "off"} className="pb-28 lg:pb-0">
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

      <KeptOnThisPhone
        slotId={slotId}
        timezone={timezone}
        names={Object.fromEntries(
          rows.map((r) => [r.party.bookingId, r.party.name]),
        )}
      >
        {/*
        The number read at arm's length: guests aboard of guests booked.
        Said again, politely, each time it moves.
      */}
        <p aria-live="polite" className="mt-6 flex items-baseline gap-2">
          <span className="font-display text-7xl leading-none tabular-nums">
            <Roll value={count.aboard} />
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

        <MeasureBefore<{ tops: Tops; lifted: Lifted | null }>
          watch={moved?.n ?? 0}
          capture={() => ({
            tops: topsOf(
              board.current?.querySelectorAll<HTMLElement>("[data-flip]") ?? [],
            ),
            lifted: lift(rowOf(moved?.id)),
          })}
          apply={({ tops, lifted }) => {
            slideFrom(tops);
            if (lifted && board.current) {
              dropLifted(lifted, board.current, DURATION.press);
            }
            // In after the copy has gone out, so it never lands on rows
            // still closing up.
            const row = rowOf(moved?.id);
            if (row) fadeIn(row, DURATION.press);
          }}
        >
          {toCome.length > 0 ? (
            <section aria-labelledby="boarding-to-come" className="mt-6">
              <h2
                id="boarding-to-come"
                data-flip=""
                className="label text-forest/75"
              >
                {departed ? "To close out" : "To come"} · {toCome.length}
              </h2>
              <ul className="mt-2 space-y-2">
                {toCome.filter(shown).map((party) => {
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
                    <li
                      key={party.bookingId}
                      data-party={party.bookingId}
                      data-flip=""
                    >
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
              <h2
                id="boarding-aboard"
                data-flip=""
                className="label text-forest/75"
              >
                Aboard · {aboard.length}
              </h2>
              <ul className="mt-2 space-y-2">
                {aboard.filter(shown).map((party) => {
                  const state = checkIns[party.bookingId];
                  const holding = state?.phase === "holding";
                  return (
                    <li
                      key={party.bookingId}
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
                          className="border-forest/25 hover:border-forest dock-target label relative shrink-0 rounded-full border px-5 font-bold"
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
                })}
              </ul>
            </section>
          ) : null}
        </MeasureBefore>

        {/* The way off this screen is at the foot, under the thumb. */}
        <div className="bg-paper border-paper-line fixed inset-x-0 bottom-0 z-30 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:static lg:mt-10 lg:border-0 lg:bg-transparent lg:p-0">
          <div className="mx-auto max-w-2xl">
            <Link
              href={doneHref}
              className={buttonClass({ className: "h-16" })}
            >
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
              // the list re-reads it rather than guessing. Not with no signal:
              // a refresh that cannot be fetched becomes the browser's "no
              // internet" page.
              if (navigator.onLine) router.refresh();
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
      </KeptOnThisPhone>
    </div>
  );
}
