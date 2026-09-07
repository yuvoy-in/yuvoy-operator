"use client";

import { useActionState, useState } from "react";
import { createListing, type CreateState } from "./actions";
import type { Choice } from "@/lib/services/vocabulary";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * A new listing, in four fields.
 *
 * Three are all the contract requires — title, category, destination — and the
 * fourth is the price, which is optional to the API and load-bearing to the
 * operator: "a listing without `unitPricePaise` can be saved but cannot be
 * approved". So it is asked for here, and its absence is explained on the form
 * rather than discovered after a review that could never have succeeded.
 *
 * Everything else the API defaults, deliberately: party size 6, `per_person`,
 * `request` mode, 120 minutes. A form that re-asked all of it would be a wall
 * between an operator and their first listing, and each of those fields is a
 * *material* change — they belong in the edit-and-review path, which is where
 * they end up.
 *
 * ## Category and destination are pickers now — yuvoy-api#113 is closed
 *
 * They were two text boxes seeded from the operator's own existing listings,
 * because the operator document enumerated neither. That worked for a second
 * listing and was a dead end for a FIRST one: a new operator got a box, an
 * example key, and a `400` after filling the whole form in.
 *
 * `GET /catalog/vocabulary` supplies both, with the label a person uses —
 * "`andaman/havelock` is an identifier and 'Havelock (Swaraj Dweep)' is what an
 * operator calls the place; a picker showing only the key asks somebody to
 * recognise one."
 *
 * Categories come from the request body's own enum and are labelled from the
 * vocabulary, so a slow or failed read cannot empty a picker whose values are
 * known at compile time. Destinations are rows and must come from the response,
 * so an empty list is a state this form renders rather than a failure.
 */
export function NewListingForm({
  categories,
  destinations,
  market,
}: {
  /** Every category the API accepts, labelled. Never empty. */
  categories: Choice[];
  /** The market's open destinations, in the server's own order. May be empty. */
  destinations: Choice[];
  /** The operator's market, named for the empty-destinations case. */
  market: string | null;
}) {
  const [state, act, pending] = useActionState<CreateState, FormData>(
    createListing,
    {},
  );
  const [open, setOpen] = useState(false);

  if (state.created) {
    return (
      <Panel tone="done" role="status">
        <p className="text-base font-bold">{state.created.title} is a draft</p>
        {/*
          Not "saved", and never a tick. "Neither a listing nor a clip goes
          live because the operator said so" — an operator who submits and sees
          a success state will assume they are selling, and will ring us on the
          day nobody books.
        */}
        <p className="text-forest/80 mt-2 text-sm">
          It is on your list below and reaches nobody yet. Send it to us when it
          reads the way you want it to; approval is what puts it on sale.
        </p>
        <Button
          onClick={() => setOpen(false)}
          variant="secondary"
          className="mt-4"
        >
          Done
        </Button>
      </Panel>
    );
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="primary">
        Add an activity
      </Button>
    );
  }

  return (
    <Panel>
      <form action={act} className="space-y-5">
        <div>
          <label htmlFor="new-title" className="label text-forest/75">
            What is it called
          </label>
          <input
            id="new-title"
            name="title"
            required
            autoFocus
            className={inputClass("mt-2")}
            aria-invalid={state.field === "title" || undefined}
            aria-describedby="new-title-help"
          />
          <p id="new-title-help" className="text-forest/70 mt-1.5 text-xs">
            The first thing a traveller reads. &ldquo;Try-dive at Nemo
            Reef&rdquo;, not &ldquo;Package A&rdquo;.
          </p>
        </div>

        <div>
          <label htmlFor="new-category" className="label text-forest/75">
            What kind of thing it is
          </label>
          <select
            id="new-category"
            name="category"
            required
            defaultValue=""
            className={inputClass("mt-2")}
            aria-invalid={state.field === "category" || undefined}
          >
            <option value="">Choose one</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="new-destination" className="label text-forest/75">
            Where it runs
          </label>
          {destinations.length > 0 ? (
            <select
              id="new-destination"
              name="destination"
              required
              defaultValue={
                destinations.length === 1 ? destinations[0].value : ""
              }
              className={inputClass("mt-2")}
              aria-invalid={state.field === "destination" || undefined}
              aria-describedby="new-destination-help"
            >
              {destinations.length === 1 ? null : (
                <option value="">Choose one</option>
              )}
              {destinations.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          ) : (
            /*
              "Empty means we have not opened one yet, which is a state worth
              rendering rather than a failure." Said plainly, with no input —
              a disabled picker with nothing in it invites somebody to keep
              tapping it.
            */
            <p
              id="new-destination-help"
              className="text-terra-deep mt-2 text-sm font-bold"
            >
              We have not opened a destination in {market ?? "your market"} yet.
              Message us and we will.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="new-price" className="label text-forest/75">
            Price per person
          </label>
          <input
            id="new-price"
            name="unitPrice"
            inputMode="numeric"
            className={inputClass("mt-2")}
            aria-invalid={state.field === "unitPrice" || undefined}
            aria-describedby="new-price-help"
          />
          {/*
            The one optional field whose absence has a consequence worth saying
            up front. `sellable: false` is reported by the API and means the
            listing "saves but cannot be approved" — so an operator who leaves
            it blank should know now rather than after waiting for a review.
          */}
          <p id="new-price-help" className="text-forest/70 mt-1.5 text-xs">
            In rupees. You can leave it out and add it later — but we cannot
            approve a listing with no price, so it will sit as a draft until
            there is one.
          </p>
        </div>

        {state.message ? (
          <p role="alert" className="text-terra-deep text-sm font-bold">
            {state.message}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={pending}
            variant="primary"
            block={false}
            className="flex-1"
          >
            {pending ? "Saving…" : "Save as a draft"}
          </Button>
          <Button
            onClick={() => setOpen(false)}
            disabled={pending}
            variant="secondary"
            block={false}
            className="flex-1"
          >
            Not now
          </Button>
        </div>
      </form>
    </Panel>
  );
}
