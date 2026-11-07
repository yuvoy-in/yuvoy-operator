"use client";

import { SUPPORT_PHONE } from "@/lib/site/contact";
import { useActionState, useState } from "react";
import { submitRevision, type RevisionState } from "./actions";
import {
  fieldLabels,
  type RevisionOutcome,
} from "@/lib/services/revision-outcome";
import {
  describeRejection,
  describeBlockers,
  describeStatus,
  type OperatorExperience,
} from "@/lib/services/listings";
import type { Vocabulary } from "@/lib/services/vocabulary";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { PauseResume } from "./pause-resume";
import { SentBack } from "./sent-back";
import { panelClass } from "@/components/ui/panel";
import { sendForm } from "@/lib/actions/send-form";
import { ListingEditForm } from "./listing-edit-form";

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
  const [state, act, pending] = useActionState(
    sendForm<RevisionState>(submitRevision, () => ({
      message: "No signal. Nothing was sent. Try again.",
    })),
    {},
  );
  const [editing, setEditing] = useState(false);

  const status = describeStatus(listing.status);
  const rejection = describeRejection(listing.review?.rejectionCode);
  const blockers = describeBlockers(listing.publishBlockers);

  return (
    <li id={`listing-${listing.id}`} className={panelClass()}>
      <div className="flex items-start justify-between gap-3">
        {/* The listing's own name, in the host's voice (v3.2). */}
        <p className="voice-host text-lg text-balance">{listing.title}</p>
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

      <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
        {status.body}
      </p>

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
          <p className="text-terra-deep text-sm font-bold text-balance">
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
      {listing.sentBack ? <SentBack sentBack={listing.sentBack} /> : null}

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
          <p className="text-terra-deep text-sm font-bold text-balance">
            {rejection ??
              listing.review.rejectionNote ??
              `We came back to you on this one. Call us on ${SUPPORT_PHONE} and we will say why.`}
          </p>
          {rejection && listing.review.rejectionNote ? (
            <p className="text-forest/80 leading-body mt-1.5 text-sm text-pretty">
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
        <p className="border-paper-line text-forest/80 leading-body mt-3 border-t pt-3 text-sm text-pretty">
          On sale with nothing to show. Travellers see a blank card until a
          photograph or a reel is attached to it.{" "}
          <a href="/account?tab=reels" className="underline underline-offset-2">
            Your reels
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

      {state.outcome ? (
        <RevisionAnswer outcome={state.outcome} selling={status.selling} />
      ) : editing ? (
        <ListingEditForm
          listing={listing}
          vocabulary={vocabulary}
          selling={status.selling}
          state={state}
          act={act}
          pending={pending}
          onCancel={() => setEditing(false)}
        />
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

/**
 * What happened to the change, in both halves (D-032.3).
 *
 * The API's own sentence first, then the two lists it refers to, in its order:
 * what is live now, then what is with us. It deliberately does not say
 * "saved" about the second half. The fallback sentences are the ones this row
 * said before the API named the halves, for an answer that does not.
 */
function RevisionAnswer({
  outcome,
  selling,
}: {
  outcome: RevisionOutcome;
  selling: boolean;
}) {
  const live = fieldLabels(outcome.applied);
  const withUs = fieldLabels(outcome.inReview);
  const next =
    outcome.next ??
    (live.length > 0 && withUs.length === 0
      ? "These are live now."
      : selling
        ? "Your change is with us. It stays on sale on the old terms until we answer."
        : "It is with us now. We will come back to you.");

  return (
    <div
      role="status"
      className="border-paper-line text-forest/80 mt-4 border-t pt-3 text-sm"
    >
      <p className="font-bold">{next}</p>
      {live.length > 0 ? (
        <p className="mt-2">
          <span className="font-bold">Live now:</span> {live.join(", ")}
        </p>
      ) : null}
      {withUs.length > 0 ? (
        <p className="mt-1">
          <span className="font-bold">With us:</span> {withUs.join(", ")}
        </p>
      ) : null}
      {outcome.note ? (
        <p className="text-forest/70 mt-2 text-xs">{outcome.note}</p>
      ) : null}
    </div>
  );
}
