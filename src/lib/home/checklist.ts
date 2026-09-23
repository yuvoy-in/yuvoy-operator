import type { Standing } from "@/lib/account/standing";
import { neverPublished, type HomeListing } from "./listings";

/**
 * Start selling: what a new operator has left before anybody can book them
 * (yuvoy-operator#96, "States Home must handle").
 *
 * "New operator, nothing live: a start-selling checklist (details, documents,
 * first listing, first departure, first reel) replaces blocks 3 to 5 until
 * the first sale."
 *
 * ## Who is new
 *
 * A business none of whose listings has ever been on sale, with nobody booked
 * on the days Home read. Nothing published means nothing could have sold, so
 * this is "until the first sale" read from facts Home already has, with no
 * read of its own. An operator whose listings are all paused for the season
 * is NOT new: every one of them was published, and a checklist telling them
 * how to start would be wrong about their business.
 *
 * When the listings could not be read, nobody is new: the ordinary blocks
 * draw instead, each saying what it could not load.
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

/** Whether Home shows the checklist in place of the day, the money and the listings. */
export function isNewOperator(
  listings: readonly HomeListing[] | null,
  bookedOnDaysRead: boolean,
): boolean {
  if (listings === null) return false;
  if (bookedOnDaysRead) return false;
  return listings.every(neverPublished);
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
