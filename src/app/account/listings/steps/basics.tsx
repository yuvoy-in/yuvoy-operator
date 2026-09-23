"use client";

import { useActionState, useState } from "react";
import { saveBasics, type StepState } from "../builder-actions";
import {
  activityChoices,
  type Choice,
  type Vocabulary,
} from "@/lib/services/vocabulary";
import { fieldLabelClass, inputClass } from "@/components/ui/input";
import { StepShell } from "./step-shell";

/**
 * Step 1 — what the listing IS.
 *
 * The one step that can run without a draft behind it: on `/account/listings/
 * new` there is no id yet, and saving here is what creates one. Every later
 * step is a `PATCH` and needs the id this produces.
 */
export function BasicsStep({
  id,
  vocabulary,
  categories,
  destinations,
  listing,
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
}) {
  const [state, act, pending] = useActionState<StepState, FormData>(
    saveBasics,
    {},
  );
  const [category, setCategory] = useState(listing.category ?? "");
  const activities = activityChoices(vocabulary, category || null);
  const marked = (field: string) => state.fields?.includes(field) || undefined;

  return (
    <StepShell
      title="Basics"
      blurb="What it is, where it runs, and the line a traveller reads first."
      action={act}
      pending={pending}
      message={state.message}
    >
      <input type="hidden" name="id" value={id} />

      <div>
        <label htmlFor="b-title" className={fieldLabelClass()}>
          Name
        </label>
        <input
          id="b-title"
          name="title"
          required
          minLength={3}
          defaultValue={listing.title ?? ""}
          className={inputClass("mt-2")}
          aria-invalid={marked("title")}
          aria-describedby="b-title-help"
        />
        <p id="b-title-help" className="text-forest/70 mt-1.5 text-xs">
          The first thing a traveller reads. &ldquo;Try-dive at Nemo
          Reef&rdquo;, not &ldquo;Package A&rdquo;.
        </p>
      </div>

      <div>
        <label htmlFor="b-category" className={fieldLabelClass()}>
          Category
        </label>
        <select
          id="b-category"
          name="category"
          required
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={inputClass("mt-2")}
          aria-invalid={marked("category")}
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
          <label htmlFor="b-activity" className={fieldLabelClass()}>
            Activity
          </label>
          <select
            id="b-activity"
            name="activityType"
            defaultValue={listing.activityType ?? ""}
            className={inputClass("mt-2")}
            aria-invalid={marked("activityType")}
            aria-describedby="b-activity-help"
          >
            <option value="">Choose one</option>
            {activities.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <p id="b-activity-help" className="text-forest/70 mt-1.5 text-xs">
            This decides which documents we need from you, so a lapsed
            certificate stops only the listings it applies to.
          </p>
        </div>
      ) : null}

      <div>
        <label htmlFor="b-destination" className={fieldLabelClass()}>
          Where it runs
        </label>
        <select
          id="b-destination"
          name="destination"
          required
          defaultValue={listing.destination ?? ""}
          className={inputClass("mt-2")}
          aria-invalid={marked("destination")}
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
        <label htmlFor="b-summary" className={fieldLabelClass()}>
          One line about it
        </label>
        <input
          id="b-summary"
          name="summary"
          defaultValue={listing.summary ?? ""}
          className={inputClass("mt-2")}
          aria-invalid={marked("summary")}
        />
      </div>

      <div>
        <label htmlFor="b-description" className={fieldLabelClass()}>
          What happens on the day
        </label>
        <textarea
          id="b-description"
          name="description"
          rows={5}
          defaultValue={listing.description ?? ""}
          className={inputClass("mt-2 h-auto py-3")}
          aria-invalid={marked("description")}
          aria-describedby="b-description-help"
        />
        {/*
          A hint, never a refusal. The API takes a short description and so does
          this: blocking a save over a character count would stop somebody
          writing the rest of the listing.
        */}
        <p id="b-description-help" className="text-forest/70 mt-1.5 text-xs">
          30 characters or more reads best.
        </p>
      </div>
    </StepShell>
  );
}
