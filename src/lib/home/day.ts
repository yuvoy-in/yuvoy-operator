import type { Manifest, OperatorSlot } from "@/lib/day/types";
import { marketTime } from "@/lib/format/market-time";
import { formatPaise } from "@/lib/format/money";
import { takesCash, toBookingCash } from "@/lib/money/bookings";
import { neverPublished, type HomeListing } from "./listings";
import { count } from "./words";

/**
 * The day's run sheet on Home (yuvoy-operator#96 block 3, #82 s1).
 *
 * "Time, listing, sold / capacity, checked in, cash to collect. Only
 * departures that can hold people: no drafts, no closed." And #82: "Make each
 * row say the state in words: '6 seats, none sold', 'Not on sale', 'Full'."
 *
 * ## Which departures are part of the day
 *
 * The rule is PEOPLE, not status. A departure is on the sheet when somebody
 * could be on it:
 *
 *   - called off: never. Every booking on it was cancelled.
 *   - a listing that was never on sale (a draft, a first submission in
 *     review, one sent back before it sold): not, unless somebody is on it,
 *     which only a sale at the operator's own counter could have done.
 *   - closed to new bookings: not, unless somebody is on it. Closing stops new
 *     bookings and keeps every booking already made, and a boat with four
 *     people booked still leaves.
 *
 * So "no drafts, no closed" holds for every departure nobody can be on, and
 * the one case it would get wrong (people booked on a departure that stopped
 * selling) stays on the sheet, marked as closed, because hiding it would hide
 * people who are coming.
 */

export type RunTone = "ok" | "attention" | "quiet";

export interface RunRow {
  id: string;
  /** "09:00", in the departure's own market zone. */
  time: string;
  title: string;
  /** What the departure is doing, in words: "6 seats, none sold". */
  state: string;
  tone: RunTone;
  sold: number;
  seats: number;
  /** "2 of 5 checked in", today only, once there is something to say. */
  checkedIn?: string;
  /** "₹9,000 to collect", today only. */
  collect?: string;
}

export interface RunDay {
  /** "Today · 3 departures · 11 guests": the day's section is named by it. */
  heading: string;
  /** "3 departures · 11 guests": the heading without the day's word. */
  summary: string;
  rows: RunRow[];
}

/**
 * Everybody on a departure: sold through Yuvoy, and sold at the counter.
 *
 * `soldOffline` is taken OFF `seats` and is not in `sold` (yuvoy-api#226), so
 * a boat with two walk-ups and no Yuvoy booking read as empty here: dropped
 * from the sheet when closed or on a draft, "none sold", and no guests.
 */
function peopleOn(slot: OperatorSlot): number {
  return slot.sold + (slot.soldOffline ?? 0);
}

/**
 * A departure that says, itself, that its listing was never on sale.
 *
 * The API puts the listing's own state ahead of every departure reason but a
 * kill switch (yuvoy-api `catalog.OperatorSaleBlock`), so a draft's departure
 * reads `listing_draft` and a first submission's `listing_in_review` whatever
 * else is true of it. That is what keeps drafts off the sheet when the
 * listings read failed: without it every departure's listing was unknown, and
 * a draft's empty departures came back beside the live ones.
 */
function onNeverPublishedListing(slot: OperatorSlot): boolean {
  return (
    slot.onSale === false &&
    (slot.notOnSaleReason === "listing_draft" ||
      slot.notOnSaleReason === "listing_in_review")
  );
}

/** Whether a departure belongs on the day's sheet. See the module comment. */
export function holdsPeople(
  slot: OperatorSlot,
  listing: HomeListing | undefined,
): boolean {
  if (slot.status === "cancelled") return false;
  if (peopleOn(slot) > 0) return true;
  if (slot.status === "closed") return false;
  if (listing && neverPublished(listing)) return false;
  if (onNeverPublishedListing(slot)) return false;
  return true;
}

/**
 * The state of one departure, in the words an operator uses on a jetty.
 *
 * Checked in the order the facts outrank each other: a boat that has left is
 * gone whatever else is true of it, a closed one is closed, a full one is
 * full, and only then is "off sale" worth a word, with its reason when the
 * reason is one an operator can act on.
 */
export function departureState(
  slot: OperatorSlot,
  now: number,
): { state: string; tone: RunTone } {
  const at = Date.parse(slot.startsAt);
  if (!Number.isNaN(at) && at <= now)
    return { state: "Departed", tone: "quiet" };
  if (slot.status === "closed" || slot.notOnSaleReason === "departure_closed") {
    return { state: "Closed to new bookings", tone: "quiet" };
  }
  const full =
    slot.notOnSaleReason === "departure_full" ||
    (slot.seats > 0 && slot.sold >= slot.seats);
  if (full) return { state: "Full", tone: "ok" };
  if (slot.onSale === false) {
    switch (slot.notOnSaleReason) {
      case "departure_seats_unconfirmed":
        return { state: "Off sale: seats not confirmed", tone: "attention" };
      case "departure_past_cutoff":
        return { state: "Sales closed", tone: "quiet" };
      case "listing_withdrawn":
        return { state: "Off sale: listing paused", tone: "attention" };
      default:
        return { state: "Not on sale", tone: "attention" };
    }
  }
  if (peopleOn(slot) === 0) {
    return {
      state: `${count(slot.seats, "seat", "seats")}, none sold`,
      tone: "attention",
    };
  }
  /*
    Seats left only where seats are HELD. On a request departure nothing is
    held until the operator says yes, and a departure that does not say its
    mode must not be guessed into one: "3 seats left" there would be a
    promise nobody made.
  */
  if (slot.bookingMode === "allotment") {
    /*
      Floored at zero. A departure with no seat count set and somebody sold at
      the counter reads `0 - 2`, and "-2 seats left" is not a number anybody
      can act on. It cannot reach the `full` branch above, which needs a seat
      count to compare against.
    */
    const left = Math.max(0, slot.seats - slot.sold);
    return { state: `${count(left, "seat", "seats")} left`, tone: "ok" };
  }
  return { state: "On sale", tone: "ok" };
}

