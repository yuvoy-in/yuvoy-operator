"use client";

import { useActionState, useState } from "react";
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
import { cn } from "@/lib/cn";

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

  if (state.granted) {
    return (
      <li className="rounded-edge border-forest bg-forest/5 border-2 p-5">
        <p className="text-base font-bold">
          Seats granted to {request.contactName}
        </p>
        {/*
          Accepting is not the end. The traveller now holds seats with a clock
          on them and must pay before it lapses — an operator who reads
          "accepted" as "booked" will not chase it, and the seats go back.
        */}
        <p className="text-forest/80 mt-2 text-sm">
          They are holding {request.guests}{" "}
          {request.guests === 1 ? "seat" : "seats"} and still have to pay.
          {state.holdExpiresAt
            ? " If they do not, the seats come back to you."
            : null}
        </p>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "rounded-edge border p-5",
        urgency === "critical"
          ? "border-terra-deep bg-cream-deep border-2"
          : "border-cream-line bg-cream-deep",
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-lg font-bold">{request.contactName}</p>
        <p
          className={cn(
            "label shrink-0",
            urgency === "critical" ? "text-terra-deep" : "text-forest/70",
          )}
        >
          {timeToAnswer(request.minutesToAnswer)}
        </p>
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
                <label
                  key={reason.code}
                  className="rounded-edge border-cream-line bg-cream flex min-h-11 cursor-pointer items-center gap-3 border px-3"
                >
                  <input
                    type="radio"
                    name="reasonCode"
                    value={reason.code}
                    required
                    className="size-5"
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
            <button
              type="submit"
              disabled={pending}
              className="rounded-edge dock-target label border-terra-deep text-terra-deep flex-1 border-2 px-5 font-bold"
            >
              {pending ? "Sending…" : "Decline"}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(false)}
              className="rounded-edge dock-target label border-cream-line bg-cream flex-1 border px-5"
            >
              Back
            </button>
          </div>
        </form>
      ) : (
        <form action={act} className="mt-4 flex gap-2">
          <input type="hidden" name="requestId" value={request.id ?? ""} />
          <button
            type="submit"
            disabled={pending || !grantable}
            className="rounded-edge dock-target label bg-forest text-cream flex-1 px-5 font-bold disabled:cursor-not-allowed disabled:opacity-55"
          >
            {pending ? "Working…" : "Accept"}
          </button>
          <button
            type="button"
            onClick={() => setDeclining(true)}
            disabled={pending || !canAnswer}
            className="rounded-edge dock-target label border-cream-line bg-cream flex-1 border px-5 disabled:cursor-not-allowed disabled:opacity-55"
          >
            Decline
          </button>
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
