"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  DECLINE_REASONS,
  declineSentence,
  type DeclineReason,
} from "@/lib/day/request-types";
import type { RequestView } from "@/lib/day/request-view";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ClockIcon, TicketIcon } from "@/components/ui/icons";
import type { RowRef } from "./answer-rows";

/**
 * One seat request, answered on the card it arrives on: Home and Bookings
 * draw this same card (operator experiment A, audit 5.3).
 *
 * Who first, because a person is waiting on the other end: the name and the
 * party lead, then the trip, then the two clocks (the countdown chip and the
 * time it runs out), then what is left to give. Accept and Decline are both
 * 56px, side by side, for a wet thumb.
 *
 * ## Declining shows what they will read
 *
 * Declining is two steps, because it is cheap for the operator and final for
 * the traveller. The second step names the reason AND shows the sentence the
 * API will send for it, word for word (`declineSentence`), so "No seats left"
 * is chosen knowing the traveller reads "The operator is full on that
 * departure. Nothing was charged."
 *
 * The card does not send anything itself: Accept and Decline hand the answer
 * to the list's store, which holds it for five seconds with an Undo
 * (`answer-store.ts`).
 */
export function RequestCard({
  view,
  kind,
  canAnswer,
  canAccept,
  onAccept,
  onDecline,
  message,
  seeBusiness,
  focus,
  rowRef,
}: {
  view: RequestView;
  /** "Seat request", on a list that holds other kinds of card. */
  kind?: string;
  /**
   * OWNER, ADMIN or MANAGER. The contract refuses the write, not the read, so
   * a STAFF login keeps disabled buttons rather than live ones the server
   * refuses: "a banner and a working button disagree, and the one that gets
   * believed is the button".
   */
  canAnswer: boolean;
  /** Whether Accept is drawn: withheld while suspended, Decline never is (#50). */
  canAccept: boolean;
  onAccept: () => void;
  onDecline: (reason: DeclineReason) => void;
  /** Why the last answer did not go, said on the card it came from. */
  message?: string;
  /** The way out of that refusal is the Business screen (#28). */
  seeBusiness?: boolean;
  /** The button to put focus back on, after an Undo brought the card back. */
  focus?: "accept" | "decline";
  /** The card's `<li>`, for the list that plays a swap to and from it. */
  rowRef?: RowRef;
}) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<DeclineReason | null>(view.preset);
  const accept = useRef<HTMLButtonElement>(null);
  const decline = useRef<HTMLButtonElement>(null);
  const group = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    const target = focus === "accept" ? accept.current : decline.current;
    if (focus) target?.focus({ preventScroll: true });
  }, [focus]);

  /*
    Into the reasons when they open, on the chosen one when the card already
    knew it (a party too big for the boat), so a keyboard lands where the
    choice is rather than on a button that has gone.
  */
  useEffect(() => {
    if (!declining) return;
    const radios = group.current;
    const target =
      radios?.querySelector<HTMLInputElement>("input:checked") ??
      radios?.querySelector<HTMLInputElement>("input");
    target?.focus({ preventScroll: true });
  }, [declining]);

  const name = `reason-${view.id}`;
  const clock = (
    <Chip tone={view.urgent ? "accent" : "neutral"}>
      <ClockIcon className="size-3.5" />
      {view.clock}
    </Chip>
  );

  return (
    <li
      ref={rowRef}
      aria-label={`Seat request from ${view.name}`}
      className={cn(
        "rounded-card bg-paper-deep border p-4 sm:p-5",
        view.urgent ? "border-terra-deep border-2" : "border-paper-line",
      )}
    >
      {/*
        The clock rides the top line: beside the card's kind where a list mixes
        kinds (Home), beside the traveller where every card is a request
        (Bookings), so it never sits on a line of its own.
      */}
      {kind ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="label text-forest/75 flex items-center gap-1.5">
              <TicketIcon className="size-4" />
              {kind}
            </p>
            {clock}
          </div>
          <p className="mt-2 text-lg leading-snug font-bold">{view.title}</p>
        </>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-lg leading-snug font-bold">{view.title}</p>
          {clock}
        </div>
      )}
      <p className="text-forest/80 mt-1 text-sm">{view.trip}</p>
      {view.asked ? (
        <p className="text-forest/80 mt-1 text-sm">{view.asked}</p>
      ) : null}
      <p
        className={cn(
          "mt-2 text-sm",
          view.short ? "text-terra-deep font-bold" : "text-forest/80",
        )}
      >
        {view.seats}
      </p>

      {declining ? (
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason) onDecline(reason);
          }}
        >
          <fieldset ref={group}>
            <legend className="label text-forest/75">Why?</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DECLINE_REASONS.map((r) => (
                <label
                  key={r.code}
                  className={cn(
                    "inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 py-2 text-sm",
                    "ease-interaction transition-colors duration-200",
                    "has-focus-visible:outline-terra-deep has-focus-visible:outline-2 has-focus-visible:outline-offset-2",
                    reason === r.code
                      ? "border-forest bg-forest text-paper"
                      : "border-paper-line bg-paper hover:border-forest/40",
                  )}
                >
                  <input
                    type="radio"
                    name={name}
                    value={r.code}
                    checked={reason === r.code}
                    onChange={() => setReason(r.code)}
                    required
                    className="sr-only"
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>

          {reason ? (
            <div
              aria-live="polite"
              className="rounded-control border-paper-line bg-paper mt-3 border p-3"
            >
              <p className="label text-forest/75">{view.firstName} reads</p>
              <p className="mt-1 text-sm">{declineSentence(reason)}</p>
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button type="submit" variant="danger" disabled={!reason}>
              Decline
            </Button>
            <Button variant="secondary" onClick={() => setDeclining(false)}>
              Not now
            </Button>
          </div>
        </form>
      ) : (
        <div
          className={cn(
            "mt-4 grid gap-2",
            canAccept ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          {canAccept ? (
            <Button
              ref={accept}
              onClick={onAccept}
              // Past the ceiling the API answers 409; the card said why above.
              disabled={!canAnswer || view.short}
            >
              Accept
            </Button>
          ) : null}
          <Button
            ref={decline}
            variant="secondary"
            onClick={() => setDeclining(true)}
            disabled={!canAnswer}
          >
            Decline
          </Button>
        </div>
      )}

      {message ? (
        <div role="alert" className="mt-3">
          <p className="text-terra-deep text-sm font-bold">{message}</p>
          {seeBusiness ? (
            <Link
              href="/account/verification"
              className="text-forest tap-target mt-1 text-sm underline underline-offset-4"
            >
              See what is outstanding
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
