"use client";

import { useActionState, useId, useState } from "react";
import { moveDeparture, type DepartureState } from "./actions";
import { CallOffPanel } from "@/app/today/[slotId]/call-off-panel";
import { SeatsForm } from "@/app/calendar/departure-controls";
import { CloseDeparture } from "@/app/calendar/close-departure";
import type { OperatorSlot } from "@/lib/day/types";
import { saleChip } from "@/lib/day/off-sale";
import { marketTime } from "@/lib/format/market-time";
import { Button, ButtonLink } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ChevronRightIcon } from "@/components/ui/icons";
import { Panel } from "@/components/ui/panel";
import { inputClass } from "@/components/ui/input";

type Act = "time" | "seats" | "stop" | "off";

/**
 * One departure on the listing hub, and everything that can be done to it
 * (yuvoy-operator#56 item 9, laid out by #85 s8).
 *
 * ## One visible tap, and the rest behind Manage
 *
 * "Each departure row offers five choices of equal weight, of which one
 * cancels a trip." The row now shows the time, what is sold and one tap, "Who
 * is coming". Change time, Seats, Stop selling and Call off sit behind one
 * Manage control, and the two that end things are quiet text in the warning
 * colour (#81), each opening a confirm that names what happens.
 *
 * "Stop selling" and "Call off" stay two separate controls with those words:
 * they are the two acts an operator confuses, and the difference is
 * everything. One stops new bookings and leaves the people on it; the other
 * cancels them and refunds everything paid online. "Call off" is the product's
 * word for the second everywhere else (#88 s3), so it is the word here too.
 * The money is said only in the confirm, never on the row.
 *
 * Both confirms are the ones the Calendar and the departure's own screen use,
 * opened straight on their question: one confirm per act, so the sentence
 * that stopping cancels nobody cannot drift between two screens.
 *
 * ## What a suspended business keeps
 *
 * Call off and Who is coming (#50). A suspended business can always stop a
 * trip it has already sold and can never take a new one on, so the controls
 * that only sell are withheld and the one that ends things stays.
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
  const [managing, setManaging] = useState(false);
  const [open, setOpen] = useState<Act | null>(null);
  /*
    A stop or a call-off is running. Its panel is held until the receipt is
    in: taking it away mid-flight (another act, or Manage) lost the receipt of
    something that still happened (the audit, O8).
  */
  const [busy, setBusy] = useState(false);
  const panelId = useId();
  const time = marketTime(slot.startsAt, slot.timezone);
  const calledOff = slot.status === "cancelled";
  const chip = saleChip(slot);

  /*
    Which acts this departure and this login may have. The selling ones go
    while the business is suspended; a called-off departure has none left.
  */
  const acts: Record<Act, boolean> = {
    time: !suspended && (slot.status === "open" || slot.status === "closed"),
    seats: !suspended,
    stop: !suspended && slot.status === "open",
    off: true,
  };
  const manageable = canManage && !calledOff;
  const choose = (act: Act) => setOpen(open === act ? null : act);

  return (
    <li className="border-paper-line border-t pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-base font-bold tabular-nums">{time}</span>
        <span className="text-forest/70 text-sm tabular-nums">
          {slot.sold}/{slot.seats} sold
        </span>
        {chip ? (
          <Chip tone={chip.loud ? "accent" : "neutral"}>{chip.label}</Chip>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
        {/*
          Every role, always, and the one visible tap: a staff login reading
          the manifest is the point of this link, and it is the only control
          they get here.
        */}
        <ButtonLink
          href={`/today/${slot.id}`}
          variant="secondary"
          size="md"
          block={false}
        >
          Who is coming
        </ButtonLink>

        {manageable ? (
          <button
            type="button"
            aria-expanded={managing}
            aria-controls={panelId}
            disabled={busy}
            onClick={() => {
              setManaging(!managing);
              setOpen(null);
            }}
            className="text-forest inline-flex h-11 items-center gap-1 px-3 text-sm font-bold"
          >
            Manage <span className="sr-only">{time}</span>
            <ChevronRightIcon
              className={
                managing
                  ? "ease-interaction size-4 rotate-90 transition-transform duration-200"
                  : "ease-interaction size-4 transition-transform duration-200"
              }
            />
          </button>
        ) : null}
      </div>

      {/*
        Always in the page, hidden until Manage, so the control that names it
        always names something.
      */}
      {manageable ? (
        <div
          id={panelId}
          hidden={!managing}
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          {acts.time ? (
            <Button
              variant="secondary"
              size="md"
              block={false}
              aria-expanded={open === "time"}
              disabled={busy}
              onClick={() => choose("time")}
            >
              Change time
            </Button>
          ) : null}
          {acts.seats ? (
            <Button
              variant="secondary"
              size="md"
              block={false}
              aria-expanded={open === "seats"}
              disabled={busy}
              onClick={() => choose("seats")}
            >
              Seats
            </Button>
          ) : null}
          {acts.stop ? (
            <Button
              variant="danger-quiet"
              size="md"
              block={false}
              aria-expanded={open === "stop"}
              disabled={busy}
              onClick={() => choose("stop")}
            >
              Stop selling
            </Button>
          ) : null}
          <Button
            variant="danger-quiet"
            size="md"
            block={false}
            aria-expanded={open === "off"}
            disabled={busy}
            onClick={() => choose("off")}
          >
            Call off
          </Button>
        </div>
      ) : null}

      {/*
        What each act draws stays mounted by `open` alone, not by whether the
        act is still offered: the re-read after it turns the row Closed or
        Called off, and the receipt must outlive that.
      */}
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
          <SeatsForm slot={slot} />
        </div>
      ) : null}

      {open === "stop" ? (
        <div className="mt-3">
          <CloseDeparture
            slotId={slot.id}
            title={slot.title}
            time={time}
            available={slot.status === "open"}
            startOpen
            onKeep={() => setOpen(null)}
            onBusyChange={setBusy}
          />
        </div>
      ) : null}

      {open === "off" ? (
        <CallOffPanel
          slotId={slot.id}
          alreadyCalledOff={calledOff}
          canManage={canManage}
          time={time}
          startOpen
          onKeep={() => setOpen(null)}
          onBusyChange={setBusy}
          className="mt-3"
        />
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
        {/*
          The bookings nothing could carry the new time to (op#89). Said apart
          from the API's sentence, because it is the one thing on this receipt
          the operator has to act on: those travellers will turn up at the old
          time unless somebody tells them.
        */}
        {state.notReached ? (
          <p className="text-terra-deep mt-1.5 text-sm font-bold">
            {state.notReached === 1
              ? "1 booking could not be sent the new time: we hold no way to reach them. Tell them yourself if you can."
              : `${state.notReached} bookings could not be sent the new time: we hold no way to reach them. Tell them yourself if you can.`}
          </p>
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
        The whole consequence, before the tap. Everybody booked is messaged,
        and each of them may cancel for a full refund until it leaves, which
        is the part that makes moving a departure a decision rather than an
        edit. The receipt says who could not be reached.
      */}
      <p className="text-forest/80 mt-3 text-sm">
        Move {slot.title} from {time} to {to}? We message everyone booked with
        the new time, and each of them can cancel for a full refund until it
        leaves.
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
          Keep the time
        </Button>
      </div>
    </form>
  );
}
