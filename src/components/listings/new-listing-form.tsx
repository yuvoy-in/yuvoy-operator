"use client";

import { useActionState, useState } from "react";
import { createListing, type CreateState } from "./actions";
import {
  activityChoices,
  screenerChoices,
  type Choice,
  type Vocabulary,
} from "@/lib/services/vocabulary";
import { PRICING_UNITS } from "@/lib/services/listings";
import { commissionPreview, formatRate } from "@/lib/services/commission";
import { formatPaise } from "@/lib/format/money";
import { Button, ButtonLink } from "@/components/ui/button";
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
  vocabulary,
  destinations,
  market,
  commissionRateBps,
  startOpen = false,
}: {
  /** Every category the API accepts, labelled. Never empty. */
  categories: Choice[];
  /**
   * The whole vocabulary, so the activity picker can narrow to the chosen
   * category — yuvoy-operator#30 §2. The pair is enforced by a composite
   * foreign key, so offering activities from another category only moves the
   * 400 to after the form is filled in.
   */
  vocabulary: Vocabulary | null;
  /** The market's open destinations, in the server's own order. May be empty. */
  destinations: Choice[];
  /** The operator's market, named for the empty-destinations case. */
  market: string | null;
  /**
   * What Yuvoy keeps, in basis points, for the "you receive" preview.
   *
   * `null` when the API sent none, in which case no preview is drawn at all —
   * see the note beside the price field.
   */
  commissionRateBps: number | null;
  /**
   * Whether the form is already open.
   *
   * It collapsed behind its own button because it lived at the top of a LIST,
   * where a permanently open form pushed the listings an operator came to read
   * off the screen. On `/account/listings/new` the screen IS the form (#58),
   * and a button repeating the heading is a second door into the room you are
   * standing in.
   */
  startOpen?: boolean;
}) {
  const [state, act, pending] = useActionState<CreateState, FormData>(
    createListing,
    {},
  );
  const [open, setOpen] = useState(startOpen);
  // Drives the activity picker below, which narrows to the chosen category.
  const [category, setCategory] = useState<string | null>(null);
  const activities = activityChoices(vocabulary, category);
  const screeners = screenerChoices(vocabulary);

  /*
    The price, held so the "you receive" line can follow it as it is typed.
    Rupees on screen and paise in the arithmetic: the split is computed in
    integer paise and rounded once, because a preview that disagrees with the
    settlement by a paisa invites a conversation about whether we can count.
  */
  const [price, setPrice] = useState("");
  const rupees = Number(price.replace(/[^\d.]/g, ""));
  const split = commissionPreview(
    Number.isFinite(rupees) && rupees > 0 ? Math.round(rupees * 100) : null,
    commissionRateBps,
  );

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
        {/*
          On its own screen there is nowhere to collapse to, and the draft it
          just made is the thing to open next.
        */}
        {startOpen ? (
          <ButtonLink
            href={`/account/listings/${state.created.id}`}
            variant="secondary"
            className="mt-4"
          >
            Open it
          </ButtonLink>
        ) : (
          <Button
            onClick={() => setOpen(false)}
            variant="secondary"
            className="mt-4"
          >
            Done
          </Button>
        )}
      </Panel>
    );
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="primary">
        Add a listing
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
            onChange={(e) => setCategory(e.target.value || null)}
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
          What it actually IS — yuvoy-operator#30 §2.

          The twelve categories are market-agnostic, so in the Andamans every
          water sport is `adventure`. That stopped being merely imprecise when
          credential requirements moved to resolve per activity type: keyed to
          the activity, a lapsed instructor certificate stops the scuba listing
          while the operator's other listings keep selling.

          Rendered only once a category is chosen, and narrowed to it. Hidden
          rather than disabled when the vocabulary read failed — the create form
          degrades to what it can still do rather than showing a control with
          nothing in it.
        */}
        {activities.length > 0 ? (
          <div>
            <label htmlFor="new-activity" className="label text-forest/75">
              What kind of activity
            </label>
            <select
              id="new-activity"
              name="activityType"
              defaultValue=""
              className={inputClass("mt-2")}
              aria-invalid={state.field === "activityType" || undefined}
              aria-describedby="new-activity-help"
            >
              <option value="">Choose one</option>
              {activities.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
            <p id="new-activity-help" className="text-forest/70 mt-1.5 text-xs">
              This decides which documents we need from you, so a lapsed
              certificate stops only the listings it applies to.
            </p>
          </div>
        ) : null}

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
          {/*
            "Price", not "Price per person" — the label used to state the basis
            it is now asking about, which is the same misstatement this change
            exists to remove (yuvoy-operator#30 §1).
          */}
          <label htmlFor="new-price" className="label text-forest/75">
            Price
          </label>
          <input
            id="new-price"
            name="unitPrice"
            inputMode="numeric"
            className={inputClass("mt-2")}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            aria-invalid={state.field === "unitPrice" || undefined}
            aria-describedby="new-price-help"
          />

          {/*
            WHAT THE BUSINESS RECEIVES — yuvoy-operator#44.

            The form asked for a price and never said what arrives. The rate
            was nowhere on a readable response until yuvoy-api#180, and
            hardcoding 15% was refused on 11 September: a business on its own
            negotiated rate would have been shown a figure that was wrong about
            its own money.

            It is a PREVIEW and says so. Each booking freezes its own
            commission at capture, so a rate that changes later never restates
            one already taken — and a line that read as a promise would be the
            wrong kind of precise.

            Nothing at all when there is no rate: "absent where the service was
            not given a standard rate" is not a rate of zero, and rendering the
            whole fare as received would be the most flattering possible wrong
            answer. See `commissionPreview`.
          */}
          {split ? (
            <p role="status" className="text-forest/80 mt-2 text-sm">
              You receive{" "}
              <span className="font-bold">
                {formatPaise(split.receivePaise)}
              </span>{" "}
              of that, at your {formatRate(commissionRateBps!)} rate. It is
              worked out again on each booking.
            </p>
          ) : null}

          {/*
            The one optional field whose absence has a consequence worth saying
            up front. `sellable: false` is reported by the API and means the
            listing "saves but cannot be approved" — so an operator who leaves
            it blank should know now rather than after waiting for a review.
          */}
          <p id="new-price-help" className="text-forest/70 mt-1.5 text-xs">
            In rupees. You can leave it out and add it later, but we cannot
            approve a listing with no price, so it will sit as a draft until
            there is one.
          </p>
        </div>

        {/*
          What that price MEANS — yuvoy-operator#30 §1.

          Radios rather than a select, and **neither preselected**. The API
          stopped defaulting `pricingUnit` so that a listing nobody was asked
          about is recorded as unstated rather than as per-person; a control
          that arrived with one already chosen would send a quiet assumption
          and defeat the whole change. The refusal lives in the action, so a
          price with no basis is refused rather than guessed.

          A fieldset, not a bare group: three radios with a visible question
          need the question in the accessibility tree too, or a screen reader
          reads "Per person / For the group" with nothing saying what of.
        */}
        <fieldset>
          <legend className="label text-forest/75">
            Is that per person, or for the whole group?
          </legend>
          <p className="text-forest/70 mt-1.5 text-xs">
            A private charter priced for six is not the same as a seat price,
            and a traveller sees whichever you say here next to the figure.
          </p>
          <div className="mt-3 space-y-2">
            {PRICING_UNITS.map((unit) => (
              <label
                key={unit.value}
                className="border-cream-line rounded-control flex min-h-14 cursor-pointer items-start gap-3 border p-3"
              >
                <input
                  type="radio"
                  name="pricingUnit"
                  value={unit.value}
                  className="accent-forest mt-0.5 size-5 shrink-0"
                  aria-invalid={state.field === "pricingUnit" || undefined}
                />
                <span>
                  <span className="block text-sm font-bold">{unit.label}</span>
                  <span className="text-forest/70 block text-xs">
                    {unit.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/*
          Duration and party size — yuvoy-operator#30 §5.

          The server defaults these to 120 minutes and 6 people and nothing
          could set them, so every listing this portal has ever created claims
          two hours and six people. Duration reaches the traveller's card, so
          that is a claim rather than a harmless default.

          Side by side, and both optional: a first draft should not be blocked
          on them, and the help text says what silence costs rather than
          refusing.
        */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="new-duration" className="label text-forest/75">
              How long, in minutes
            </label>
            <input
              id="new-duration"
              name="durationMinutes"
              inputMode="numeric"
              placeholder="120"
              className={inputClass("mt-2")}
              aria-invalid={state.field === "durationMinutes" || undefined}
              aria-describedby="new-duration-help"
            />
          </div>
          <div>
            <label htmlFor="new-party" className="label text-forest/75">
              Most people per booking
            </label>
            <input
              id="new-party"
              name="maxPartySize"
              inputMode="numeric"
              placeholder="6"
              className={inputClass("mt-2")}
              aria-invalid={state.field === "maxPartySize" || undefined}
            />
          </div>
        </div>
        <p id="new-duration-help" className="text-forest/70 -mt-2 text-xs">
          Leave either blank and we use two hours and six people. A traveller
          sees the duration on the card, so it is worth saying.
        </p>

        {/*
          THE WAIVER — yuvoy-operator#44, yuvoy-api#180.

          The one field on this form that is a safety control rather than a
          description: with a screener set, "a party that declares a condition
          is refused before any seat is held or money taken".

          Its keys come from the vocabulary, not from a list here: a screener
          is "added or retired on medical advice rather than by a release", so
          a hardcoded option would be refused with a 400 the day one changed.
          The same read decides which keys a write accepts, so every option
          offered is one the server will take.

          Rendered only when there is something to choose. An empty list is a
          real answer — no screener can be chosen yet — and a picker with one
          disabled option is a control that asks for a decision nobody can
          make.
        */}
        {screeners.length > 0 ? (
          <div>
            <label htmlFor="new-screener" className="label text-forest/75">
              Health check before booking
            </label>
            <select
              id="new-screener"
              name="screenerKey"
              defaultValue=""
              className={inputClass("mt-2")}
              aria-invalid={state.field === "screenerKey" || undefined}
              aria-describedby="new-screener-help"
            >
              {/*
                "None" is a real choice and the default one. An empty
                `screenerKey` is always allowed, and most listings need no
                waiver at all.
              */}
              <option value="">No health check</option>
              {screeners.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <p id="new-screener-help" className="text-forest/70 mt-1.5 text-xs">
              Anybody booking answers these before they can pay, and a party
              that declares a condition is turned away before any seat is held.
              Leave it off unless your activity needs one.
            </p>
          </div>
        ) : null}

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
