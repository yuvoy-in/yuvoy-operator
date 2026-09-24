"use client";

import { useActionState } from "react";
import { saveLocation, type StepState } from "../builder-actions";
import { screenerChoices, type Vocabulary } from "@/lib/services/vocabulary";
import { fieldLabelClass, inputClass } from "@/components/ui/input";
import { StepShell } from "./step-shell";
import { fieldMarks } from "./field-marks";

/**
 * Step 4 — where the day starts, and what it needs of the people on it.
 *
 * The health screener is the field with a consequence: with one set, a party
 * that declares a condition is refused before any seat is held or any money is
 * taken. That is said plainly beside the picker, because it turns somebody away
 * and an operator should choose it knowing so.
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
  const [state, act, pending] = useActionState<StepState, FormData>(
    saveLocation,
    {},
  );
  const screeners = screenerChoices(vocabulary);
  const { marked, describedBy, needed } = fieldMarks(state.fields, flagged);

  return (
    <StepShell
      title="Location and safety"
      blurb="Where to meet, what is included, and anything a traveller has to bring or be able to do."
      action={act}
      pending={pending}
      message={state.message}
      back={back}
    >
      <input type="hidden" name="id" value={id} />

      <div>
        <label htmlFor="l-meeting" className={fieldLabelClass()}>
          Where to meet
        </label>
        {needed("meetingPoint", "l-meeting")}
        <input
          id="l-meeting"
          name="meetingPoint"
          required
          defaultValue={listing.meetingPoint ?? ""}
          className={inputClass("mt-2")}
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
          defaultValue={listing.meetingLandmark ?? ""}
          className={inputClass("mt-2")}
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

      <div>
        <label htmlFor="l-inclusions" className={fieldLabelClass()}>
          What is included
        </label>
        <textarea
          id="l-inclusions"
          name="inclusions"
          rows={4}
          defaultValue={(listing.inclusions ?? []).join("\n")}
          className={inputClass("mt-2 h-auto py-3")}
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
        <textarea
          id="l-requirements"
          name="requirements"
          rows={4}
          defaultValue={(listing.requirements ?? []).join("\n")}
          className={inputClass("mt-2 h-auto py-3")}
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
        <textarea
          id="l-safety"
          name="safetyNotes"
          rows={3}
          defaultValue={listing.safetyNotes ?? ""}
          className={inputClass("mt-2 h-auto py-3")}
        />
      </div>

      {screeners.length > 0 ? (
        <div>
          <label htmlFor="l-screener" className={fieldLabelClass()}>
            Health check before booking
          </label>
          <select
            id="l-screener"
            name="screenerKey"
            defaultValue={listing.screenerKey ?? ""}
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
