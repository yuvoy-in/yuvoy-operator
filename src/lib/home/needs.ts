import {
  blockerAction,
  blockerText,
  byGatingFirst,
  expiringDocuments,
  stopsSelling,
  type Blocker,
  type Standing,
} from "@/lib/account/standing";
import { marketDayOf } from "@/lib/day/calendar";
import type { OpenRequest } from "@/lib/day/request-types";
import { requestView, type RequestView } from "@/lib/day/request-view";
import { timeToAnswer, urgencyOf } from "@/lib/day/request-types";
import { dayCaption, marketTime } from "@/lib/format/market-time";
import { formatPaise } from "@/lib/format/money";
import type { BookingCash } from "@/lib/money/bookings";
import { SUPPORT_PHONE_HREF } from "@/lib/site/contact";
import type { InboxCount } from "@/lib/site/inbox-count";
import { liveWithNoDates, type HomeListing } from "./listings";
import { mayActOn } from "./status";
import { count } from "./words";

/**
 * "Needs you": one list, sorted by deadline, and every row finished where it
 * stands (yuvoy-operator#96 block 2, #82 s2; operator experiment A, approved
 * 3 Oct 2026).
 *
 * #82: "Messages are not the most urgent thing an operator has; a request
 * expiring in an hour is ... One strip, ranked: requests waiting first, then
 * messages, then anything else, and each labelled with the time pressure."
 *
 * Experiment A's change is that Home stops linking to the work and becomes
 * it: a request is accepted or declined on its card, a guest is answered on
 * theirs, the cash is taken party by party on its own. The rows that are a
 * place to go (an account gap, a listing with no dates) still go there.
 *
 * ## The order
 *
 *   1. What stops the business selling, when it cannot: the one thing that
 *      unblocks it leads (#96 "States").
 *   2. Seat requests, soonest to expire first, each with its clock. At most
 *      three here; the rest are one row that opens Bookings.
 *   3. Anything else with a clock, by that clock: departures going off sale,
 *      cash to take and guests writing about today's departures by the time
 *      each leaves, and documents by the day they run out.
 *   4. Guests who wrote about any other day.
 *   5. Chores with no clock: live listings with nothing to sell, past cash
 *      trips nobody recorded, and what is still owed on the account.
 *
 * Every row is plain data, worked out here on the server, so the client list
 * that holds an answer's Undo formats nothing (and so cannot disagree with
 * the server about a day or a clock).
 */

export type NeedTone = "alert" | "plain";

export interface RequestNeed {
  kind: "request";
  key: string;
  view: RequestView;
}

/** A guest who wrote, to be answered on Home (experiment A). */
export interface MessageNeed {
  kind: "message";
  key: string;
  bookingId: string;
  reference: string;
  /** "2 new". */
  unread: string;
  /** "Snorkel trip to Elephant Beach · Today at 23:30". */
  trip: string;
  /**
   * The two halves of `trip`, for a card that sets each in its own voice: the
   * host's own name for the experience (null when the thread carries none,
   * because the "A trip" standing in for it is ours), and when it leaves (""
   * when the thread carries no start).
   */
  experience: string | null;
  when: string;
}

/** One party's cash on today's departure, as the card takes it. */
export interface CashParty {
  bookingId: string;
  name: string;
  reference: string;
  guests: number;
  /** The booking's state, which decides whether it can still take money. */
  state: string;
  cash: BookingCash;
}

export interface CashNeed {
  kind: "cash";
  key: string;
  slotId: string;
  /** "Collect ₹10,000 on the 09:00". */
  text: string;
  /** "Reef dive · 2 parties". */
  detail: string;
  /**
   * The two halves of `detail`, for a card that sets each in its own voice:
   * the departure's name as the day sheet shows it, and "2 parties".
   */
  experience: string;
  partyCount: string;
  timezone: string;
  parties: CashParty[];
}

