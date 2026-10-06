"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { CashCollect } from "@/app/bookings/cash-collect";
import type { CashNeed, CashParty } from "@/lib/home/needs";
import { Button } from "@/components/ui/button";
import { BanknoteIcon } from "@/components/ui/icons";
import { LinkRing } from "@/components/ui/link-pending";
import { panelClass } from "@/components/ui/panel";

/**
 * Cash to take on a departure today, taken party by party on Home
 * (operator experiment A). It used to be a row that opened the departure.
 *
 * Each party is the same `CashCollect` the manifest and the booking draw:
 * one button naming the amount, and "They paid a different amount" for the
 * rest, recorded once and never overwritten.
 *
 * ## A taken payment keeps its line
 *
 * The server re-reads Home on every focus and every minute, and a party
 * whose cash is recorded leaves the list it sends. A party THIS card
 * recorded is kept, so "₹4,500 taken · 09:04" stays where the button was
 * instead of the row vanishing; a party paid on another phone simply goes,
 * because a stale "Take" here would invite a second recording.
 */
export function CashCard({
  need,
  onTouch,
}: {
  need: CashNeed;
  /** Told when the card is opened, so the list keeps it after a re-read. */
  onTouch: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [taken, setTaken] = useState<Record<string, CashParty>>({});

  const recorded = useCallback((party: CashParty) => {
    setTaken((was) =>
      was[party.bookingId] ? was : { ...was, [party.bookingId]: party },
    );
  }, []);

  // The server's parties in its order, and the ones taken here that it dropped.
  const present = new Set(need.parties.map((p) => p.bookingId));
  const parties = [
    ...need.parties,
    ...Object.values(taken).filter((p) => !present.has(p.bookingId)),
  ];

  return (
    <li
      aria-label="Cash to take"
      className={panelClass("raised", "p-4 sm:p-5")}
    >
      <p className="label text-forest/75 flex items-center gap-1.5">
        <BanknoteIcon className="size-4" />
        Cash to take
      </p>
      <p className="mt-2 text-lg leading-snug font-bold text-balance">
        {need.text}
      </p>
      {/* The departure in its host's words, the count in ours (v3.2). */}
      <p className="text-forest/80 mt-1 text-sm">
        <span className="voice-host">{need.experience}</span>
        {` · ${need.partyCount}`}
      </p>

      {open ? (
        parties.length === 0 ? (
          <p role="status" className="mt-4 text-sm font-bold">
            Nothing left to take on this departure.
          </p>
        ) : (
          <ul className="mt-2">
            {parties.map((party) => (
              <PartyCash
                key={party.bookingId}
                party={party}
                need={need}
                onRecorded={recorded}
              />
            ))}
          </ul>
        )
      ) : (
        <div className="mt-4">
          <Button
            variant="secondary"
            onClick={() => {
              onTouch();
              setOpen(true);
            }}
          >
            Take it party by party
          </Button>
        </div>
      )}

      <Link
        href={`/today/${need.slotId}`}
        className="text-forest tap-target mt-3 text-sm font-bold underline underline-offset-4"
      >
        Open the departure
        <LinkRing />
      </Link>
    </li>
  );
}

function PartyCash({
  party,
  need,
  onRecorded,
}: {
  party: CashParty;
  need: CashNeed;
  onRecorded: (party: CashParty) => void;
}) {
  const told = useCallback(() => onRecorded(party), [onRecorded, party]);
  return (
    <li className="border-paper-line border-t pt-3 first:border-t-0">
      <p className="text-base font-bold text-balance">{party.name}</p>
      <p className="text-forest/80 text-sm">
        <span className="tracking-ref slashed-zero tabular-nums">
          {party.reference}
        </span>
        {" · "}
        {party.guests} {party.guests === 1 ? "guest" : "guests"}
      </p>
      <CashCollect
        bookingId={party.bookingId}
        slotId={need.slotId}
        state={party.state}
        cash={party.cash}
        timezone={need.timezone}
        emphasis="primary"
        onRecorded={told}
      />
    </li>
  );
}
