"use client";

import { useActionState, useState } from "react";
import { sendRelay, type RelayState } from "./actions";
import { NOTE_MAX, RELAY_INTENTS, relayIntent } from "@/lib/day/relay-types";
import { Button } from "@/components/ui/button";
import { choiceClass, inputClass, textareaClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

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
      <Panel tone="done" className="mt-4 p-4">
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
        <Button onClick={onAgain} variant="secondary" className="mt-3">
          Tell {who} something else
        </Button>
      </Panel>
    );
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        variant="secondary"
        className="mt-4"
      >
        Tell {who}
      </Button>
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
              className={choiceClass(intent === option.intent)}
            >
              <input
                type="radio"
                name="intent"
                value={option.intent}
                checked={intent === option.intent}
                onChange={() => setIntent(option.intent)}
                className="accent-terra-deep size-5"
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
            className={inputClass("mt-2")}
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
          className={textareaClass("mt-2")}
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
        <Button
          type="submit"
          disabled={pending}
          block={false}
          className="flex-1"
        >
          {pending ? "Sending…" : sendsToPhone ? "Send it" : "Leave the note"}
        </Button>
        <Button
          onClick={() => setOpen(false)}
          variant="secondary"
          block={false}
          className="flex-1"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
