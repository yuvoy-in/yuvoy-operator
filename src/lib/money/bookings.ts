import type { components } from "@/lib/api/schema.gen";
import { formatPaise } from "@/lib/format/money";
import { marketTime } from "@/lib/format/market-time";

/**
 * One booking's money, for the "why is THIS one less" question (O11).
 *
 * `OperatorBooking.money` arrived on 3 Sep 2026 (yuvoy-api#60 → PR #61): the
 * same frozen figures `/earnings` sums, unaggregated. Two things about it
 * decide how this screen may use it, both from the contract's own words:
 *
 *   - **Absent is "no money moved", not "unknown".** A `pending_request`
 *     awaiting its operator has captured nothing and carries no `money`. A row
 *     of zeroes would invite reconciling a booking that has nothing to
 *     reconcile, so the absence is kept as an absence.
 *   - **A page of these does not sum to the period.** `/earnings` selects on
 *     `created_at` — when the money moved — while `/bookings` selects on the
 *     slot's `startsAt`, when the trip runs. A booking made in March for a
 *     trip in April is in March's earnings and April's list. So this module
 *     never adds rows up, and the screen says so: reconcile one booking
 *     against itself, not a page against a period.
 */

export type OperatorBooking = components["schemas"]["OperatorBooking"];

export interface BookingMoney {
  grossPaise: number;
  commissionPaise: number;
  refundsPaise: number;
  netPaise: number;
}

/**
 * A booking the traveller pays at the counter — yuvoy-operator#40 §1.
 *
 * `OperatorBooking.cash` (yuvoy-api#156) is PRESENT ONLY on a cash booking,
 * and that presence is the whole signal: "absent means they have already paid
 * us and you collect nothing". So a line carries `cash` exactly when the wire
 * did, and nothing here infers it from `state` — `paid_pending_ops` is what a
 * card booking looks like in the same instant, which is how a cash booking
 * came to read "Payment clearing" in production on YV-5DT6RKVQ.
 */
export interface BookingCash {
  /**
   * The FARE — what to take from them, in paise. Deliberately not
   * `money.grossPaise`, which is what we captured and is zero on a cash
   * booking for its whole life.
   *
   * `null` when the response did not carry a usable number. The booking is
   * still a cash booking, and saying so without an amount is truer than
   * dropping the fact.
   */
  collectPaise: number | null;
  /** Whether a collection has been recorded. */
  collected: boolean;
  collectedAt?: string;
  /** What was recorded as taken — less than the fare when they gave something off. */
  collectedPaise?: number;
}

export interface BookingLine {
  id: string;
  reference: string;
  /** The traveller's name, and only the name (O12). */
  name: string;
  guests: number;
  experience: string;
  startsAt?: string;
  timezone: string;
  /** Free text in the contract — no enum — so it is shown, never branched on. */
  state: string;
  /** Absent when nothing has been captured, and always absent on a cash booking. */
  money?: BookingMoney;
  /** Present only on a booking paid at the counter. */
  cash?: BookingCash;
}

const isPaise = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** The `cash` object, narrowed — or `undefined` when this is not a cash booking. */
export function toBookingCash(
  raw: OperatorBooking["cash"] | null | undefined,
): BookingCash | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const collectedAt =
    typeof raw.collectedAt === "string" && raw.collectedAt !== ""
      ? raw.collectedAt
      : undefined;

  return {
    collectPaise: isPaise(raw.collectPaise) ? raw.collectPaise : null,
    /*
      A recorded time IS a recorded collection, whatever the boolean beside it
      says. The API answers a second report with the first one, so reading a
      contradiction as "taken" costs nothing; reading it as "not taken" puts a
      button under a thumb that asks a traveller for the money twice.
    */
    collected: raw.collected === true || collectedAt !== undefined,
    ...(collectedAt ? { collectedAt } : {}),
    ...(isPaise(raw.collectedPaise)
      ? { collectedPaise: raw.collectedPaise }
      : {}),
  };
}

/** Whatever `GET /bookings` returned, narrowed without inventing anything. */
export function toBookingLine(raw: OperatorBooking): BookingLine {
  const cash = toBookingCash(raw.cash);
  const m = raw.money;
  /*
    All four or none. The contract marks all four required inside `money`, so
    a partial object is a server that is not the one this was built against —
    and a row showing a net with no gross beside it is a row an operator will
    reconcile against anyway.

    And NEVER on a cash booking, whatever the wire says. The API sends `money`
    on one: `captured_amount_paise` is 0 rather than null and the commission on
    the fare is stored when the booking is made, so the row arrives as gross
    ₹0, commission ₹1,350, net −₹1,350 — and it reconciles. As arithmetic that
    tells an operator they LOST money on a trip a traveller paid them for in
    full. Nothing on a cash booking passes through a payout; the share owed on
    it lives on `/cash`. Raised on yuvoy-operator#40.
  */
  const money =
    !cash &&
    m &&
    [m.grossPaise, m.commissionPaise, m.refundsPaise, m.netPaise].every(
      Number.isInteger,
    )
      ? {
          grossPaise: m.grossPaise,
          commissionPaise: m.commissionPaise,
          refundsPaise: m.refundsPaise,
          netPaise: m.netPaise,
        }
      : undefined;

  return {
    id: raw.id ?? "",
    reference: raw.reference ?? "",
    name: raw.contact?.name ?? "",
    guests: raw.guests ?? 0,
    experience: raw.experience ?? "",
    startsAt: raw.slot?.startsAt,
    timezone: raw.slot?.timezone ?? "Asia/Kolkata",
    state: raw.state ?? "",
    money,
    ...(cash ? { cash } : {}),
  };
}

/**
 * The cash, as one line an operator reads at the gangway.
 *
 * "Cash taken" and "take", never "paid" — the operator was paid, we were not,
 * and nothing here may imply Yuvoy holds the fare. After a collection the row
 * reads plainly, `₹10,000 taken · 09:04`, with the fare beside it only when
 * less was taken, because that is the one number a mis-key hides in.
 */
export function describeCash(cash: BookingCash, timezone: string): string {
  if (cash.collected) {
    const took = cash.collectedPaise ?? cash.collectPaise;
    const when = cash.collectedAt
      ? ` · ${marketTime(cash.collectedAt, timezone)}`
      : "";
    if (took === null) return `Cash taken${when}`;
    const short =
      cash.collectedPaise !== undefined &&
      cash.collectPaise !== null &&
      cash.collectedPaise < cash.collectPaise;
    return `${formatPaise(took)} taken${
      short ? ` of ${formatPaise(cash.collectPaise as number)}` : ""
    }${when}`;
  }
  return cash.collectPaise === null
    ? "Cash at the counter — the amount did not load"
    : `${formatPaise(cash.collectPaise)} to take in cash`;
}

/**
 * The same check the totals get, per row.
 *
 * `netPaise` is sent rather than derived "so that every surface subtracts in
 * the same order" — which means a row where it does not equal
 * gross − commission − refunds is a row the operator must be told not to
 * reconcile against, not a row to quietly recompute.
 */
export function bookingReconciles(m: BookingMoney): boolean {
  return m.grossPaise - m.commissionPaise - m.refundsPaise === m.netPaise;
}

/** Departure order — the order an operator's own book is kept in. */
export function byDeparture(a: BookingLine, b: BookingLine): number {
  return (a.startsAt ?? "").localeCompare(b.startsAt ?? "");
}
