import {
  blockerAction,
  blockerText,
  byGatingFirst,
  gatesSale,
  splitByWaitingOn,
  type Blocker,
  type Standing,
} from "@/lib/account/standing";
import { SUPPORT_PHONE_HREF } from "@/lib/site/contact";
import { sentence } from "@/lib/format/sentence";
import { count } from "./words";
import { isLive, liveWithNoDates, type HomeListing } from "./listings";

/**
 * Whether the business is selling, in one line (yuvoy-operator#96 block 1).
 *
 * "Green 'Selling · 3 listings live'. Amber 'Selling, but 19 departures are
 * off sale'. Red 'Not selling: 2 documents needed'. Tap opens the reasons."
 *
 * The three colours are three TONES here, because the design system has no
 * traffic lights: forest for selling, the terracotta accent for something to
 * fix, and the accent's full weight for an account that cannot sell. The
 * words carry the state on their own ("Selling", "Selling, but", "Not
 * selling"), so nobody has to tell a colour apart in direct sun.
 *
 * ## What decides each one
 *
 * The ACCOUNT first, because nothing sells while it cannot: a suspension, or
 * `bookable: false` with the blockers that say why. Then the LISTINGS: what
 * is live, what is off sale, what has nothing to sell. `bookable` is
 * branched on and `state` never is (see `lib/account/standing.ts`), and an
 * account block the API did not send is unknown, never "selling".
 */
export type StatusTone = "selling" | "attention" | "blocked" | "unknown";

export interface StatusReason {
  text: string;
  /** Where it is put right, when there is somewhere this login may go. */
  href?: string;
  action?: string;
}

export interface SellingStatus {
  tone: StatusTone;
  line: string;
  /** Why, for the line to open onto. Empty when there is nothing to explain. */
  reasons: StatusReason[];
  /** Where the whole of it is, after the reasons: Verification, for an account. */
  more?: { href: string; action: string };
}

/** The screen that lists everything outstanding on the account, with the documents. */
const VERIFICATION = {
  href: "/account/verification",
  action: "See everything on Verification",
};

/** The documents codes, as the account's blockers name them. */
const DOCUMENT = new Set([
  "CREDENTIAL_MISSING",
  "CREDENTIAL_EXPIRED",
  "CREDENTIAL_REJECTED",
]);

/**
 * Whether this login may act on a blocker's way forward.
 *
 * The business details and the logo are OWNER, ADMIN or MANAGER in the API
 * (yuvoy-api#222); a document may be sent by anybody on the account. A staff
 * phone is not shown a button the server will refuse.
 */
export function mayActOn(blocker: Blocker, canManage: boolean): boolean {
  if (canManage) return true;
  return DOCUMENT.has(blocker.code ?? "");
}

/** One blocker, as a reason with its way forward when this login has one. */
export function blockerReason(
  blocker: Blocker,
  canManage: boolean,
): StatusReason {
  const way = blocker.waitingOn === "operator" ? blockerAction(blocker) : null;
  const reason: StatusReason = { text: blockerText(blocker) };
  if (way && mayActOn(blocker, canManage)) {
    reason.href = way.href;
    reason.action = way.label;
  }
  return reason;
}

