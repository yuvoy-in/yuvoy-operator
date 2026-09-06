"use client";

import { useActionState, useState } from "react";
import { createListing, type CreateState } from "./actions";
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
 * ## Category and destination are text, and that is a contract gap
 *
 * The operator document has no way to enumerate either. `category` is a bare
 * string and `destination` is "a destination key in your own market" with
 * nothing that lists the market's keys — so a picker cannot be rendered
 * without this portal inventing a vocabulary the server owns, which is the one
 * thing it must not do.
 *
 * What is done instead: the operator's OWN existing values are offered as
 * suggestions, which makes the second listing a single tap; the first is typed
 * against an example, and the API refuses a wrong one with a message this form
 * shows verbatim. Raised on yuvoy-api rather than papered over.
 */
export function NewListingForm({
  categories,
  destinations,
}: {
  /** Categories this operator already uses. Empty for their first listing. */
  categories: string[];
  /** Destination keys this operator already runs in. */
  destinations: string[];
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
          <input
            id="new-category"
            name="category"
            required
            list={categories.length ? "known-categories" : undefined}
            className={inputClass("mt-2")}
            aria-invalid={state.field === "category" || undefined}
            aria-describedby="new-category-help"
          />
          {categories.length ? (
            <datalist id="known-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          ) : null}
          <p id="new-category-help" className="text-forest/70 mt-1.5 text-xs">
            {categories.length
              ? "Start typing — the kinds you already use will come up."
              : "For example: adventure, nature_wildlife, local_life. If we do not recognise it we will tell you."}
          </p>
        </div>

        <div>
          <label htmlFor="new-destination" className="label text-forest/75">
            Where it runs
          </label>
          <input
            id="new-destination"
            name="destination"
            required
            list={destinations.length ? "known-destinations" : undefined}
            className={inputClass("mt-2")}
            aria-invalid={state.field === "destination" || undefined}
            aria-describedby="new-destination-help"
          />
          {destinations.length ? (
            <datalist id="known-destinations">
              {destinations.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          ) : null}
          <p
            id="new-destination-help"
            className="text-forest/70 mt-1.5 text-xs"
          >
            {destinations.length
              ? "Start typing — the places you already run in will come up."
              : "The place key, like andaman/havelock. It has to be somewhere in your own market."}
          </p>
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
