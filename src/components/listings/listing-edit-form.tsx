"use client";

/** The edit form, moved out of listing-row.tsx (yuvoy-operator#178). */
import type { RevisionState } from "./actions";
import { onlyChanged } from "@/lib/services/revision-outcome";
import {
  PRICING_UNITS,
  type OperatorExperience,
} from "@/lib/services/listings";
import { activityChoices, type Vocabulary } from "@/lib/services/vocabulary";
import { Button } from "@/components/ui/button";
import { fieldLabelClass, inputClass } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MeetingPin } from "@/components/map/meeting-pin";
import { pinOf, pinsSupported } from "@/lib/map/pin";
import type { Typed } from "@/lib/actions/send-form";

/** The pin's two numbers move together or not at all (yuvoy-api#249). */
const PIN_PAIR = [["meetingLat", "meetingLng"]] as const;

/**
 * The form a listing is changed on, and sent for review from.
 *
 * `ListingRow` holds the action's state, because its answer replaces this
 * form on the row.
 */
export function ListingEditForm({
  listing,
  vocabulary,
  selling,
  state,
  act,
  pending,
  onCancel,
}: {
  listing: OperatorExperience;
  vocabulary: Vocabulary | null;
  selling: boolean;
  state: Typed<RevisionState>;
  act: (form: FormData) => void;
  pending: boolean;
  onCancel: () => void;
}) {
  /*
    Narrowed to the listing's OWN category, which is fixed after creation —
    `category` is on neither form once a listing exists, and that is right:
    changing what something fundamentally is deserves more than an inline
    edit. So unlike the create form's picker this one needs no category state.
  */
  const activities = activityChoices(vocabulary, listing.category ?? null);

  const defaults = formDefaults(listing);
  /*
    What the form shows: what is on file, under whatever a refusal handed back
    (`sendForm`). The action is sent only what changed, so that is all that
    comes back, and every other field is on file anyway. Read in place rather
    than by remounting the form, which would load the pin's map again with
    every refusal; the activity, a select React reads only when it mounts, is
    keyed on the attempt by itself. Twelve fields used to go back to what was
    on file over one refused price.
  */
  const shown: Record<string, string> = { ...defaults, ...state.typed };

  return (
    <form
      /*
        Only what changed goes (see `onlyChanged`): every field is filled
        in with what is on file, and a field nobody touched is not a change
        anybody asked for.
      */
      action={(form) => act(onlyChanged(form, defaults, PIN_PAIR))}
      className="border-paper-line mt-4 border-t pt-4"
    >
      <input type="hidden" name="id" value={listing.id ?? ""} />

      {/*
        THE NAME, WHICH COULD NOT BE CHANGED — found by the publish-blocker
        check added for yuvoy-operator#39, not asked for by it.

        `submitRevision` has read `title` off this form since it was
        written and no form has ever sent one, so an operator with a typo
        in their own listing's name had to ring us and have somebody fix it
        from the admin console — the concierge path this portal exists to
        remove. It is also a publish blocker, so an admin-created listing
        with no title had no way to acquire one.

        `min(3)` in the schema, and `required` here: an edit that blanks a
        title is not a clearing an operator means.
      */}
      <div>
        <label htmlFor={`title-${listing.id}`} className={fieldLabelClass()}>
          Name
        </label>
        <input
          id={`title-${listing.id}`}
          name="title"
          required
          minLength={3}
          defaultValue={shown.title}
          className={inputClass("voice-host mt-2")}
        />
      </div>

      <div className="mt-4">
        <label htmlFor={`summary-${listing.id}`} className={fieldLabelClass()}>
          One line about it
        </label>
        <input
          id={`summary-${listing.id}`}
          name="summary"
          defaultValue={shown.summary}
          className={inputClass("voice-host mt-2")}
        />
      </div>

      {/*
        WHAT IT ACTUALLY IS — yuvoy-operator#39.

        The same selector the create form has, which the edit form did not,
        so a listing that predates the taxonomy could never acquire an
        activity type. The refusal arrived at approval — after a wait, from
        somebody else, naming a field that was not on the operator's
        screen. That is a worse shape than being told at the door.

        Hidden rather than disabled when the vocabulary read failed, like
        the create form: a control with nothing in it is not an edit an
        operator can make, and the rest of this form still works.
      */}
      {activities.length > 0 ? (
        <div className="mt-4">
          <label
            htmlFor={`activity-${listing.id}`}
            className={fieldLabelClass()}
          >
            Activity
          </label>
          <select
            key={state.attempt ?? 0}
            id={`activity-${listing.id}`}
            name="activityType"
            defaultValue={shown.activityType}
            className={inputClass("mt-2")}
            aria-describedby={`activity-help-${listing.id}`}
          >
            <option value="">Choose one</option>
            {activities.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <p
            id={`activity-help-${listing.id}`}
            className="text-forest/70 mt-1.5 text-xs"
          >
            {listing.activityType
              ? "This decides which documents we need from you, so a lapsed certificate stops only the listings it applies to."
              : "We need this before this listing can be approved. It decides which documents we need from you, so a lapsed certificate stops only the listings it applies to."}
          </p>
        </div>
      ) : null}

      <div className="mt-4">
        <label
          htmlFor={`description-${listing.id}`}
          className={fieldLabelClass()}
        >
          What happens on the day
        </label>
        <Textarea
          id={`description-${listing.id}`}
          name="description"
          rows={4}
          defaultValue={shown.description}
          className={inputClass("voice-host mt-2 h-auto py-3")}
        />
      </div>

      <div className="mt-4">
        <label htmlFor={`meeting-${listing.id}`} className={fieldLabelClass()}>
          Where to meet
        </label>
        <input
          id={`meeting-${listing.id}`}
          name="meetingPoint"
          defaultValue={shown.meetingPoint}
          className={inputClass("voice-host mt-2")}
        />
      </div>

      {/*
        The pin on the meeting point (yuvoy-operator#113). Here as well as
        in the builder, because every listing on sale today is past the
        builder and this is the only way to give one a pin. It is the
        operator's own field (D-032.3): it goes live when sent.
      */}
      {pinsSupported(listing) ? (
        <div className="mt-4">
          <MeetingPin initial={pinOf(listing)} />
        </div>
      ) : null}

      <div className="mt-4">
        <label htmlFor={`price-${listing.id}`} className={fieldLabelClass()}>
          Price
        </label>
        <input
          id={`price-${listing.id}`}
          name="unitPrice"
          inputMode="numeric"
          defaultValue={shown.unitPrice}
          className={inputClass("mt-2")}
        />
        <p className="text-forest/70 mt-1.5 text-xs">In rupees.</p>
      </div>

      {/*
        The basis, on the edit form too — yuvoy-operator#30 §1.

        An existing listing is where the unstated ones actually are: every
        listing written before this shipped has whatever the column
        defaulted to, and the create form only fixes the ones written from
        now on.

        **Preselected here, and only here.** On the create form neither is
        chosen, because an absent answer must stay absent. Here there IS a
        stored value and the field is a revision — showing it unselected
        would read as "we lost your setting", and submitting the form would
        then clear a basis the operator never touched.
      */}
      <fieldset className="mt-4">
        <legend className={fieldLabelClass()}>
          Is that per person, or for the whole group?
        </legend>
        <div className="mt-3 space-y-2">
          {PRICING_UNITS.map((unit) => (
            <label
              key={unit.value}
              className="border-paper-line rounded-control flex min-h-14 cursor-pointer items-start gap-3 border p-3"
            >
              <input
                type="radio"
                name="pricingUnit"
                value={unit.value}
                defaultChecked={shown.pricingUnit === unit.value}
                className="accent-forest mt-0.5 size-5 shrink-0"
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
        The material changes — yuvoy-operator#30 §5.

        The contract names exactly these as needing review: "price, safety
        notes, inclusions, requirements, duration or party size". All of
        them existed on the wire and none could be set anywhere in this
        portal, which is why every listing carries the server's defaults.

        Inclusions and requirements are one per line rather than
        comma-separated: an operator writing "Mask and fins" should not
        have to think about escaping, and a line is how they already think
        about a list.
      */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor={`duration-${listing.id}`}
            className={fieldLabelClass()}
          >
            How long
          </label>
          <input
            id={`duration-${listing.id}`}
            name="durationMinutes"
            inputMode="numeric"
            defaultValue={shown.durationMinutes}
            className={inputClass("mt-2")}
            aria-describedby={`duration-help-${listing.id}`}
          />
          <p
            id={`duration-help-${listing.id}`}
            className="text-forest/70 mt-1.5 text-xs"
          >
            In minutes.
          </p>
        </div>
        <div>
          <label htmlFor={`party-${listing.id}`} className={fieldLabelClass()}>
            Most people per booking
          </label>
          <input
            id={`party-${listing.id}`}
            name="maxPartySize"
            inputMode="numeric"
            defaultValue={shown.maxPartySize}
            className={inputClass("mt-2")}
          />
        </div>
      </div>

      <div className="mt-4">
        <label
          htmlFor={`inclusions-${listing.id}`}
          className={fieldLabelClass()}
        >
          What is included
        </label>
        <Textarea
          id={`inclusions-${listing.id}`}
          name="inclusions"
          rows={3}
          defaultValue={shown.inclusions}
          className={inputClass("voice-host mt-2 h-auto py-3")}
        />
        <p className="text-forest/70 mt-1.5 text-xs">
          One per line. Leave it empty if nothing is included.
        </p>
      </div>

      <div className="mt-4">
        <label
          htmlFor={`requirements-${listing.id}`}
          className={fieldLabelClass()}
        >
          What a traveller needs
        </label>
        <Textarea
          id={`requirements-${listing.id}`}
          name="requirements"
          rows={3}
          defaultValue={shown.requirements}
          className={inputClass("voice-host mt-2 h-auto py-3")}
        />
        <p className="text-forest/70 mt-1.5 text-xs">
          What to bring, and what they need to be able to do, one per line. This
          is the field a review comes back on most often.
        </p>
      </div>

      <div className="mt-4">
        <label htmlFor={`safety-${listing.id}`} className={fieldLabelClass()}>
          Safety notes
        </label>
        <Textarea
          id={`safety-${listing.id}`}
          name="safetyNotes"
          rows={3}
          defaultValue={shown.safetyNotes}
          className={inputClass("voice-host mt-2 h-auto py-3")}
        />
        {/*
          The one field where an operator can over-claim. Said here rather
          than discovered in a rejection: `unsafe_claim` is a real
          rejection code and this is the field it lands on.
        */}
        <p className="text-forest/70 mt-1.5 text-xs">
          What you actually do to keep people safe. We come back on anything
          that claims more than we can stand behind.
        </p>
      </div>

      {/*
        The sentence the contract asks clients to say out loud, because
        "the obvious assumption is the opposite". It goes here rather than
        in the confirmation: it changes whether somebody sends the change
        at all.

        Since D-032.3 it names the half that goes live at once. It said
        the whole change waited for us, which was wrong for a price.
      */}
      <p className="text-forest/80 leading-body mt-4 text-sm text-pretty">
        {selling
          ? "This does not take it off sale. Price, duration, group size and where to meet change at once, and we read the rest first. Anybody who already booked keeps what they booked on."
          : "This sends it to us. Nothing is on sale until we approve it."}
      </p>

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button
          type="submit"
          pending={pending}
          pendingLabel="Sending"
          variant="primary"
          block={false}
          className="flex-1"
        >
          Send it to us
        </Button>
        <Button
          onClick={onCancel}
          disabled={pending}
          variant="secondary"
          block={false}
          className="flex-1"
        >
          Not now
        </Button>
      </div>
    </form>
  );
}

/**
 * Every field's value as the form renders it, from what is on file.
 *
 * One record for both jobs: the inputs read their `defaultValue` from it and
 * `onlyChanged` compares against it, so a field nobody touched can never look
 * changed because it was formatted one way here and another way there.
 */
function formDefaults(listing: OperatorExperience): Record<string, string> {
  const number = (n: number | null | undefined) => (n == null ? "" : String(n));
  return {
    title: listing.title ?? "",
    summary: listing.summary ?? "",
    activityType: listing.activityType ?? "",
    description: listing.description ?? "",
    meetingPoint: listing.meetingPoint ?? "",
    unitPrice:
      listing.unitPricePaise != null
        ? String(Math.round(listing.unitPricePaise / 100))
        : "",
    pricingUnit: listing.pricingUnit ?? "",
    durationMinutes: number(listing.durationMinutes),
    maxPartySize: number(listing.maxPartySize),
    inclusions: (listing.inclusions ?? []).join("\n"),
    requirements: (listing.requirements ?? []).join("\n"),
    safetyNotes: listing.safetyNotes ?? "",
    // As `MeetingPin` writes them, so a pin nobody moved is not sent.
    meetingLat: number(listing.meetingLat),
    meetingLng: number(listing.meetingLng),
  };
}
