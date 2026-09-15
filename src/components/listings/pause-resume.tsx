"use client";

import { useActionState, useState } from "react";
import {
  pauseListing,
  resumeListing,
  type PauseState,
  type ResumeState,
} from "./actions";
import { PAUSE_REASONS } from "@/lib/services/listings";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/** An action's answer, and when it arrived — so the later of two receipts wins. */
type Stamped<T> = T & { at?: number };

/**
 * Pausing a listing, and resuming it — yuvoy-operator#30 §6, #44.
 *
 * The operator's own switch, both ways and immediate (D-032.4). Only an admin
 * used to be able to take a listing off sale, "so an operator whose boat was
 * out of the water for a month had to ask somebody at Yuvoy"; and until
 * yuvoy-api#157 putting it back waited on a review queue, which is why this
 * row used to say "send a change — it goes through review". That was false
 * twice over and is gone.
 *
 * ## The sentence this component exists to prevent
 *
 * **Pausing cancels nothing and refunds nothing.** Future departures keep their
 * rows and stop being offered; confirmed bookings are untouched and the
 * operator still owes those travellers the trip. Somebody who assumes
 * otherwise does not turn up, and eleven people are on a jetty — so it is said
 * before the decision, and the API's own `note` says it after, verbatim.
 *
 * ## Which control a row gets
 *
 *   published  → Pause (live, live with an edit in review, not selling)
 *   withdrawn  → Resume
 *   anything else → neither: "In review has been submitted and has no
 *                   pause/resume button", and a draft sells nothing to pause.
 *
 * ## The receipt outlives the row's re-render
 *
 * Both actions revalidate — the list must stop calling a paused listing Live
 * the moment it is not — and a parent that mounted this only while a control
 * applied would unmount it at exactly the moment it has something to say. So
 * this component is always mounted and decides for itself, and a receipt is
 * held in action state until a real navigation.
 */