/** Who is still to pay at the counter on one departure, from its manifest. */
export interface DepartureCash {
  /** Parties with cash still to take. */
  parties: number;
  /** The sum still to take, or `null` when any fare on it did not come back. */
  collectPaise: number | null;
}

/**
 * Cash still to take on a departure (yuvoy-operator#95 item 2).
 *
 * "A party with a `bookingId` and no `cash` has paid and owes you nothing."
 * What is still to take from a party is `collectPaise` while `collected` is
 * false. A fare that did not come back is still a party to collect from, so
 * it is counted and the sum is said as unknown rather than understated.
 *
 * Only from a party the manifest will take cash from (`takesCash`). Counting
 * every uncollected party had Home say "Collect ₹5,000" about a no-show, and
 * about a trip that completed on its own six hours later, which is counted
 * again under "no payment recorded" and cannot be taken on the manifest.
 */
export function cashToCollect(manifest: Manifest): DepartureCash {
  let parties = 0;
  let paise: number | null = 0;
  for (const party of manifest.parties ?? []) {
    if (!party.bookingId) continue;
    if (!takesCash(party.state)) continue;
    const cash = toBookingCash(party.cash);
    if (!cash || cash.collected) continue;
    parties += 1;
    paise =
      paise === null || cash.collectPaise === null
        ? null
        : paise + cash.collectPaise;
  }
  return { parties, collectPaise: parties === 0 ? 0 : paise };
}

/**
 * "2 of 5 checked in", in guests, or nothing worth saying yet.
 *
 * The manifest's own `totals` when it sent them: "computed server-side so
 * three clients cannot disagree about them on a dock", and the departure's
 * screen shows exactly these, so Home and that screen say one number. Counted
 * here only when an answer carries no totals.
 */
export function checkedIn(
  manifest: Manifest,
  departed: boolean,
): string | undefined {
  const whole = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= 0;
  let booked = 0;
  let here = 0;
  if (whole(manifest.totals?.guests) && whole(manifest.totals?.arrived)) {
    booked = manifest.totals.guests;
    here = manifest.totals.arrived;
  } else {
    for (const party of manifest.parties ?? []) {
      if (!party.bookingId) continue;
      const guests = Number.isInteger(party.guests)
        ? (party.guests as number)
        : 0;
      booked += guests;
      if (party.arrived) here += guests;
    }
  }
  if (booked === 0) return undefined;
  // Before anybody arrives and before it leaves, "0 of 5" is not news.
  if (here === 0 && !departed) return undefined;
  return `${here} of ${booked} checked in`;
}

/**
 * One day's sheet: the departures that can hold people, first off first, each
 * in words, and the heading that counts them.
 *
 * `manifests` is today's only (the one read per departure Home may make, and
 * only for today's): a departure whose manifest did not load simply says less.
 */
export function runDay(input: {
  /** "Today" or "Tomorrow". */
  caption: string;
  slots: readonly OperatorSlot[];
  listings: readonly HomeListing[] | null;
  manifests?: ReadonlyMap<string, Manifest | null>;
  now: number;
}): RunDay {
  const byId = new Map((input.listings ?? []).map((l) => [l.id, l]));
  const rows: RunRow[] = [];
  let guests = 0;

  for (const slot of input.slots) {
    const listing = slot.experienceId ? byId.get(slot.experienceId) : undefined;
    if (!holdsPeople(slot, listing)) continue;

    const { state, tone } = departureState(slot, input.now);
    /*
      The walk-ups, named, while the boat has not left: its `seats` are
      already short by them and `sold` does not count them, so nothing else on
      the row says why (yuvoy-api#226).
    */
    const counter =
      (slot.soldOffline ?? 0) > 0 && state !== "Departed"
        ? ` · ${slot.soldOffline} at your counter`
        : "";
    const row: RunRow = {
      id: slot.id,
      time: marketTime(slot.startsAt, slot.timezone),
      title: slot.title,
      state: `${state}${counter}`,
      tone,
      sold: slot.sold,
      seats: slot.seats,
    };

    const manifest = input.manifests?.get(slot.id);
    if (manifest) {
      const departed = Date.parse(slot.startsAt) <= input.now;
      const here = checkedIn(manifest, departed);
      if (here) row.checkedIn = here;
      const cash = cashToCollect(manifest);
      if (cash.parties > 0) {
        row.collect =
          cash.collectPaise === null
            ? "Cash to collect"
            : `${formatPaise(cash.collectPaise)} to collect`;
      }
    }

    guests += peopleOn(slot);
    rows.push(row);
  }

  const summary = `${count(rows.length, "departure", "departures")} · ${count(guests, "guest", "guests")}`;
  return { heading: `${input.caption} · ${summary}`, summary, rows };
}
