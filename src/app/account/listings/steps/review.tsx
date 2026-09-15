import Link from "next/link";
import {
  STEPS,
  STEP_LABEL,
  unfinishedSteps,
  type Step,
} from "@/lib/services/builder";
import { describeBlockers } from "@/lib/services/listings";
import { credentialTypeLabel } from "@/lib/profile/credentials";
import { Panel, panelClass } from "@/components/ui/panel";
import { SubmitButton } from "../[id]/submit-button";

/**
 * Step 7 — the whole listing read back, then sent.
 *
 * ## The documents are named, and never block
 *
 * `GET /credential-requirements` answers what a listing in this category needs
 * the business to hold, "so it can name a missing document before the listing
 * is sent rather than after it is approved and not selling". It is not a gate:
 * a document being missing is between the business and Yuvoy, not between the
 * operator and their own draft.
 *
 * ## Why Send can be disabled while submit would succeed
 *
 * `activityType` and `pricingUnit` are the two fields the submit gate does not
 * demand and approval does. Sending without them buys a rejection some days
 * later about a control the operator has right here, so the button waits.
 */
export function ReviewStep({
  id,
  listing,
  questionCount,
  mediaCount,
  departureCount,
  documents,
}: {
  id: string;
  listing: {
    title?: string;
    activityType?: string;
    pricingUnit?: string;
    publishBlockers?: string[];
  };
  questionCount: number;
  mediaCount: number;
  departureCount: number;
  /** `null` when the read failed: named as unknown rather than as "none". */
  documents: { type: string; satisfied: boolean }[] | null;
}) {
  const blockers = listing.publishBlockers ?? [];
  const unfinished = unfinishedSteps(blockers);
  const ready = Boolean(listing.activityType) && Boolean(listing.pricingUnit);

  const summary: Record<Step, string> = {
    basics: listing.title ?? "Not written yet",
    selling: listing.pricingUnit ? "Priced" : "No basis for the price yet",
    schedule:
      departureCount > 0
        ? `${departureCount} departure${departureCount === 1 ? "" : "s"} ahead`
        : "No departures yet",
    location: unfinished.has("location") ? "Missing something" : "Done",
    questions:
      questionCount > 0
        ? `${questionCount} question${questionCount === 1 ? "" : "s"}`
        : "None, which is fine",
    media:
      mediaCount > 0
        ? `${mediaCount} on it`
        : "Nothing on it yet. A listing with no picture shows as a blank card.",
    review: "",
  };

  return (
    <div className="mt-6 space-y-4">
      <ul className="space-y-3">
        {STEPS.filter((step) => step !== "review").map((step) => (
          <li key={step} className={panelClass()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-bold">{STEP_LABEL[step]}</p>
                <p className="text-forest/70 mt-1 text-sm">{summary[step]}</p>
                {unfinished.has(step) ? (
                  <p className="text-terra-deep mt-1 text-sm font-bold">
                    Still missing something
                  </p>
                ) : null}
              </div>
              <Link
                href={`/account/listings/${id}/edit?step=${step}`}
                className="text-forest tap-target shrink-0 text-sm underline underline-offset-4"
              >
                Edit
              </Link>
            </div>
          </li>
        ))}
      </ul>

      {blockers.length > 0 ? (
        <Panel tone="alert" className="p-4">
          <p className="text-sm font-bold">
            Still missing: {describeBlockers(blockers).join(", ")}
          </p>
        </Panel>
      ) : null}

      <section aria-labelledby="review-documents">
        <h3 id="review-documents" className="label text-forest/75">
          Documents a listing like this needs
        </h3>
        {documents === null ? (
          <p className="text-forest/70 mt-2 text-sm">
            We could not read which documents this needs. It does not stop you
            sending it.
          </p>
        ) : documents.length === 0 ? (
          <p className="text-forest/70 mt-2 text-sm">
            None, in your market, for this kind of listing.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {documents.map((doc) => (
              <li key={doc.type} className="flex justify-between gap-3 text-sm">
                <span>{credentialTypeLabel(doc.type)}</span>
                <span
                  className={
                    doc.satisfied
                      ? "text-forest/70"
                      : "text-terra-deep font-bold"
                  }
                >
                  {doc.satisfied ? "In place" : "Needed"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ready ? (
        <SubmitButton experienceId={id} label="Send for review" />
      ) : (
        <Panel tone="alert" className="p-4">
          <p className="text-sm font-bold">
            {listing.activityType
              ? "Say whether the price is per person or for the group first."
              : "Say what kind of activity this is first."}
          </p>
          <p className="text-forest/80 mt-1.5 text-sm">
            We would take it without, and approval would not. Sending it now
            buys a refusal in a few days about something you can answer here.
          </p>
        </Panel>
      )}
    </div>
  );
}
