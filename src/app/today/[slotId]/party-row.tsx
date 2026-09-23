"use client";

import { useActionState, useState } from "react";
import { markAttendance, type AttendanceState } from "./actions";
import { isHolding, type PartyForClient } from "@/lib/day/types";
import type { ScreeningSignal } from "@/lib/day/screening";
import { answerFor, toQuestions } from "@/lib/bookings/ending";
import { CancelBooking } from "@/app/bookings/cancel-booking";
import type { BookingCash } from "@/lib/money/bookings";
import { cn } from "@/lib/cn";
import { RelayPanel } from "./relay-panel";
import { CashCollect } from "@/app/bookings/cash-collect";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";

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
  screening,
  cash,
  timezone,
  canManage,
}: {
  /**
   * The screener is NOT on this type. It is decided on the server and arrives
   * as `screening` below — see `PartyForClient` for why the difference
   * matters on a page whose source anybody can read.
   */
  party: PartyForClient;
  slotId: string;
  /** Terminal outcomes are refused before the departure time. */
  departed: boolean;
  /**
   * What this row should say about the medical question, in one word.
   *
   * Decided for the whole manifest at once rather than inferred here: a row
   * carrying no screener looks identical on a snorkel trip (nobody was ever
   * going to be asked) and on a dive (somebody slipped through), and only the
   * other rows can tell them apart.
   *
   * `null` renders nothing whatsoever — not a reassurance and not a warning.
   * "A false alarm on this signal teaches an instructor to skip the column."
   */
  screening: ScreeningSignal;
  /**
   * How this party is paying — yuvoy-operator#40 §1. Required, so a manifest
   * cannot forget to say.
   *
   *   `BookingCash`  paying at the counter: the fare, and whether it is taken
   *   `null`         not a cash booking — paid online, or a hold
   *
   * There is no third "could not tell" any more. It existed for a second read
   * that could miss a booking; the manifest carries each party's cash itself
   * since yuvoy-api#204 (op#95).
   */
  cash: BookingCash | null;
  /** The departure's own zone, for when the cash was taken. */
  timezone: string;
  /**
   * The signed-in person may cancel a booking — yuvoy-operator#56 item 10.
   *
   * `POST /bookings/{id}/cancel` "requires OWNER, ADMIN or MANAGER, the roles
   * that may call a departure off", and a STAFF login gets no control rather
   * than a refusal after the tap. It stays drawn for a SUSPENDED business,
   * which can still stop the trips it has already sold (#50).
   */
  canManage: boolean;
}) {
  const [state, act, pending] = useActionState<AttendanceState, FormData>(
    markAttendance,
    {},
  );

  /*
    Narrowed here rather than on the server, because this row already receives
    the whole party: `toQuestions` drops a question with no words and reads an
    absent `current` as `true`, which is the same treatment the booking screen
    gives them. One function, so the two surfaces cannot disagree about what a
    question is.
  */
  const answers = toQuestions(party.questions);

  const holding = isHolding(party);
  const arrived = Boolean(party.arrived);
  const settled = party.state === "completed" || party.state === "no_show";
  /*
    A terminal outcome is armed by one tap and sent by a second. The API
    refuses to overwrite a settled booking, so a wet-thumb tap on "No-show"
    used to record a paying guest as absent, permanently, with no way back —
    while the call-off panel next door claimed to be "the only action in the
    portal that cannot be undone". Arriving stays one tap: it is idempotent
    and reversible in the only sense that matters (the boat leaves anyway).
  */
  const [armed, setArmed] = useState<"completed" | "no_show" | null>(null);
  /*
    The cash is still owed. Completing the trip first strands it: the API
    takes cash only from a booking that is `paid_pending_ops` or `confirmed`,
    so once this one is completed the notes in the operator's hand can never
    be recorded — said at the confirmation, where it can still be avoided.
  */
  const cashStillOwed = Boolean(cash && !cash.collected);
  /*
    Cancelled from this row. The row keeps its receipt and puts every other
    control away, so nobody records cash against, or ticks off, a booking that
    was just cancelled (op#89 f16). The next read of the manifest drops the
    row entirely: a cancelled party is not on the boat.
  */
  const [cancelledHere, setCancelledHere] = useState(false);
  const cancellable =
    canManage &&
    !departed &&
    Boolean(party.bookingId) &&
    (party.state === "confirmed" || party.state === "paid_pending_ops");

  return (
    <li
      className={cn(
        "rounded-card ease-interaction border p-4 transition-[border-color,background-color,box-shadow] duration-200",
        arrived
          ? "border-forest bg-forest/5 ring-forest ring-1"
          : "border-paper-line bg-paper-deep",
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

      {/*
        The screener. Above the buttons, because it changes whether somebody
        should be ticked off at all — and a warning under a control the
        operator has already tapped is a warning that arrived too late.

        Neither line says anything about what anybody disclosed, and there is
        nowhere in this component that could: `clear` is not read here or
        anywhere else in the portal. A manifest is read out loud on a jetty in
        front of other customers, so the strong line is an INSTRUCTION with no
        reason attached, and the weak one is a statement about our records
        rather than about the person.
      */}
      {screening === "flagged" ? (
        <p className="text-terra-deep mt-3 text-sm font-bold">
          Check with them before boarding.
        </p>
      ) : screening === "outstanding" ? (
        <p className="text-forest/80 mt-3 text-sm font-bold">
          No screening answer recorded. Ask them before boarding.
        </p>
      ) : null}

      {/*
        What the listing asked, and what this party said — yuvoy-operator#43
        item 3.

        Behind a disclosure, and that is the one design decision here. A
        manifest is a scanning surface: eleven parties, two questions each, and
        the attendance buttons are what somebody is reaching for at 06:30. Laid
        out flat, the answers push the controls off the screen and get skipped
        by everybody. One tap opens the party being asked about.

        These questions "never ask about health, which stays with `screening`",
        so unlike the screener there is nothing here that must not be read out
        on a jetty.
      */}
      {answers.length > 0 ? (
        <details className="border-paper-line mt-3 border-t pt-3">
          <summary className="label text-forest/75 tap-target cursor-pointer">
            What they answered
          </summary>
          <dl className="mt-2 space-y-2 text-sm">
            {answers.map((question) => (
              <div key={question.questionId}>
                <dt className="text-forest/75">{question.text}</dt>
                <dd className="font-bold">{answerFor(question)}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      {/*
        Cancelling this one party — yuvoy-operator#56 item 10, and the same
        component the booking's own screen uses (#43 item 4), because the act is
        the same and a second confirmation written for the manifest would be a
        second chance to get the reference check wrong.

        Withheld on a departure that has left and on a booking that has already
        ended: the API answers `409 departure_started` and `409 booking_ended`,
        and both are knowable from what is on this row.
      */}
      {party.bookingId && (cancellable || cancelledHere) ? (
        <CancelBooking
          bookingId={party.bookingId}
          reference={party.reference ?? ""}
          isCash={Boolean(cash)}
          context="manifest"
          onDone={() => setCancelledHere(true)}
        />
      ) : null}

      {cancelledHere ? null : holding ? (
        <p className="text-terra-deep mt-3 text-sm font-bold">
          Still paying. Not a confirmed seat yet. They may still turn up.
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

            "Check in", and "Checked in" once done: the words the totals above
            use (yuvoy-operator#88 s3). "Here" read as a question on a jetty.
            The tick is drawn, not a character, so it matches every other icon.
          */}
          <Button
            type="submit"
            name="outcome"
            value="arrived"
            disabled={pending}
            variant={arrived ? "primary" : "outline"}
            block={false}
            className="flex-1"
          >
            {arrived ? (
              <>
                <CheckIcon className="size-5" />
                Checked in
              </>
            ) : (
              "Check in"
            )}
          </Button>

          {/*
            Terminal outcomes appear only once the trip has set off. The API
            refuses them before then (409 departure_has_not_started), and
            offering a button that will be refused is how an operator learns to
            distrust the screen.
          */}
          {departed && !armed ? (
            <>
              <Button
                onClick={() => setArmed("completed")}
                disabled={pending}
                variant="secondary"
                block={false}
                className="flex-1"
              >
                Completed
              </Button>
              <Button
                onClick={() => setArmed("no_show")}
                disabled={pending}
                variant="secondary"
                block={false}
                className="flex-1"
              >
                No-show
              </Button>
            </>
          ) : null}

          {departed && armed ? (
            <div className="border-paper-line mt-1 flex w-full flex-wrap gap-2 border-t pt-3">
              <p className="text-forest/80 w-full text-sm">
                {armed === "no_show"
                  ? `Mark ${party.name} as a no-show? This cannot be changed afterwards.`
                  : `Mark ${party.name} as completed? This cannot be changed afterwards.`}
              </p>
              {armed === "completed" && cashStillOwed ? (
                <p className="text-terra-deep w-full text-sm font-bold">
                  Record the cash first. Once the trip is completed, the cash
                  can no longer be recorded.
                </p>
              ) : null}
              <Button
                type="submit"
                name="outcome"
                value={armed}
                disabled={pending}
                variant="danger"
                block={false}
                className="flex-1"
              >
                {pending
                  ? "Recording…"
                  : armed === "no_show"
                    ? "Confirm no-show"
                    : "Confirm completed"}
              </Button>
              <Button
                onClick={() => setArmed(null)}
                disabled={pending}
                variant="secondary"
                block={false}
                className="flex-1"
              >
                Not that
              </Button>
            </div>
          ) : null}
        </form>
      )}

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      {/*
        Cash at the counter — yuvoy-operator#40 §1. Its own block and its own
        form, under the attendance buttons and never merged with them:
        "somebody can turn up and not pay". A hold is not a booking yet, so it
        has nothing to collect against.
      */}
      {!holding && !cancelledHere && cash ? (
        <CashCollect
          bookingId={party.bookingId ?? ""}
          slotId={slotId}
          state={party.state ?? ""}
          cash={cash}
          timezone={timezone}
        />
      ) : null}

      {/*
        Reaching one traveller. There is no phone number here and never will
        be — `reference` identifies them, the relay reaches them (O12). A hold
        has no bookingId, so there is nobody to address yet.
      */}
      {holding || cancelledHere ? null : (
        <RelayPanel
          slotId={slotId}
          bookingId={party.bookingId}
          who={party.name ?? "them"}
        />
      )}
    </li>
  );
}