export function sellingStatus(input: {
  standing: Standing | null;
  /**
   * Present exactly while the business is suspended, closed or disqualified
   * (yuvoy-operator#50), carrying the API's own sentence for it.
   */
  suspension: { message?: string } | null;
  /** `null` when `GET /experiences` did not answer. */
  listings: readonly HomeListing[] | null;
  canManage: boolean;
}): SellingStatus {
  const { standing, suspension, listings, canManage } = input;

  if (suspension) {
    /*
      "On hold" rather than "suspended": the same block is sent for a business
      that is closed or disqualified, and the API's own sentence (the banner's
      first line) says which. Only Yuvoy lifts it, so the way forward is a
      call, which is also what that sentence asks for.
    */
    return {
      tone: "blocked",
      line: "Not selling: your account is on hold",
      reasons: [
        {
          text:
            sentence(suspension.message ?? "") ||
            "Yuvoy has put your account on hold.",
          href: SUPPORT_PHONE_HREF,
          action: "Call Yuvoy",
        },
      ],
    };
  }

  if (!standing) {
    return {
      tone: "unknown",
      line: "We cannot tell whether you are selling",
      reasons: [
        {
          text: "Yuvoy did not say where your account stands",
          href: "/account/verification",
          action: "Open Verification",
        },
      ],
    };
  }

  if (!standing.bookable) {
    const blocking = byGatingFirst(standing.blocking);
    const { operator } = splitByWaitingOn(blocking);
    // What stops a sale, or will not say that it does not.
    const needed = operator.filter((b) => gatesSale(b) !== false);
    const reasons = blocking.map((b) => blockerReason(b, canManage));
    if (needed.length > 0) {
      const documents = needed.every((b) => DOCUMENT.has(b.code ?? ""));
      return {
        tone: "blocked",
        line: documents
          ? `Not selling: ${count(needed.length, "document", "documents")} needed`
          : `Not selling: ${count(needed.length, "thing needs", "things need")} you`,
        reasons,
        more: VERIFICATION,
      };
    }
    return {
      tone: "blocked",
      line: "Not selling yet: Yuvoy is checking your account",
      reasons:
        reasons.length > 0
          ? reasons
          : [{ text: "Nothing is waiting on you. It is with us." }],
      more: VERIFICATION,
    };
  }

  if (!listings) {
    // The account can sell; which listings do, this read cannot say.
    return { tone: "selling", line: "Your account is live", reasons: [] };
  }

  const live = listings.filter(isLive);
  const offSale = sum(listings, "departuresNotOnSale");
  const goingOff = sum(listings, "departuresGoingOffSaleSoon");
  const noDates = listings.filter(liveWithNoDates);
  const notSelling = listings.filter((l) => l.status === "not_selling");

  const reasons: StatusReason[] = [];
  if (offSale > 0) {
    reasons.push({
      text: `${count(offSale, "departure is", "departures are")} off sale: seats not confirmed`,
    });
  }
  if (goingOff > 0) {
    reasons.push({
      text:
        goingOff === 1
          ? "1 departure goes off sale within a day unless its seats are confirmed"
          : `${goingOff} departures go off sale within a day unless their seats are confirmed`,
    });
  }
  for (const listing of noDates) {
    reasons.push({
      text: `${listing.title} has no dates in the next 30 days`,
      ...(canManage
        ? { href: `/today/listing/${listing.id}`, action: "Add departures" }
        : {}),
    });
  }
  for (const listing of notSelling) {
    reasons.push({
      text: `${listing.title} is published but not selling`,
      href: `/account/listings/${listing.id}`,
      action: "See why",
    });
  }

  if (live.length === 0) {
    return {
      tone: "attention",
      line:
        listings.length === 0
          ? "Not selling yet: no listings"
          : "Not selling: no listing is live",
      reasons,
    };
  }

  const liveLine = count(live.length, "listing live", "listings live");
  if (reasons.length === 0) {
    return { tone: "selling", line: `Selling · ${liveLine}`, reasons };
  }

  let but: string;
  if (offSale > 0) {
    but = `${count(offSale, "departure is", "departures are")} off sale`;
  } else if (noDates.length === 1) {
    but = `${noDates[0].title} has no dates to sell`;
  } else if (noDates.length > 1) {
    but = `${noDates.length} live listings have no dates to sell`;
  } else if (notSelling.length > 0) {
    but = `${count(notSelling.length, "listing is", "listings are")} not selling`;
  } else {
    but = `${count(goingOff, "departure goes", "departures go")} off sale within a day`;
  }
  return { tone: "attention", line: `Selling, but ${but}`, reasons };
}

function sum(
  listings: readonly HomeListing[],
  field: "departuresNotOnSale" | "departuresGoingOffSaleSoon",
): number {
  return listings.reduce((n, l) => n + (l[field] ?? 0), 0);
}
