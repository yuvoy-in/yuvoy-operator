"use client";

import { useActionState, useEffect, useState } from "react";
import {
  acceptRequest,
  declineRequest,
  type RequestActionState,
} from "./actions";
import {
  DECLINE_REASONS,
  canGrant,
  timeToAnswer,
  urgencyOf,
  type OpenRequest,
} from "@/lib/day/request-types";
import { marketTime } from "@/lib/format/market-time";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ClockIcon } from "@/components/ui/icons";
import { choiceClass } from "@/components/ui/input";
import { panelClass } from "@/components/ui/panel";

/**
 * What an accept produced, kept by `RequestQueue` after the row is gone.
 *
 * Only what the receipt needs to say — nothing that would let it be mistaken
 * for a live request once the queue underneath it has moved on.
 */
export interface Receipt {
  id: string;
  contactName: string;
  guests: number;
  /** The granted hold's deadline. Null when the API did not say. */
  holdExpiresAt: string | null;
  timezone: string;
}

/**
 * Accepting is not the end. The traveller now holds seats with a clock on
 * them and must pay before it lapses — an operator who reads "accepted" as
 * "booked" will not chase it, and the seats go back.
 *
 * The deadline is said as a time, because that is the number an operator
 * chases a traveller against. Market time, never the phone's.
 */
export function GrantedReceipt({ receipt }: { receipt: Receipt }) {
  return (
    <li className={panelClass("done")}>
      <p className="text-base font-bold">
        Seats granted to {receipt.contactName}
      </p>
      <p className="text-forest/80 mt-2 text-sm">
        They are holding {receipt.guests}{" "}
        {receipt.guests === 1 ? "seat" : "seats"} and still have to pay.{" "}
        {receipt.holdExpiresAt
          ? `If they have not paid by ${marketTime(receipt.holdExpiresAt, receipt.timezone)}, the seats come back to you.`
          : "If they do not, the seats come back to you."}
      </p>
    </li>
  );
}

/**
 * One request waiting for an answer.
 *
 * The clock is the design. A traveller is on the other end of every row and
 * requests expire, so the time left is the largest thing after the party
 * itself, and the row's border carries the urgency without being read.
 *
 * Accepting is one tap. Declining is two, and the second one asks why —
 * a decline is cheap for the operator and final for the traveller, which is
 * exactly the asymmetry that deserves a confirming step. The reason is a
 * closed set from the contract; the traveller reads a sentence derived from
 * it, which always says nothing was charged.
 */
export function RequestRow({
  request,
  canAnswer,
  onGranted,
}: {
  request: OpenRequest;
  /**
   * OWNER or MANAGER. The contract refuses the write, not the read:
   * `POST /requests/{id}/accept` is 403 "STAFF cannot commit seats".
   *
   * The buttons are disabled rather than left live. The page already says so
   * at the top, but a banner and a working button disagree, and the one that
   * gets believed is the button — a staff member taps Accept, waits on one bar
   * of signal, and reads a refusal about their role while a clock runs down on
   * a traveller. Same call as the grant ceiling below: the refusal is knowable
   * from what is already on screen, so it is said here rather than fetched.
   *
   * The 403 handling in `actions.ts` stays regardless. A Server Action is a
   * public POST endpoint, and roles change between a render and a tap.
   */
  canAnswer: boolean;
  /**
   * Hands the receipt up to `RequestQueue` the moment an accept lands. This
   * row is inside the server-rendered list and the next refresh removes it;
   * the receipt has to be somewhere a refresh cannot reach.
   */
  onGranted: (receipt: Receipt) => void;
}) {
  const [state, act, pending] = useActionState<RequestActionState, FormData>(
    async (prev, form) =>
      form.get("intent") === "decline"
        ? declineRequest(prev, form)
        : acceptRequest(prev, form),
    {},
  );
  const [declining, setDeclining] = useState(false);

  const urgency = urgencyOf(request.minutesToAnswer);
  const grantable = canAnswer && canGrant(request);
  const short = (request.seatsGrantable ?? 0) < (request.guests ?? 0);

  const receipt: Receipt | null = state.granted
    ? {
        id: request.id ?? "",
        contactName: request.contactName ?? "",
        guests: request.guests ?? 0,
        holdExpiresAt: state.holdExpiresAt ?? null,
        timezone: request.timezone ?? "Asia/Kolkata",
      }
    : null;

  useEffect(() => {
    if (receipt) onGranted(receipt);
    // `receipt` is derived from `state.granted`, which flips exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.granted]);

  // Rendered here for the frame before the queue takes it over, so the
  // receipt never blinks. Same markup, same place.
  if (receipt) return <GrantedReceipt receipt={receipt} />;

  return (
    <li
      className={cn(
        "rounded-card border p-5",
        urgency === "critical"
          ? "border-terra-deep bg-cream-deep border-2"
          : "border-cream-line bg-cream-deep",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-lg font-bold">{request.contactName}</p>
        <Chip tone={urgency === "critical" ? "accent" : "neutral"}>
          <ClockIcon className="size-3.5" />
          {timeToAnswer(request.minutesToAnswer)}
        </Chip>
      </div>

      <p className="text-forest/80 mt-1.5 text-sm">
        {request.guests} {request.guests === 1 ? "guest" : "guests"} ·{" "}
        {request.experience}
      </p>

      {/*
        Seats left, beside the decision. "Accept with no sense of what is left
        is a decision made blind" — and accepting past the ceiling answers 409,
        so this is what stops the tap rather than the error that follows it.
      */}
      <p
        className={cn(
          "mt-2 text-sm",
          short ? "text-terra-deep font-bold" : "text-forest/70",
        )}
      >
        {short
          ? `Only ${request.seatsGrantable} seat${request.seatsGrantable === 1 ? "" : "s"} left — not enough for this party`
          : `${request.seatsGrantable} seat${request.seatsGrantable === 1 ? "" : "s"} still grantable`}
      </p>

      {declining ? (
        <form action={act} className="mt-4">
          <input type="hidden" name="intent" value="decline" />
          <input type="hidden" name="requestId" value={request.id ?? ""} />

          <fieldset>
            <legend className="label text-forest/75">Why?</legend>
            <div className="mt-2 space-y-2">
              {DECLINE_REASONS.map((reason) => (
                <label key={reason.code} className={choiceClass()}>
                  <input
                    type="radio"
                    name="reasonCode"
                    value={reason.code}
                    required
                    className="accent-terra-deep size-5"
                  />
                  <span className="text-sm">{reason.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <p className="text-forest/70 mt-3 text-xs">
            They are told nothing was charged, because nothing was.
          </p>

          <div className="mt-4 flex gap-2">
            <Button
              type="submit"
              disabled={pending}
              variant="danger"
              block={false}
              className="flex-1"
            >
              {pending ? "Sending…" : "Decline"}
            </Button>
            <Button
              onClick={() => setDeclining(false)}
              variant="secondary"
              block={false}
              className="flex-1"
            >
              Back
            </Button>
          </div>
        </form>
      ) : (
        <form action={act} className="mt-4 flex gap-2">
          <input type="hidden" name="requestId" value={request.id ?? ""} />
          <Button
            type="submit"
            disabled={pending || !grantable}
            block={false}
            className="flex-1"
          >
            {pending ? "Working…" : "Accept"}
          </Button>
          <Button
            onClick={() => setDeclining(true)}
            disabled={pending || !canAnswer}
            variant="secondary"
            block={false}
            className="flex-1"
          >
            Decline
          </Button>
        </form>
      )}

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}
