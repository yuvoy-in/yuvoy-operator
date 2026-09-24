import {
  blockerAction,
  blockerText,
  byGatingFirst,
  gatesSale,
  type Blocker,
  type Standing,
} from "@/lib/account/standing";
import { marketDayOf } from "@/lib/day/calendar";
import type { OpenRequest } from "@/lib/day/request-types";
import { canGrant, urgencyOf } from "@/lib/day/request-types";
import { marketTime } from "@/lib/format/market-time";
import { formatPaise } from "@/lib/format/money";
import { SUPPORT_PHONE_HREF } from "@/lib/site/contact";
import type { InboxCount } from "@/lib/site/inbox-count";
import { liveWithNoDates, type HomeListing } from "./listings";
import { mayActOn } from "./status";
import { answerWithin, count, dayWords } from "./words";

/**
 * "Needs you": one list, sorted by deadline, one action per row
 * (yuvoy-operator#96 block 2, #82 s2).
 *
 * #82: "Messages are not the most urgent thing an operator has; a request
 * expiring in an hour is ... One strip, ranked: requests waiting first, then
 * messages, then anything else, and each labelled with the time pressure."
 * When nothing is waiting, the list draws nothing at all.
 *
 * ## The order
 *
 *   1. What stops the business selling, when it cannot: the one thing that
 *      unblocks it leads (#96 "States").
 *   2. Seat requests, soonest to expire first, each with its clock. At most
 *      three here; the rest are one row that opens Bookings.
 *   3. Anything else with a clock, by that clock: departures going off sale,
 *      and cash to take on today's departures by the time each leaves.
 *   4. Guests who wrote.
 *   5. Chores with no clock: live listings with nothing to sell, past cash
 *      trips nobody recorded, and what is still owed on the account.
 *
 * Every row is plain data, worked out here on the server, so the client list
 * that holds an accept's receipt formats nothing (and so cannot disagree with
 * the server about a day or a clock).
 */

export type NeedTone = "alert" | "plain";

export interface RequestNeed {
  kind: "request";
  key: string;
  id: string;
  /** The listing. */
  title: string;
  /** "3 people · Sat 09:00 · answer within 1h 20m". */
  detail: string;
  /** Under an hour to answer. */
  urgent: boolean;
  contactName: string;
  guests: number;
  /** The departure's zone, for a pay-by time the API does not write. */
  timezone: string;
  /** Set when the party is bigger than the departure has room for. */
  short?: string;
}

export interface ConfirmSeatsNeed {
  kind: "confirm-seats";
  key: "confirm-seats";
  text: string;
  detail?: string;
}

export interface LinkNeed {
  kind: "link";
  key: string;
  text: string;
  detail?: string;
  /** The one action, as the words on the row. */
  action: string;
  href: string;
  tone: NeedTone;
}

export type Need = RequestNeed | ConfirmSeatsNeed | LinkNeed;

/** How many requests Home draws before handing the rest to Bookings. */
export const REQUEST_ROWS = 3;

const REQUESTS_HREF = "/bookings?view=requests";

/** Today's cash, per departure, from the manifests Home reads. */
export interface TodayCash {
  slotId: string;
  startsAt: string;
  timezone: string;
  title: string;
  parties: number;
  collectPaise: number | null;
}

/** One request, as its row on Home says it. */
export function requestNeed(request: OpenRequest, today: string): RequestNeed {
  const timezone = request.timezone ?? "Asia/Kolkata";
  const guests = request.guests ?? 0;
  const parts = [count(guests, "person", "people")];
  const day = request.startsAt ? marketDayOf(request.startsAt, timezone) : null;
  if (day && request.startsAt) {
    parts.push(
      `${dayWords(day, today)} ${marketTime(request.startsAt, timezone)}`,
    );
  }
  parts.push(answerWithin(request.minutesToAnswer));

  const need: RequestNeed = {
    kind: "request",
    key: `request-${request.id ?? ""}`,
    id: request.id ?? "",
    title: request.experience?.trim() || "A departure",
    detail: parts.join(" · "),
    urgent: urgencyOf(request.minutesToAnswer) === "critical",
    contactName: request.contactName?.trim() || "The traveller",
    guests,
    timezone,
  };
  /*
    Accepting past the ceiling answers 409, so the row says it before the tap
    rather than after it: "accept with no sense of what is left is a decision
    made blind".

    Decided by `canGrant`, the helper the Bookings queue disables its own
    Accept with, rather than by a second copy of the comparison here. The two
    screens answer the same request, and a row Home offers while Bookings
    refuses it is a 409 an operator meets on whichever one they opened.
  */
  if (!canGrant(request)) {
    const grantable = request.seatsGrantable ?? 0;
    need.short = `Only ${count(grantable, "seat", "seats")} left, not enough for this party`;
  }
  return need;
}

