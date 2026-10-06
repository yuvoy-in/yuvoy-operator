"use client";

import { useActionState } from "react";
import { saveLocation, type StepState } from "../builder-actions";
import { screenerChoices, type Vocabulary } from "@/lib/services/vocabulary";
import { fieldLabelClass, inputClass } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MeetingPin } from "@/components/map/meeting-pin";
import { pinOf, pinsSupported } from "@/lib/map/pin";
import { sendForm } from "@/lib/actions/send-form";
import { notSaved, StepShell } from "./step-shell";
import { fieldMarks } from "./field-marks";
import { FieldLabel } from "./field-help";

/**
 * Step 4 — where the day starts, and what it needs of the people on it.
 *
 * The health screener is the field with a consequence: with one set, a party
 * that declares a condition is refused before any seat is held or any money is
 * taken. That is said plainly beside the picker, because it turns somebody away
 * and an operator should choose it knowing so.
 *
 * The meeting point can carry a pin as well as its words (yuvoy-operator#113),
 * offered only when the API the listing came from takes one (`pinsSupported`).
 */
export function LocationStep({
  id,
  listing,
  vocabulary,
  back,
  flagged,
}: {
  id: string;
  listing: {
    meetingPoint?: string;
    meetingLandmark?: string;
    meetingLat?: number | null;
    meetingLng?: number | null;
    inclusions?: string[];
    requirements?: string[];
    safetyNotes?: string;
    screenerKey?: string;
  };
  vocabulary: Vocabulary | null;
  back: string;
  /** The field Edit was opened for, still needed: marked in place (O12). */
  flagged?: string;
}) {
  /*
    A refusal hands back what was typed (`sendForm`) and the fields read it in
    place. The form is NOT remounted the way Basics is: the meeting pin's map
    would load again with every refusal, and a refusal for no signal is the
    one time its tiles could not come back. The pin keeps itself (its two
    fields are hidden, which a reset never touches), and the health check, a
    select React reads only when it mounts, is keyed on the attempt by itself.
  */
  const [state, act, pending] = useActionState(
    sendForm<StepState>(saveLocation, notSaved),
    {},
  );
  const typed = state.typed;
  const screeners = screenerChoices(vocabulary);
  const { marked, describedBy, needed } = fieldMarks(state.fields, flagged);

  return (
    <StepShell
      title="Location and safety"
      action={act}
      pending={pending}
      message={state.message}
      back={back}
    >
      <input type="hidden" name="id" value={id} />

      <div>
        <FieldLabel htmlFor="l-meeting" required>
          Where to meet
        </FieldLabel>
        {needed("meetingPoint", "l-meeting")}
        <input
          id="l-meeting"
          name="meetingPoint"
          required
          defaultValue={typed?.meetingPoint ?? listing.meetingPoint ?? ""}
          className={inputClass("voice-host mt-2")}
          aria-invalid={marked("meetingPoint")}
          aria-describedby={describedBy("meetingPoint", "l-meeting")}
        />
      </div>

      <div>
        <label htmlFor="l-landmark" className={fieldLabelClass()}>
          What to look for
        </label>
        {needed("meetingLandmark", "l-landmark")}
        <input
          id="l-landmark"
          name="meetingLandmark"
          defaultValue={typed?.meetingLandmark ?? listing.meetingLandmark ?? ""}
          className={inputClass("voice-host mt-2")}
          aria-describedby={describedBy(
            "meetingLandmark",
            "l-landmark",
            "l-landmark-help",
          )}
          aria-invalid={marked("meetingLandmark")}
        />
        <p id="l-landmark-help" className="text-forest/70 mt-1.5 text-xs">
          A landmark nearby: the blue boat shed, the temple gate.
        </p>
      </div>

      {pinsSupported(listing) ? <MeetingPin initial={pinOf(listing)} /> : null}

      <div>
        <label htmlFor="l-inclusions" className={fieldLabelClass()}>
          What is included
        </label>
        <Textarea
          id="l-inclusions"
          name="inclusions"
          rows={4}
          defaultValue={
            typed?.inclusions ?? (listing.inclusions ?? []).join("\n")
          }
          className={inputClass("voice-host mt-2 h-auto py-3")}
          aria-describedby="l-inclusions-help"
        />
        <p id="l-inclusions-help" className="text-forest/70 mt-1.5 text-xs">
          One per line.
        </p>
      </div>

      <div>
        <label htmlFor="l-requirements" className={fieldLabelClass()}>
          What a traveller needs
        </label>
        <Textarea
          id="l-requirements"
          name="requirements"
          rows={4}
          defaultValue={
            typed?.requirements ?? (listing.requirements ?? []).join("\n")
          }
          className={inputClass("voice-host mt-2 h-auto py-3")}
          aria-describedby="l-requirements-help"
        />
        <p id="l-requirements-help" className="text-forest/70 mt-1.5 text-xs">
          What to bring, and what they need to be able to do. One per line.
        </p>
      </div>

      <div>
        <label htmlFor="l-safety" className={fieldLabelClass()}>
          Safety notes
        </label>
        <Textarea
          id="l-safety"
          name="safetyNotes"
          rows={3}
          defaultValue={typed?.safetyNotes ?? listing.safetyNotes ?? ""}
          className={inputClass("voice-host mt-2 h-auto py-3")}
        />
      </div>

      {screeners.length > 0 ? (
        <div>
          <label htmlFor="l-screener" className={fieldLabelClass()}>
            Health check before booking
          </label>
          <select
            key={state.attempt ?? 0}
            id="l-screener"
            name="screenerKey"
            defaultValue={typed?.screenerKey ?? listing.screenerKey ?? ""}
            className={inputClass("mt-2")}
            aria-invalid={marked("screenerKey")}
            aria-describedby="l-screener-help"
          >
            <option value="">None</option>
            {screeners.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <p id="l-screener-help" className="text-forest/70 mt-1.5 text-xs">
            A party that declares a condition is turned away before any seat is
            held. Most listings need none.
          </p>
        </div>
      ) : null}
    </StepShell>
  );
}
