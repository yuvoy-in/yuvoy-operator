import type { Standing } from "@/lib/account/standing";
import type { HomeListing } from "./listings";

/**
 * Start selling: what a new operator has left before anybody can book them
 * (yuvoy-operator#96, "States Home must handle").
 *
 * "New operator, nothing live: a start-selling checklist (details, documents,
 * first listing, first departure, first reel) replaces blocks 3 to 5 until
 * the first sale."
 *
 * ## Who is new: nobody has ever bought
 *
 * "Until the first sale", read from the API rather than guessed: no booking
 * ever, in any state (`GET /bookings` counts), and nobody booked or sold at the
 * counter on the days Home read. It used to be "no listing ever published",
 * which ended the checklist the day a listing went live with nothing sold, and
 * never showed it to a business whose only listing was paused or not selling
 * before anybody bought. An operator paused for the season HAS sold, so they
 * are not new, and the booking count is what says so.
 *
 * When a read it needs failed (the listings, or the count), nobody is new:
 * the ordinary blocks draw instead, each saying what it could not load.
 *
 * ## When every step is done
 *
 * The ordinary blocks come back, sale or no sale. A checklist ticked from end
 * to end has nothing left to offer and would only hide the day; what happens
 * next is on travellers, and the selling line and "Needs you" carry it.
 *
 * ## What a step links to
 *
 * Only what this login may do. The business details and a listing or a
 * departure are OWNER, ADMIN or MANAGER; a document and a reel may be sent by
 * anybody on the account. A step a staff phone cannot take is still listed,
 * with its tick, because knowing what is left is useful to them too.
 */

export interface ChecklistStep {
  key: "details" | "documents" | "listing" | "departure" | "reel";
  label: string;
  done: boolean;
  /** Absent when this login cannot take the step. */
  href?: string;
}

/** Whether the business has not made its first sale. See the module comment. */
export function isNewOperator(input: {
  listings: readonly HomeListing[] | null;
  /** Somebody booked, or sold at the counter, on a day Home read. */
  peopleOnDaysRead: boolean;
  /** Bookings ever made, in any state; `null` when that read failed. */
  everBooked: number | null;
}): boolean {
  if (input.listings === null) return false;
  if (input.peopleOnDaysRead) return false;
  return input.everBooked === 0;
}

/** Whether the checklist still has a step to take. See the module comment. */
export function stepsLeft(steps: readonly ChecklistStep[]): boolean {
  return steps.some((step) => !step.done);
}

export function startSelling(input: {
  standing: Standing | null;
  listings: readonly HomeListing[];
  /** Media items on the account; `null` when that read failed. */
  reels: number | null;
  canManage: boolean;
}): ChecklistStep[] {
  const { standing, listings, canManage } = input;
  const blocking = standing?.blocking ?? [];

  const detailsDone =
    standing !== null &&
    !blocking.some((b) => b.code === "BUSINESS_DETAILS_INCOMPLETE");
  /*
    The operator's part is SENDING them. "A document that is not satisfied
    always has a CREDENTIAL_* entry in blocking saying why", and one sent and
    waiting on Yuvoy's check waits on Yuvoy, so it does not hold this step.
  */
  const documentsDone =
    standing !== null &&
    !blocking.some(
      (b) =>
        b.waitingOn === "operator" && (b.code ?? "").startsWith("CREDENTIAL_"),
    );

  return [
    {
      key: "details",
      label: "Tell us about your business",
      done: detailsDone,
      ...(canManage ? { href: "/profile" } : {}),
    },
    {
      key: "documents",
      label: "Send your documents",
      done: documentsDone,
      href: "/account/verification",
    },
    {
      key: "listing",
      label: "Write your first listing",
      done: listings.length > 0,
      ...(canManage ? { href: "/account/listings/new" } : {}),
    },
    {
      key: "departure",
      label: "Add your first departure",
      done: listings.some((l) => (l.upcomingDepartures ?? 0) > 0),
      // The calendar adds a departure to any listing, a draft included.
      ...(canManage ? { href: "/calendar" } : {}),
    },
    {
      key: "reel",
      label: "Add your first reel",
      done: (input.reels ?? 0) > 0,
      href: "/account?tab=reels",
    },
  ];
}