/** A blocker as a row, or `null` when this login has nothing it can do about it. */
function blockerNeed(
  blocker: Blocker,
  canManage: boolean,
  tone: NeedTone,
  index: number,
): LinkNeed | null {
  if (blocker.waitingOn !== "operator") return null;
  if (!mayActOn(blocker, canManage)) return null;
  const way = blockerAction(blocker) ?? {
    href: "/account/verification",
    label: "See what is outstanding",
  };
  return {
    kind: "link",
    key: `account-${blocker.code ?? "item"}-${index}`,
    text: blockerText(blocker),
    action: way.label,
    href: way.href,
    tone,
  };
}

export function needsYou(input: {
  standing: Standing | null;
  suspended: boolean;
  canManage: boolean;
  /** `null` when `GET /requests` did not answer. */
  requests: readonly OpenRequest[] | null;
  /** `null` when `GET /experiences` did not answer. */
  listings: readonly HomeListing[] | null;
  /** Today's departures with cash still to take. */
  cash: readonly TodayCash[];
  /** Past cash trips with nothing recorded; `null` when unknown or not asked. */
  unrecorded: number | null;
  inbox: InboxCount | null;
  /** The market's today, `YYYY-MM-DD`. */
  today: string;
  now: number;
}): Need[] {
  const { standing, suspended, canManage } = input;

  /* 1. what stops the business selling ---------------------------------- */
  const lead: Need[] = [];
  const later: LinkNeed[] = [];
  if (suspended) {
    lead.push({
      kind: "link",
      key: "suspended",
      text: "Your account is on hold",
      action: "Call Yuvoy",
      href: SUPPORT_PHONE_HREF,
      tone: "alert",
    });
  }
  if (standing) {
    byGatingFirst(standing.blocking).forEach((blocker, index) => {
      // Once the account can sell, nothing on it is stopping a sale.
      const stopping = !standing.bookable && gatesSale(blocker) !== false;
      const row = blockerNeed(
        blocker,
        canManage,
        stopping ? "alert" : "plain",
        index,
      );
      if (!row) return;
      (stopping ? lead : later).push(row);
    });
  }

  /* 2. seat requests ------------------------------------------------------ */
  const requests: Need[] = [];
  if (input.requests === null) {
    requests.push({
      kind: "link",
      key: "requests-failed",
      text: "Requests did not load",
      action: "Open Bookings",
      href: REQUESTS_HREF,
      tone: "alert",
    });
  } else if (input.requests.length > 0 && !canManage) {
    /*
      A staff phone sees the queue and cannot answer it: "a request nobody sees
      is a request that expires", and a button the server refuses is worse
      than none. One row, with the soonest clock, opening the queue.
    */
    const first = input.requests[0];
    requests.push({
      kind: "link",
      key: "requests-staff",
      text: `${count(input.requests.length, "request is", "requests are")} waiting on an answer`,
      detail: `Soonest: ${answerWithin(first.minutesToAnswer)}`,
      action: "Open Bookings",
      href: REQUESTS_HREF,
      tone: input.requests.some(
        (r) => urgencyOf(r.minutesToAnswer) === "critical",
      )
        ? "alert"
        : "plain",
    });
  } else {
    for (const request of input.requests.slice(0, REQUEST_ROWS)) {
      requests.push(requestNeed(request, input.today));
    }
    const rest = input.requests.length - REQUEST_ROWS;
    if (rest > 0) {
      requests.push({
        kind: "link",
        key: "requests-more",
        text: `${count(rest, "more request", "more requests")} waiting`,
        action: "Open Bookings",
        href: REQUESTS_HREF,
        tone: "plain",
      });
    }
  }

  /* 3. anything else with a clock ----------------------------------------- */
  const timed: { at: number; need: Need }[] = [];
  const listings = input.listings ?? [];
  const offSale = listings.reduce(
    (n, l) => n + (l.departuresNotOnSale ?? 0),
    0,
  );
  const goingOff = listings.reduce(
    (n, l) => n + (l.departuresGoingOffSaleSoon ?? 0),
    0,
  );
  // Confirming is OWNER, ADMIN or MANAGER, and refused while on hold.
  if (canManage && !suspended && offSale + goingOff > 0) {
    timed.push({
      // Off sale already costs sales now; going off sale costs them within a day.
      at: offSale > 0 ? input.now : input.now + 24 * 60 * 60 * 1000,
      need: {
        kind: "confirm-seats",
        key: "confirm-seats",
        text:
          offSale > 0
            ? `${count(offSale, "departure is", "departures are")} off sale: seats not confirmed`
            : `${count(goingOff, "departure goes", "departures go")} off sale within a day`,
        ...(offSale > 0 && goingOff > 0
          ? {
              detail: `${goingOff} more ${goingOff === 1 ? "goes" : "go"} off sale within a day`,
            }
          : offSale === 0
            ? { detail: "Unless the seats are confirmed" }
            : {}),
      },
    });
  }
  for (const cash of input.cash) {
    if (cash.parties <= 0) continue;
    const at = Date.parse(cash.startsAt);
    const parties = count(cash.parties, "party", "parties");
    const time = marketTime(cash.startsAt, cash.timezone);
    timed.push({
      at: Number.isNaN(at) ? input.now : at,
      need: {
        kind: "link",
        key: `cash-${cash.slotId}`,
        text:
          cash.collectPaise === null
            ? `Collect cash from ${parties} on the ${time}`
            : `Collect ${formatPaise(cash.collectPaise)} from ${parties} on the ${time}`,
        detail: cash.title,
        action: "Open the departure",
        href: `/today/${cash.slotId}`,
        tone: "plain",
      },
    });
  }
  timed.sort((a, b) => a.at - b.at);

  /* 4. guests who wrote ---------------------------------------------------- */
  const messages: Need[] = [];
  if (input.inbox === null) {
    /*
      Said, because drawing nothing is what an empty inbox draws too, and
      with nothing else waiting "Needs you" went away: "nothing waiting",
      measured by nobody.
    */
    messages.push({
      kind: "link",
      key: "messages-failed",
      text: "Messages did not load",
      action: "Open Messages",
      href: "/messages",
      tone: "plain",
    });
  } else if (input.inbox.conversations > 0) {
    messages.push({
      kind: "link",
      key: "messages",
      text: `${count(input.inbox.conversations, "guest wrote", "guests wrote")} to you`,
      action: "Reply",
      href: "/messages",
      tone: "plain",
    });
  }

  /* 5. chores with no clock ------------------------------------------------ */
  const chores: Need[] = [];
  const noDates = listings.filter(liveWithNoDates);
  // Adding departures is OWNER, ADMIN or MANAGER, and refused while on hold.
  if (canManage && !suspended && noDates.length > 0) {
    chores.push(
      noDates.length === 1
        ? {
            kind: "link",
            key: "no-dates",
            text: `${noDates[0].title} has no dates in the next 30 days`,
            action: "Add departures",
            href: `/today/listing/${noDates[0].id}`,
            tone: "plain",
          }
        : {
            kind: "link",
            key: "no-dates",
            text: `${noDates.length} live listings have no dates in the next 30 days`,
            action: "Add departures",
            href: "/calendar",
            tone: "plain",
          },
    );
  }
  if (canManage && input.unrecorded !== null && input.unrecorded > 0) {
    chores.push({
      kind: "link",
      key: "unrecorded",
      text: `${count(input.unrecorded, "past cash trip has", "past cash trips have")} no payment recorded`,
      action: "Record the cash or mark a no-show",
      href: "/cash#unrecorded",
      tone: "plain",
    });
  }
  chores.push(...later);

  return [
    ...lead,
    ...requests,
    ...timed.map((t) => t.need),
    ...messages,
    ...chores,
  ];
}
