"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  moveDeparture,
  stopSellingDeparture,
  type DepartureState,
} from "./actions";
import { CallOffPanel } from "@/app/today/[slotId]/call-off-panel";
import { SlotCapacity } from "@/app/calendar/slot-capacity";
import { BLACKOUT_REASONS } from "@/lib/day/capacity-types";
import type { OperatorSlot } from "@/lib/day/types";
import { marketTime } from "@/lib/format/market-time";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { choiceClass, inputClass, textareaClass } from "@/components/ui/input";

/**
 * One departure on the listing hub, and everything that can be done to it —
 * yuvoy-operator#56 item 9.
 *
 * ## "Stop selling" and "Cancel departure" are always two buttons
 *
 * With those exact labels, and "the money effect is said only in the confirm
 * step, never in text on the row." They are the two acts an operator confuses,
 * and the difference is everything: one stops new bookings and leaves the
 * people on it, the other cancels them and refunds in full.
 *
 * ## What a suspended business keeps
 *
 * Cancel departure and Who is coming (#50). A suspended business can always
 * stop a trip it has already sold and can never take a new one on, so the
 * controls that only sell are withheld and the two that end things stay.
 */
export function DepartureRow({
  slot,
  day,
  canManage,
  suspended,
}: {
  slot: OperatorSlot;
  /** The departure's own market day, for the move and for the caption. */
  day: string;
  canManage: boolean;
  suspended: boolean;
}) {
  const [open, setOpen] = useState<"time" | "seats" | "stop" | "off" | null>(
    null,
  );
  const time = marketTime(slot.startsAt, slot.timezone);
  const calledOff = slot.status === "cancelled";

  return (
    <li className="border-paper-line border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-baseline gap-3">
          <span className="font-mono text-sm tabular-nums">{time}</span>
          <span className="text-base font-bold">
            {slot.sold}/{slot.seats}
          </span>
        </span>
        {calledOff ? (
          <span className="label text-terra-deep">Called off</span>
        ) : slot.status === "closed" ? (
          <span className="label text-forest/75">Closed to new bookings</span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {/*
          Every role, always. A staff login reading the manifest is the point of
          this link, and it is the only control they get here.
        */}
        <Link
          href={`/today/${slot.id}`}
          className="text-forest tap-target text-sm underline underline-offset-2"
        >
          Who is coming
        </Link>

        {canManage && !calledOff ? (
          <>
            {/* Selling controls go while the business is suspended (#50). */}
            {!suspended &&
            (slot.status === "open" || slot.status === "closed") ? (
              <Button
                variant="secondary"
                size="sm"
                block={false}
                onClick={() => setOpen(open === "time" ? null : "time")}
              >
                Change time
              </Button>
            ) : null}
            {!suspended ? (
              <Button
                variant="secondary"
                size="sm"
                block={false}
                onClick={() => setOpen(open === "seats" ? null : "seats")}
              >
                Seats
              </Button>
            ) : null}
            {!suspended && slot.status === "open" ? (
              <Button
                variant="secondary"
                size="sm"
                block={false}
                onClick={() => setOpen(open === "stop" ? null : "stop")}
              >
                Stop selling
              </Button>
            ) : null}
            <Button
              variant="danger"
              size="sm"
              block={false}
              onClick={() => setOpen(open === "off" ? null : "off")}
            >
              Cancel departure
            </Button>
          </>
        ) : null}
      </div>

      {open === "time" ? (
        <MoveTime
          slot={slot}
          day={day}
          time={time}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {open === "seats" ? (
        /*
          The Calendar's own control, reused rather than rebuilt: it already
          holds the floor at what is sold and the API's refusal copy, and two
          seat editors would be two chances to let somebody oversell a boat.
        */
        <div className="mt-3">
          <SlotCapacity slot={slot} />
        </div>
      ) : null}

      {open === "stop" ? (
        <StopSelling slot={slot} onClose={() => setOpen(null)} />
      ) : null}

      {open === "off" ? (
        /*
          The existing panel, with its typed departure id and its own result
          figures. "Cancel departure" is what the button above says; the panel's
          own copy is what the confirm step says.
        */
        <div className="mt-3">
          <CallOffPanel
            slotId={slot.id}
            alreadyCalledOff={calledOff}
            canManage={canManage}
          />
        </div>
      ) : null}
    </li>
  );
}

function MoveTime({
  slot,
  day,
  time,
  onClose,
}: {
  slot: OperatorSlot;
  day: string;
  time: string;
  onClose: () => void;
}) {
  const [state, act, pending] = useActionState<DepartureState, FormData>(
    moveDeparture,
    {},
  );
  const [to, setTo] = useState(time);

  if (state.done) {
    return (
      <Panel tone="done" role="status" className="mt-3 p-4">
        <p className="text-sm font-bold">This departure has moved</p>
        {/*
          The API's sentence, verbatim: it says how many travellers were told,
          which is the number an operator is actually asking about.
        */}
        {state.note ? (
          <p className="text-forest/80 mt-1.5 text-sm">{state.note}</p>
        ) : null}
      </Panel>
    );
  }

  return (
    <form action={act} className="border-paper-line mt-3 border-t pt-3">
      <input type="hidden" name="slotId" value={slot.id} />
      <input type="hidden" name="day" value={day} />

      <label htmlFor={`to-${slot.id}`} className="label text-forest/75">
        New time
      </label>
      <input
        id={`to-${slot.id}`}
        name="startTime"
        type="time"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className={inputClass("mt-1 h-11 w-auto")}
      />

      {/*
        The whole consequence, before the tap. Everybody booked is told, and
        each of them may cancel for a full refund until it leaves — which is
        the part that makes moving a departure a decision rather than an edit.
      */}
      <p className="text-forest/80 mt-3 text-sm">
        Move {slot.title} from {time} to {to}? Everyone booked is told the new
        time and can cancel for a full refund until it leaves.
      </p>

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <Button
          type="submit"
          block={false}
          className="flex-1"
          disabled={pending}
        >
          {pending ? "Moving…" : "Move it"}
        </Button>
        <Button
          variant="secondary"
          block={false}
          className="flex-1"
          disabled={pending}
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function StopSelling({
  slot,
  onClose,
}: {
  slot: OperatorSlot;
  onClose: () => void;
}) {
  const [state, act, pending] = useActionState<DepartureState, FormData>(
    stopSellingDeparture,
    {},
  );

  if (state.done) {
    return (
      <Panel tone="done" role="status" className="mt-3 p-4">
        <p className="text-sm font-bold">Closed to new bookings</p>
        {state.note ? (
          <p className="text-forest/80 mt-1.5 text-sm">{state.note}</p>
        ) : null}
      </Panel>
    );
  }

  return (
    <form action={act} className="border-paper-line mt-3 border-t pt-3">
      <input type="hidden" name="slotId" value={slot.id} />

      <fieldset>
        <legend className="label text-forest/75">Why</legend>
        <div className="mt-2 space-y-2">
          {BLACKOUT_REASONS.map((reason) => (
            <label key={reason.code} className={choiceClass(false)}>
              <input
                type="radio"
                name="reasonCode"
                value={reason.code}
                required
                className="accent-terra-deep size-5 shrink-0"
              />
              <span>{reason.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-3">
        <label
          htmlFor={`stop-note-${slot.id}`}
          className="label text-forest/75"
        >
          A note <span className="text-forest/70">(optional)</span>
        </label>
        <textarea
          id={`stop-note-${slot.id}`}
          name="note"
          rows={2}
          maxLength={500}
          className={textareaClass("mt-1")}
        />
      </div>

      {/*
        The money effect, said here and nowhere else: "the guests already booked
        keep their seats." A row that carried it would put the sentence beside
        Cancel departure too, where it is the opposite of true.
      */}
      <p className="text-forest/80 mt-3 text-sm">
        Stops new bookings on this departure. The {slot.sold}{" "}
        {slot.sold === 1 ? "guest" : "guests"} already booked keep their seats.
      </p>

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <Button
          type="submit"
          block={false}
          className="flex-1"
          disabled={pending}
        >
          {pending ? "Closing…" : "Stop selling"}
        </Button>
        <Button
          variant="secondary"
          block={false}
          className="flex-1"
          disabled={pending}
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
