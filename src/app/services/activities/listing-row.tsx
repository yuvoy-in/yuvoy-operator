"use client";

import { useActionState, useState } from "react";
import { submitRevision, type RevisionState } from "./actions";
import {
  describeRejection,
  describeStatus,
  type OperatorExperience,
} from "@/lib/services/listings";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
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
}) {
  const [state, act, pending] = useActionState<RevisionState, FormData>(
    submitRevision,
    {},
  );
  const [editing, setEditing] = useState(false);

  const status = describeStatus(listing.status);
  const rejection = describeRejection(listing.review?.rejectionCode);

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
        No price means it cannot be approved, whatever else is right about it.
        Said on the row rather than only in the review that will refuse it.
      */}
      {listing.sellable === false ? (
        <p className="text-terra-deep mt-3 text-sm font-bold">
          No price yet, so we cannot approve it. Add one below.
        </p>
      ) : null}

      {/*
        Why we came back. A closed set in the contract "precisely so you can
        render them rather than paraphrase" — and a code this build has never
        met falls back to the API's own note rather than to a guess.
      */}
      {listing.review?.rejectionCode ? (
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
            ? "No departures scheduled. Add some on Capacity."
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

          <div>
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
              Price per person
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
    </li>
  );
}
