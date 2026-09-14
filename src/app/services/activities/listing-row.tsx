"use client";

import { useActionState, useState } from "react";
import { submitRevision, type RevisionState } from "./actions";
import {
  describeRejection,
  describeBlockers,
  describeStatus,
  PRICING_UNITS,
  type OperatorExperience,
} from "@/lib/services/listings";
import { activityChoices, type Vocabulary } from "@/lib/services/vocabulary";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { PauseResume } from "./pause-resume";
import { inputClass } from "@/components/ui/input";
import { panelClass } from "@/components/ui/panel";

/**
 * One listing, and the one act available on it.
 *
 * ## `status` is rendered, never recombined
 *
 * The contract derives it from the publication state and the latest revision
 * together, "because neither answers 'where is this' alone". A row that
 * rebuilt the answer would disagree with the admin console about the same
 * listing — and the operator is the one who would find out.
 *
 * ## No success toast, anywhere
 *
 * "An operator who submits and sees 'Saved' will assume they are selling, and
 * will ring us on the day nobody books." Every state on this row says who has
 * it: them, us, or travellers.
 */
export function ListingRow({
  listing,
  hasFootage,
  vocabulary,
  suspended,
}: {
  listing: OperatorExperience;
  /**
   * Whether any clip is attached to this listing.
   *
   * Half of the cross-link the two screens exist for. A listing on sale with
   * nothing behind it renders as a black card in the traveller app — which is
   * exactly what `yuvoy.in` showed for months — so the row says so and points
   * at the other half of this section.
   */
  hasFootage: boolean;
  /**
   * The catalogue, so the activity picker can offer this listing's own
   * category — yuvoy-operator#39. `null` when the read failed, and the picker
   * is then hidden rather than shown empty.
   */
  vocabulary: Vocabulary | null;
  /**
   * Whether the business is suspended, closed or disqualified
   * (yuvoy-operator#50).
   *
   * Pause and resume are not on the list of writes a suspended business may
   * still make, so the control is not drawn. A suspended listing is already
   * off sale for a reason nobody here can lift, and a Pause that answers the
   * suspension sentence teaches an operator the portal does not know its own
   * state.
   */
  suspended?: boolean;
}) {
  const [state, act, pending] = useActionState<RevisionState, FormData>(
    submitRevision,
    {},
  );
  const [editing, setEditing] = useState(false);

  /*
    Narrowed to the listing's OWN category, which is fixed after creation —
    `category` is on neither form once a listing exists, and that is right:
    changing what something fundamentally is deserves more than an inline
    edit. So unlike the create form's picker this one needs no category state.
  */
  const activities = activityChoices(vocabulary, listing.category ?? null);

  const status = describeStatus(listing.status);
  const rejection = describeRejection(listing.review?.rejectionCode);
  const blockers = describeBlockers(listing.publishBlockers);

  return (
    <li id={`listing-${listing.id}`} className={panelClass()}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-lg font-bold">{listing.title}</p>
        <Chip
          tone={
            // `accent` is the tone for something the operator has to answer.
            // A published listing that has stopped earning qualifies as much
            // as a rejected revision does — and `needsAnswer` says so without
            // this component knowing either status by name.
            status.needsAnswer
              ? "accent"
              : status.selling
                ? "selected"
                : "neutral"
          }
        >
          {status.label}
        </Chip>
      </div>

      <p className="text-forest/80 mt-2 text-sm">{status.body}</p>

      {/*
        The door out of `not_selling` — yuvoy-operator#28.

        The four causes (the operator is not selling, a kill switch, no price,
        a lapsed credential) are deliberately NOT on this object: they belong
        to the account, and `GET /me` already returns the blockers that name
        them, which the Business screen already renders. So the row says the
        state and points at the one screen that can say why — it does not
        guess which of the four it is.

        Per row rather than as a banner, because credential requirements
        resolve per activity category: one listing can be not selling because
        an instructor certificate lapsed while another stays live.
      */}
      {status.accountGap ? (
        <a
          href="/account"
          className="text-forest mt-2 inline-block text-sm underline underline-offset-2"
        >
          See what is outstanding
        </a>
      ) : null}

      {/*
        Exactly what is still missing — yuvoy-operator#30 §3.

        This used to say only "No price yet", derived from `sellable`, which
        was true and incomplete: a listing can also be blocked on its summary,
        its meeting point, its activity type, or a pricing basis nobody stated.
        `publishBlockers` names all of them, so the row says which rather than
        letting an operator send it for review and find out.

        Falls back to `sellable` when the array is absent, so a response from
        an older deployment still says the one thing it can.
      */}
      {blockers.length > 0 ? (
        <div className="mt-3">
          <p className="text-terra-deep text-sm font-bold">
            {blockers.length === 1
              ? "One thing is missing before we can approve it:"
              : `${blockers.length} things are missing before we can approve it:`}
          </p>
          <ul className="text-forest/80 mt-1.5 list-disc space-y-0.5 pl-5 text-sm">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : listing.sellable === false ? (
        <p className="text-terra-deep mt-3 text-sm font-bold">
          No price yet, so we cannot approve it. Add one below.
        </p>
      ) : null}

      {/*
        A FIRST listing sent back — yuvoy-operator#44, yuvoy-api#180.

        `sentBack` is "present while a reviewer has sent this listing back to
        you before it was ever on sale, and absent otherwise". Before it
        existed, such a listing simply sat in review and the operator had no
        way to learn why: `review.rejectionCode` below covers a rejected EDIT
        to something already live, which is a different thing.

        Said louder than that one, because the two are not equally urgent. A
        rejected edit leaves a listing selling; this one has never sold and
        will not until it comes back — and it is a draft again, which is the
        part an operator cannot guess.

        The reason uses the same closed set and the same fallback: a code this
        build has never met falls back to the reviewer's own note rather than
        to a guess.
      */}
      {listing.sentBack ? (
        <div className="border-terra-deep/30 mt-3 border-t pt-3">
          <p className="text-terra-deep text-sm font-bold">
            We sent this back to you.{" "}
            {describeRejection(listing.sentBack.rejectionCode) ??
              listing.sentBack.rejectionNote ??
              "Message us and we will say why."}
          </p>
          {/*
            The reviewer's own words, when there are any. Empty when they wrote
            nothing, which the contract states, so this is not a missing-field
            branch.
          */}
          {describeRejection(listing.sentBack.rejectionCode) &&
          listing.sentBack.rejectionNote?.trim() ? (
            <p className="text-forest/80 mt-1.5 text-sm">
              {listing.sentBack.rejectionNote}
            </p>
          ) : null}
          <p className="text-forest/70 mt-1.5 text-sm">
            It is a draft again. Change it below and send it to us when you are
            ready.
          </p>
        </div>
      ) : null}

      {/*
        Why we came back on an EDIT. A closed set in the contract "precisely so
        you can render them rather than paraphrase" — and a code this build has
        never met falls back to the API's own note rather than to a guess.

        Not shown beside `sentBack` above: a listing sent back before it ever
        sold is one situation, and two panels about the same rejection would
        read as two rejections.
      */}
      {!listing.sentBack && listing.review?.rejectionCode ? (
        <div className="border-terra-deep/30 mt-3 border-t pt-3">
          <p className="text-terra-deep text-sm font-bold">
            {rejection ??
              listing.review.rejectionNote ??
              "We came back to you on this one. Message us and we will say why."}
          </p>
          {rejection && listing.review.rejectionNote ? (
            <p className="text-forest/80 mt-1.5 text-sm">
              {listing.review.rejectionNote}
            </p>
          ) : null}
        </div>
      ) : null}

      {/*
        The cross-link, asked from the listing's end. Only on something that is
        actually selling: a draft with no footage is not a problem yet, and
        saying so on every row would train an operator to stop reading them.
      */}
      {status.selling && !hasFootage ? (
        <p className="border-cream-line text-forest/80 mt-3 border-t pt-3 text-sm">
          On sale with nothing to show. Travellers see a blank card until a
          photograph or a reel is attached to it.{" "}
          <a href="/services/reels" className="underline underline-offset-2">
            Photos &amp; reels
          </a>
        </p>
      ) : null}

      {listing.upcomingDepartures !== undefined ? (
        <p className="text-forest/70 mt-3 text-xs">
          {listing.upcomingDepartures === 0
            ? "No departures scheduled. Add some on Calendar."
            : `${listing.upcomingDepartures} departure${
                listing.upcomingDepartures === 1 ? "" : "s"
              } coming up`}
        </p>
      ) : null}

      {state.submitted ? (
        /*
          The row's own confirmation, and it deliberately does not say "saved".
          The list has revalidated behind this, so the chip above already reads
          differently — this line is about what happens NEXT, which the chip
          cannot say.
        */
        <p
          role="status"
          className="border-cream-line text-forest/80 mt-4 border-t pt-3 text-sm font-bold"
        >
          {status.selling
            ? "Your change is with us. It stays on sale on the old terms until we answer."
            : "It is with us now. We will come back to you."}
        </p>
      ) : editing ? (
        <form action={act} className="border-cream-line mt-4 border-t pt-4">
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
            <label
              htmlFor={`title-${listing.id}`}
              className="label text-forest/75"
            >
              What it is called
            </label>
            <input
              id={`title-${listing.id}`}
              name="title"
              required
              minLength={3}
              defaultValue={listing.title ?? ""}
              className={inputClass("mt-2")}
            />
          </div>

          <div className="mt-4">
            <label
              htmlFor={`summary-${listing.id}`}
              className="label text-forest/75"
            >
              The short line
            </label>
            <input
              id={`summary-${listing.id}`}
              name="summary"
              defaultValue={listing.summary ?? ""}
              className={inputClass("mt-2")}
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
                className="label text-forest/75"
              >
                What kind of activity
              </label>
              <select
                id={`activity-${listing.id}`}
                name="activityType"
                defaultValue={listing.activityType ?? ""}
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
              className="label text-forest/75"
            >
              What actually happens
            </label>
            <textarea
              id={`description-${listing.id}`}
              name="description"
              rows={4}
              defaultValue={listing.description ?? ""}
              className={inputClass("mt-2")}
            />
          </div>

          <div className="mt-4">
            <label
              htmlFor={`meeting-${listing.id}`}
              className="label text-forest/75"
            >
              Where to meet
            </label>
            <input
              id={`meeting-${listing.id}`}
              name="meetingPoint"
              defaultValue={listing.meetingPoint ?? ""}
              className={inputClass("mt-2")}
            />
          </div>

          <div className="mt-4">
            <label
              htmlFor={`price-${listing.id}`}
              className="label text-forest/75"
            >
              Price
            </label>
            <input
              id={`price-${listing.id}`}
              name="unitPrice"
              inputMode="numeric"
              defaultValue={
                listing.unitPricePaise != null
                  ? String(Math.round(listing.unitPricePaise / 100))
                  : ""
              }
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
            <legend className="label text-forest/75">
              Is that per person, or for the whole group?
            </legend>
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
                    defaultChecked={listing.pricingUnit === unit.value}
                    className="accent-forest mt-0.5 size-5 shrink-0"
                  />
                  <span>
                    <span className="block text-sm font-bold">
                      {unit.label}
                    </span>
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
                className="label text-forest/75"
              >
                How long, in minutes
              </label>
              <input
                id={`duration-${listing.id}`}
                name="durationMinutes"
                inputMode="numeric"
                defaultValue={listing.durationMinutes ?? ""}
                className={inputClass("mt-2")}
              />
            </div>
            <div>
              <label
                htmlFor={`party-${listing.id}`}
                className="label text-forest/75"
              >
                Most people per booking
              </label>
              <input
                id={`party-${listing.id}`}
                name="maxPartySize"
                inputMode="numeric"
                defaultValue={listing.maxPartySize ?? ""}
                className={inputClass("mt-2")}
              />
            </div>
          </div>

          <div className="mt-4">
            <label
              htmlFor={`inclusions-${listing.id}`}
              className="label text-forest/75"
            >
              What is included
            </label>
            <textarea
              id={`inclusions-${listing.id}`}
              name="inclusions"
              rows={3}
              defaultValue={(listing.inclusions ?? []).join("\n")}
              className={inputClass("mt-2")}
            />
            <p className="text-forest/70 mt-1.5 text-xs">
              One per line. Leave it empty if nothing is included.
            </p>
          </div>

          <div className="mt-4">
            <label
              htmlFor={`requirements-${listing.id}`}
              className="label text-forest/75"
            >
              What a traveller needs to bring or be able to do
            </label>
            <textarea
              id={`requirements-${listing.id}`}
              name="requirements"
              rows={3}
              defaultValue={(listing.requirements ?? []).join("\n")}
              className={inputClass("mt-2")}
            />
            <p className="text-forest/70 mt-1.5 text-xs">
              One per line. This is the field a review comes back on most often.
            </p>
          </div>

          <div className="mt-4">
            <label
              htmlFor={`safety-${listing.id}`}
              className="label text-forest/75"
            >
              Safety notes
            </label>
            <textarea
              id={`safety-${listing.id}`}
              name="safetyNotes"
              rows={3}
              defaultValue={listing.safetyNotes ?? ""}
              className={inputClass("mt-2")}
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
          */}
          <p className="text-forest/80 mt-4 text-sm">
            {status.selling
              ? "This does not take it off sale. It keeps selling on the old terms while we read the change, and anybody who already booked keeps what they booked on."
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
              disabled={pending}
              variant="primary"
              block={false}
              className="flex-1"
            >
              {pending ? "Sending…" : "Send it to us"}
            </Button>
            <Button
              onClick={() => setEditing(false)}
              disabled={pending}
              variant="secondary"
              block={false}
              className="flex-1"
            >
              Not now
            </Button>
          </div>
        </form>
      ) : status.canSubmit ? (
        <Button
          onClick={() => setEditing(true)}
          variant="secondary"
          className="mt-4"
        >
          {listing.status === "draft"
            ? "Finish and send it"
            : "Propose a change"}
        </Button>
      ) : null}

      {/*
        Pausing and resuming — yuvoy-operator#30 §6, #44.

        Pause on a PUBLISHED listing: live, live with an edit in review, and
        not selling — published and earning nothing, and still somebody's boat
        to take out of the water. Resume on a paused one. A draft, and anything
        awaiting its first approval, gets neither: "In review has been
        submitted and has no pause/resume button."

        Keyed on `publicationState` rather than `status`, because pausing is a
        publication act and `status` folds in the latest revision.

        Below the edit control rather than beside it: pausing stops new
        bookings, and it should not sit a thumb's width from "Propose a
        change".
      */}
      {listing.id && !suspended ? (
        <PauseResume
          experienceId={listing.id}
          title={listing.title ?? "this listing"}
          publicationState={listing.publicationState}
        />
      ) : null}
    </li>
  );
}