/** A document about to take listings down (audit 5.7). */
export interface DocumentNeed {
  kind: "document";
  key: string;
  /** "Insurance expires 30 November 2026. Listings that need it come down that day." */
  text: string;
  /** "21 days left", "Tomorrow", "Today". */
  chip: string;
  action: { href: string; label: string } | null;
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

export type Need =
  | RequestNeed
  | MessageNeed
  | CashNeed
  | DocumentNeed
  | ConfirmSeatsNeed
  | LinkNeed;

/** How many requests Home draws before handing the rest to Bookings. */
export const REQUEST_ROWS = 3;

/** How many guests Home offers to answer before handing the rest to Messages. */
export const MESSAGE_ROWS = 3;

const REQUESTS_HREF = "/bookings?view=requests";

/** Today's cash, per departure, from the manifests Home reads. */
export interface TodayCash {
  slotId: string;
  startsAt: string;
  timezone: string;
  title: string;
  /** The parties with cash still to take. */
  parties: CashParty[];
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

/** "Collect ₹10,000 on the 09:00", from the parties that still owe it. */
export function cashNeed(cash: TodayCash): CashNeed | null {
  const parties = cash.parties.filter((p) => !p.cash.collected);
  if (parties.length === 0) return null;
  const time = marketTime(cash.startsAt, cash.timezone);
  const partyCount = count(parties.length, "party", "parties");
  const total = parties.reduce<number | null>(
    (sum, p) =>
      sum === null || p.cash.collectPaise === null
        ? null
        : sum + p.cash.collectPaise,
    0,
  );
  return {
    kind: "cash",
    key: `cash-${cash.slotId}`,
    slotId: cash.slotId,
    text:
      total === null
        ? `Collect cash on the ${time}`
        : `Collect ${formatPaise(total)} on the ${time}`,
    detail: `${cash.title} · ${partyCount}`,
    experience: cash.title,
    partyCount,
    timezone: cash.timezone,
    parties,
  };
}

/** "21 days left", for a document's chip. */
function daysLeft(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days} days left`;
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
  /** The market's today and tomorrow, `YYYY-MM-DD`. */
  today: string;
  tomorrow: string;
  now: number;
}): Need[] {
  const { standing, suspended, canManage } = input;
  const days = { at: input.now, today: input.today, tomorrow: input.tomorrow };

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
      const stopping = stopsSelling(standing, blocker);
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
      // The one phrasing the request cards use too (audit 5.13).
      detail: `Soonest: ${timeToAnswer(first.minutesToAnswer)}`,
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
      requests.push({
        kind: "request",
        key: `request-${request.id ?? ""}`,
        view: requestView(request, days),
      });
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
    const need = cashNeed(cash);
    if (!need) continue;
    const at = Date.parse(cash.startsAt);
    timed.push({ at: Number.isNaN(at) ? input.now : at, need });
  }
  // Renewing is refused while on hold, and documents are a manager's job.
  if (canManage && !suspended && standing) {
    expiringDocuments(standing.credentials, input.now).forEach((doc, i) => {
      timed.push({
        at: input.now + doc.days * 24 * 60 * 60 * 1000,
        need: {
          kind: "document",
          key: `document-${i}-${doc.name}`,
          text: doc.sentence,
          chip: daysLeft(doc.days),
          action: doc.action,
        },
      });
    });
  }

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
    const shown = input.inbox.unread.slice(0, MESSAGE_ROWS);
    for (const row of shown) {
      const day = row.startsAt ? marketDayOf(row.startsAt, row.timezone) : null;
      const experience = row.experience.trim() || null;
      const when =
        day && row.startsAt
          ? `${dayCaption(day, input.today, input.tomorrow, row.timezone)} at ${marketTime(row.startsAt, row.timezone)}`
          : "";
      const need: MessageNeed = {
        kind: "message",
        key: `message-${row.bookingId}`,
        bookingId: row.bookingId,
        reference: row.reference,
        unread: `${row.unreadCount} new`,
        trip: [experience ?? "A trip", ...(when ? [when] : [])].join(" · "),
        experience,
        when,
      };
      /*
        A guest writing about a boat that leaves later today ("I am running
        ten minutes behind") is on that departure's clock, not at the back
        of the queue.
      */
      const at = row.startsAt ? Date.parse(row.startsAt) : Number.NaN;
      if (day === input.today && !Number.isNaN(at) && at > input.now) {
        timed.push({ at, need });
      } else {
        messages.push(need);
      }
    }
    const rest = input.inbox.conversations - shown.length;
    if (rest > 0) {
      messages.push({
        kind: "link",
        key: "messages-more",
        text: `${count(rest, "more guest wrote", "more guests wrote")} to you`,
        action: "Open Messages",
        href: "/messages",
        tone: "plain",
      });
    }
  }
  timed.sort((a, b) => a.at - b.at);

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
