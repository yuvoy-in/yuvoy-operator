"use client";

import { useActionState, useState } from "react";
import { sendRelay, type RelayState } from "./actions";
import { NOTE_MAX, RELAY_INTENTS, relayIntent } from "@/lib/day/relay-types";
import { cn } from "@/lib/cn";

/**
 * Telling a departure something.
 *
 * The operator never sees a phone number and never writes a message. They pick
 * a structured intent and supply one fact, which is the only operator-written
 * value that reaches a phone (O12).
 *
 * `note` is the trap, and it gets the loudest treatment on the screen: it is
 * shown on the traveller's status page and **never sent to a phone**. An
 * operator who thinks they messaged somebody and did not is worse than one who
 * knows they left a note.
 */
export function RelayPanel(props: {
  slotId: string;
  /** Empty means the whole departure. */
  bookingId?: string;
  who: string;
}) {
  /*
    Remounted per message. `useActionState` keeps its last result for the
    life of the component, so after one relay the receipt stood in for the
    form until a navigation — a follow-up "watching the weather" to the same
    departure needed leaving and coming back. A new key is a new form.
  */
  const [round, setRound] = useState(0);
  return (
    <RelayRound key={round} {...props} onAgain={() => setRound((r) => r + 1)} />
  );
}

function RelayRound({
  slotId,
  bookingId,
  who,
  onAgain,
}: {
  slotId: string;
  bookingId?: string;
  who: string;
  onAgain: () => void;
}) {
  const [state, act, pending] = useActionState<RelayState, FormData>(
    sendRelay,
    {},
  );
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<string>(RELAY_INTENTS[0].intent);

  const spec = relayIntent(intent);
  const sendsToPhone = spec?.detail !== "none";

  if (state.recipients !== undefined) {
    return (
      <div className="rounded-edge border-forest bg-forest/5 mt-4 border-2 p-4">
        <p className="text-sm font-bold">
          {state.intent === "note"
            ? `Note left for ${state.recipients} ${state.recipients === 1 ? "booking" : "bookings"}`
            : `Told ${state.recipients} ${state.recipients === 1 ? "person" : "people"}`}
        </p>
        {/*
          A relay that reached nobody looks identical to one that reached
          eleven people unless the number is on screen. Zero is worth saying
          out loud — every party on a departure being a live hold does it.
        */}
        {state.recipients === 0 ? (
          <p className="text-terra-deep mt-1.5 text-sm">
            Nobody was reached. There may be no confirmed bookings on this
            departure yet.
          </p>
        ) : null}
        {state.intent === "note" ? (
          <p className="text-forest/80 mt-1.5 text-sm">
            It is on their booking page. It was not sent to a phone.
          </p>
        ) : null}
        <button
          type="button"
          onClick={onAgain}
          className="rounded-edge dock-target label border-cream-line bg-cream mt-3 w-full border px-5"
        >
          Tell {who} something else
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-edge dock-target label border-cream-line bg-cream mt-4 w-full border px-5"
      >
        Tell {who}
      </button>
    );
  }

  return (
    <form action={act} className="mt-4">
      <input type="hidden" name="slotId" value={slotId} />
      <input type="hidden" name="bookingId" value={bookingId ?? ""} />

      <fieldset>
        <legend className="label text-forest/75">
          What are you telling them?
        </legend>
        <div className="mt-2 space-y-2">
          {RELAY_INTENTS.map((option) => (
            <label
              key={option.intent}
              className={cn(
                "rounded-edge flex min-h-11 cursor-pointer items-center gap-3 border px-3",
                intent === option.intent
                  ? "border-forest bg-cream"
                  : "border-cream-line bg-cream",
              )}
            >
              <input
                type="radio"
                name="intent"
                value={option.intent}
                checked={intent === option.intent}
                onChange={() => setIntent(option.intent)}
                className="size-5"
              />
              <span className="text-sm">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {spec && spec.detail !== "none" ? (
        <div className="mt-4">
          <label
            htmlFor={`detail-${bookingId || slotId}`}
            className="label text-forest/75"
          >
            {spec.detailLabel}
          </label>
          <input
            id={`detail-${bookingId || slotId}`}
            name="detail"
            type="text"
            inputMode={spec.detail === "time" ? "numeric" : "text"}
            placeholder={spec.placeholder}
            required
            className="rounded-edge border-cream-line bg-cream-deep mt-2 h-14 w-full border px-4 text-base"
          />
          <p className="text-forest/70 mt-1.5 text-xs">{spec.help}</p>
        </div>
      ) : null}

      <div className="mt-4">
        <label
          htmlFor={`note-${bookingId || slotId}`}
          className="label text-forest/75"
        >
          {sendsToPhone ? "Anything else (optional)" : "The note"}
        </label>
        <textarea
          id={`note-${bookingId || slotId}`}
          name="note"
          rows={3}
          maxLength={NOTE_MAX}
          required={!sendsToPhone}
          className="rounded-edge border-cream-line bg-cream-deep mt-2 w-full border p-3 text-base"
        />
        {/*
          The single most important sentence on this panel. Free text never
          reaches a phone, whatever else the relay does.
        */}
        <p className="text-terra-deep mt-1.5 text-xs font-bold">
          This goes on their booking page. It is never sent to a phone.
        </p>
      </div>

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-edge dock-target label bg-forest text-cream flex-1 px-5 font-bold"
        >
          {pending ? "Sending…" : sendsToPhone ? "Send it" : "Leave the note"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-edge dock-target label border-cream-line bg-cream flex-1 border px-5"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
