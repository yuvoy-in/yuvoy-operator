import type { components } from "@/lib/api/schema.gen";

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
  /** Absent when nothing has been captured. */
  money?: BookingMoney;
}

/** Whatever `GET /bookings` returned, narrowed without inventing anything. */
export function toBookingLine(raw: OperatorBooking): BookingLine {
  const m = raw.money;
  /*
    All four or none. The contract marks all four required inside `money`, so
    a partial object is a server that is not the one this was built against —
    and a row showing a net with no gross beside it is a row an operator will
    reconcile against anyway.
  */
  const money =
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
  };
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