export function PauseResume({
  experienceId,
  title,
  publicationState,
}: {
  experienceId: string;
  title: string;
  /** The publication act's own field — `status` folds in the latest revision. */
  publicationState: string | undefined;
}) {
  const [paused, pause, pausing] = useActionState<
    Stamped<PauseState>,
    FormData
  >(
    async (prev, form) => ({
      ...(await pauseListing(prev, form)),
      at: Date.now(),
    }),
    {},
  );
  const [resumed, resume, resuming] = useActionState<
    Stamped<ResumeState>,
    FormData
  >(
    async (prev, form) => ({
      ...(await resumeListing(prev, form)),
      at: Date.now(),
    }),
    {},
  );
  const [open, setOpen] = useState(false);

  const resumeIsLatest = (resumed.at ?? 0) > (paused.at ?? 0);

  if (resumed.done && resumeIsLatest) {
    return <Resumed state={resumed.done.state} next={resumed.done.next} />;
  }

  if (paused.done) {
    const { upcomingDepartures, bookingsToHonour, guestsToHonour, note, next } =
      paused.done;
    return (
      <Panel tone={bookingsToHonour > 0 ? "alert" : "done"} className="mt-4">
        <p className="text-base font-bold">Paused</p>
        <p className="text-forest/80 mt-2 text-sm">
          {upcomingDepartures === 1
            ? "One upcoming departure has stopped being offered."
            : `${upcomingDepartures} upcoming departures have stopped being offered.`}{" "}
          Nothing was cancelled and nothing was refunded.
        </p>

        {/*
          The API's own sentence, VERBATIM — the contract asks for exactly
          that, and it is present only when there is something still owed.
          Paraphrasing the one line that stops an operator failing to turn up
          would be the worst possible place to improve the wording.
        */}
        {note ? (
          <p className="text-terra-deep mt-3 text-sm font-bold">{note}</p>
        ) : bookingsToHonour > 0 ? (
          <p className="text-terra-deep mt-3 text-sm font-bold">
            You still owe {bookingsToHonour}{" "}
            {bookingsToHonour === 1 ? "booking" : "bookings"}, {guestsToHonour}{" "}
            {guestsToHonour === 1 ? "guest" : "guests"}. Those trips still run.
          </p>
        ) : null}

        {/*
          The API's `next`, verbatim — yuvoy-operator#44.

          It was suppressed and replaced by the sentence below, because the API
          sent "ask us to put it back … we check it before travellers see it
          again", which D-032.4 had made false. yuvoy-api#167 rewrote it to say
          that resuming is the operator's own button and needs nobody at Yuvoy,
          so the server's sentence is printed again.

          Our own line survives as the fallback for an answer that carries no
          `next` at all — an older deployment, or a field the API stops
          sending. Two sentences saying the same thing would be worse than
          either; one of them only appears when the other cannot.
        */}
        <p className="text-forest/70 mt-3 text-sm">
          {next ??
            "Resume it here whenever you are ready. It goes straight back on sale. Nothing waits on us."}
        </p>

        <ResumeControl
          experienceId={experienceId}
          title={title}
          action={resume}
          pending={resuming}
          message={resumeIsLatest ? resumed.message : undefined}
        />
      </Panel>
    );
  }

  if (publicationState === "withdrawn") {
    return (
      <ResumeControl
        experienceId={experienceId}
        title={title}
        action={resume}
        pending={resuming}
        message={resumed.message}
      />
    );
  }

  // A draft sells nothing, and a listing awaiting its first approval has no
  // switch at all.
  if (publicationState !== "published") return null;

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        variant="secondary"
        className="mt-3"
      >
        Pause
      </Button>
    );
  }

  return (
    /*
      Keyed on the attempt counter so the form REMOUNTS after a refusal and
      re-reads the defaults below. Without it React keeps the reset,
      uncontrolled inputs and the values handed back are never applied.
    */
    <form key={paused.attempt ?? 0} action={pause} className="mt-4 space-y-4">
      <input type="hidden" name="id" value={experienceId} />

      <Panel tone="alert">
        <p className="text-sm font-bold">
          Pausing stops new bookings. It does not cancel the ones you have.
        </p>
        <p className="text-forest/80 mt-1.5 text-sm">
          Anybody already booked still expects their trip, and you still owe it
          to them. To cancel a departure and refund its travellers, open it from
          Calendar and call it off: one at a time, each confirmed on its own.
        </p>
      </Panel>

      <fieldset>
        <legend className="label text-forest/75">
          Why are you pausing it?
        </legend>
        <div className="mt-2 space-y-2">
          {PAUSE_REASONS.map((reason) => (
            <label
              key={reason.code}
              className="border-paper-line rounded-control flex min-h-14 cursor-pointer items-center gap-3 border p-3"
            >
              <input
                type="radio"
                name="reasonCode"
                value={reason.code}
                defaultChecked={paused.typed?.reasonCode === reason.code}
                className="accent-forest size-5 shrink-0"
              />
              <span className="text-sm">{reason.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label
          htmlFor={`pause-note-${experienceId}`}
          className="label text-forest/75"
        >
          Anything to add
        </label>
        <textarea
          id={`pause-note-${experienceId}`}
          name="note"
          rows={2}
          className={inputClass("mt-2")}
        />
        <p className="text-forest/70 mt-1.5 text-xs">Optional. We read it.</p>
      </div>

      <div>
        <label
          htmlFor={`pause-confirm-${experienceId}`}
          className="label text-forest/75"
        >
          Type this listing&rsquo;s id to confirm
        </label>
        {/*
          Not a checkbox. "A checkbox is one mis-tap on a wet phone away from
          taking a live listing off sale" — the same reason calling off a
          departure asks for the departure's own id.

          The id is shown right here because it is not something anybody has
          memorised, and hiding it would turn a confirmation into a puzzle.
        */}
        <p className="text-forest/70 mt-1.5 text-xs">
          <span className="font-mono">{experienceId}</span> · for {title}
        </p>
        <input
          id={`pause-confirm-${experienceId}`}
          name="confirmExperienceId"
          defaultValue={paused.typed?.confirmExperienceId ?? ""}
          autoComplete="off"
          spellCheck={false}
          className={inputClass("mt-2 font-mono")}
        />
      </div>

      {paused.message ? (
        <p role="alert" className="text-terra-deep text-sm font-bold">
          {paused.message}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pausing}
          variant="primary"
          block={false}
          className="flex-1"
        >
          {pausing ? "Pausing…" : "Pause it"}
        </Button>
        <Button
          type="button"
          onClick={() => setOpen(false)}
          variant="secondary"
          block={false}
        >
          Not now
        </Button>
      </div>
    </form>
  );
}

/**
 * Resume, armed by one tap and sent by a second.
 *
 * Not typed like a pause, because it is not destructive — pausing again is
 * one form away. But it puts a listing in front of travellers straight away,
 * and a mis-tap on a wet phone should not open bookings for a boat that is
 * out of the water, so the second tap says what the first one will do.
 */
function ResumeControl({
  experienceId,
  title,
  action,
  pending,
  message,
}: {
  experienceId: string;
  title: string;
  action: (form: FormData) => void;
  pending: boolean;
  message?: string;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <div className="mt-4">
        <Button onClick={() => setArmed(true)} variant="secondary">
          Resume
        </Button>
        {message ? (
          <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="border-paper-line mt-4 border-t pt-4">
      <input type="hidden" name="id" value={experienceId} />
      <p className="text-sm font-bold">Put {title} back on sale?</p>
      <p className="text-forest/80 mt-1.5 text-sm">
        It goes back on sale as soon as you do. There is no review to wait for.
      </p>
      {message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {message}
        </p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <Button
          type="submit"
          disabled={pending}
          block={false}
          className="flex-1"
        >
          {pending ? "Resuming…" : "Yes, resume it"}
        </Button>
        <Button
          onClick={() => setArmed(false)}
          disabled={pending}
          variant="secondary"
          block={false}
          className="flex-1"
        >
          Not yet
        </Button>
      </div>
    </form>
  );
}

/**
 * What resuming did — and, for a listing still awaiting its first approval,
 * what it could not do.
 */
/**
 * What resuming did, in the API's own words — yuvoy-operator#44.
 *
 * `next` was suppressed here, and for a real reason: it claimed "Travellers
 * can see it and book it now" unconditionally, which is false for a listing
 * resumed while the account or its documents stop sales. yuvoy-api#167 made
 * the sentence conditional on what is actually true — back on sale; back on
 * the listings but not bookable while something on the account stops sales;
 * or, for a listing never approved, still waiting for its first check — so it
 * is printed verbatim again.
 *
 * The server chooses the sentence better than this screen can. It reads the
 * account's standing and the listing back; this component knows only the
 * state.
 *
 * Both fallbacks stay for an answer that carries no `next`: an older
 * deployment, or a field the API stops sending. Neither claims more than the
 * state supports.
 */
function Resumed({
  state,
  next,
}: {
  state: "published" | "in_review";
  next?: string;
}) {
  if (state === "in_review") {
    return (
      <Panel className="mt-4" role="status">
        <p className="text-base font-bold">
          Still waiting for its first approval
        </p>
        <p className="text-forest/80 mt-2 text-sm">
          {next ??
            "Resuming cannot skip a review that has not happened yet. It goes on sale when we approve it."}
        </p>
      </Panel>
    );
  }
  return (
    <Panel tone="done" className="mt-4" role="status">
      <p className="text-base font-bold">Resumed</p>
      <p className="text-forest/80 mt-2 text-sm">
        {next ??
          "It is back on sale. If anything on your account stops sales, the label on this listing says so. Resuming does not change that."}
      </p>
    </Panel>
  );
}
