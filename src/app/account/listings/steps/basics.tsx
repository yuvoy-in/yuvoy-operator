"use client";

import { useActionState, useRef, useState } from "react";
import { saveBasics, type StepState } from "../builder-actions";
import {
  activityChoices,
  type Choice,
  type Vocabulary,
} from "@/lib/services/vocabulary";
import { inputClass } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useChangedBeforeHydration } from "@/components/ui/use-changed-before-hydration";
import { sendForm } from "@/lib/actions/send-form";
import { notSaved, StepShell } from "./step-shell";
import { fieldMarks } from "./field-marks";
import { FieldLabel, Why } from "./field-help";

/**
 * Step 1 — what the listing IS.
 *
 * The one step that can run without a draft behind it: on `/account/listings/
 * new` there is no id yet, and saving here is what creates one. Every later
 * step is a `PATCH` and needs the id this produces.
 *
 * Labels and boxes (yuvoy-operator#110): `Required` on the three the save
 * refuses without, one example under the name, and every reason folded behind
 * a disclosure. See `field-help.tsx`.
 */
export function BasicsStep({
  id,
  vocabulary,
  categories,
  destinations,
  listing,
  flagged,
}: {
  id: string;
  vocabulary: Vocabulary | null;
  categories: Choice[];
  destinations: Choice[];
  listing: {
    title?: string;
    category?: string;
    activityType?: string;
    destination?: string;
    summary?: string;
    description?: string;
  };
  /** The field Edit was opened for, still needed: marked in place (O12). */
  flagged?: string;
}) {
  const [state, act, pending] = useActionState(
    sendForm<StepState>(saveBasics, notSaved),
    {},
  );
  /*
    A refusal remounts the form onto what was typed (`attempt`, see
    `sendForm`): the category is a select held in state, which a reset in
    place would show as "Choose one" while the activities below still
    followed the category chosen. Every default reads `typed` first.
  */
  const typed = state.typed;
  const [category, setCategory] = useState(listing.category ?? "");
  // Chosen before the page hydrated: the kinds below follow it.
  const categoryField = useRef<HTMLSelectElement>(null);
  useChangedBeforeHydration(categoryField, ([field]) =>
    setCategory(field.value),
  );
  const activities = activityChoices(vocabulary, category || null);
  const { marked, describedBy, needed } = fieldMarks(state.fields, flagged);

  return (
    <StepShell
      title="Basics"
      action={act}
      pending={pending}
      message={state.message}
      attempt={state.attempt}
    >
      <input type="hidden" name="id" value={id} />

      <div>
        <FieldLabel htmlFor="b-title" required>
          Name
        </FieldLabel>
        {needed("title", "b-title")}
        <input
          id="b-title"
          name="title"
          required
          minLength={3}
          defaultValue={typed?.title ?? listing.title ?? ""}
          className={inputClass("voice-host mt-2")}
          aria-invalid={marked("title")}
          aria-describedby={describedBy("title", "b-title", "b-title-help")}
        />
        <p id="b-title-help" className="text-forest/70 mt-1.5 text-xs">
          For example, &ldquo;Try-dive at Nemo Reef&rdquo;.
        </p>
        <Why>
          It is the first thing a traveller reads, so &ldquo;Package A&rdquo;
          tells them nothing.
        </Why>
      </div>

      <div>
        <FieldLabel htmlFor="b-category" required>
          Category
        </FieldLabel>
        {needed("category", "b-category")}
        <select
          ref={categoryField}
          id="b-category"
          name="category"
          required
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={inputClass("mt-2")}
          aria-invalid={marked("category")}
          aria-describedby={describedBy("category", "b-category")}
        >
          <option value="">Choose one</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/*
        Narrowed to the category, because the pair is enforced by a composite
        foreign key: offering `scuba` under `food_drink` only moves the 400 to
        after the form is filled in. Hidden rather than empty when the
        vocabulary read failed.
      */}
      {activities.length > 0 ? (
        <div>
          <FieldLabel htmlFor="b-activity">Activity</FieldLabel>
          {needed("activityType", "b-activity")}
          <select
            id="b-activity"
            name="activityType"
            defaultValue={typed?.activityType ?? listing.activityType ?? ""}
            className={inputClass("mt-2")}
            aria-invalid={marked("activityType")}
            aria-describedby={describedBy("activityType", "b-activity")}
          >
            <option value="">Choose one</option>
            {activities.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <Why>
            It decides which documents we need from you, so a lapsed certificate
            stops only the listings it applies to.
          </Why>
        </div>
      ) : null}

      <div>
        <FieldLabel htmlFor="b-destination" required>
          Where it runs
        </FieldLabel>
        {needed("destination", "b-destination")}
        <select
          id="b-destination"
          name="destination"
          required
          defaultValue={typed?.destination ?? listing.destination ?? ""}
          className={inputClass("mt-2")}
          aria-invalid={marked("destination")}
          aria-describedby={describedBy("destination", "b-destination")}
        >
          <option value="">Choose one</option>
          {destinations.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <FieldLabel htmlFor="b-summary">One line about it</FieldLabel>
        {needed("summary", "b-summary")}
        <input
          id="b-summary"
          name="summary"
          defaultValue={typed?.summary ?? listing.summary ?? ""}
          className={inputClass("voice-host mt-2")}
          aria-invalid={marked("summary")}
          aria-describedby={describedBy("summary", "b-summary")}
        />
      </div>

      <div>
        <FieldLabel htmlFor="b-description">What happens on the day</FieldLabel>
        {needed("description", "b-description")}
        <Textarea
          id="b-description"
          name="description"
          rows={5}
          defaultValue={typed?.description ?? listing.description ?? ""}
          className={inputClass("voice-host mt-2 h-auto py-3")}
          aria-invalid={marked("description")}
          aria-describedby={describedBy("description", "b-description")}
        />
        {/*
          A tip, never a refusal. The API takes a short description and so does
          this: blocking a save over a character count would stop somebody
          writing the rest of the listing. Folded, and named for the question
          it answers, because it is advice rather than a reason (#110).
        */}
        <Why summary="How much to write?">
          30 characters or more reads best.
        </Why>
      </div>
    </StepShell>
  );
}
