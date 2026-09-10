import type { operations } from "@/lib/api/schema.gen";

type CommissionOwed =
  operations["getCommissionOwed"]["responses"]["200"]["content"]["application/json"];

/** One completed cash trip, and what it owes. */
export interface CommissionLine {
  bookingReference: string;
  /** Market-local `YYYY-MM-DD`. A trip runs on a day, not at an instant. */
  tripDate: string;
  guests: number;
  farePaise: number;
  /** What the operator recorded taking. Absent on a row that did not say. */
  collectedPaise?: number;
  commissionPaise: number;
}

export interface Commission {
  bookings: number;
  farePaise: number;
  commissionPaise: number;
  lines: CommissionLine[];
}

/**
 * What the operator owes Yuvoy on cash we never handled — yuvoy-operator#40 §2.
 *
 * ## Why this is a balance rather than a deduction
 *
 * For a card booking our commission comes out of the payout automatically and
 * the operator never thinks about it. For cash there **is no payout** — the
 * traveller paid them directly, we never touched the money — so our share is a
 * balance they owe us instead.
 *
 * `capturedAmountPaise` is `0` on these bookings and stays `0` for their whole
 * life. Nothing on this screen may imply Yuvoy is holding the fare, because we
 * are not, and the ledger says so.
 *
 * ## The lines are the screen, not a detail of it
 *
 * "A bill that first appears as a demand gets argued about. One that has been
 * visible all along, with the trips behind it listed, gets paid." So this
 * narrows the rows without ever aggregating them away, and the screen leads
 * with what the operator *collected* rather than with what they owe — the
 * commission then reads as a share of something already in their hand.
 *
 * ## Zero is an answer
 *
 * `bookings: 0` is real and common: every cash trip settled, or none taken.
 * It is not an error and not a spinner, and the screen says so in words.
 */
export function toCommission(raw: CommissionOwed): Commission {
  return {
    bookings: int(raw.bookings),
    farePaise: int(raw.farePaise),
    commissionPaise: int(raw.commissionPaise),
    lines: (raw.lines ?? []).map(toLine).sort(byTripDateDescending),
  };
}

function toLine(
  raw: NonNullable<CommissionOwed["lines"]>[number],
): CommissionLine {
  return {
    bookingReference: raw.bookingReference?.trim() || "",
    tripDate: raw.tripDate?.trim() || "",
    guests: int(raw.guests),
    farePaise: int(raw.farePaise),
    /*
      Kept as an absence. `collectedPaise` is the only optional field on a
      line, and a zero rendered where the server said nothing would read as
      "they took nothing" — which is a statement about an operator's honesty,
      not a missing number.
    */
    ...(Number.isInteger(raw.collectedPaise)
      ? { collectedPaise: raw.collectedPaise as number }
      : {}),
    commissionPaise: int(raw.commissionPaise),
  };
}

/**
 * Newest trip first.
 *
 * The API does not promise an order and the screen needs one, or two loads
 * disagree about which trip is at the top. Most recent is the right end to
 * lead with: it is the one an operator remembers and can check.
 *
 * A row with no `tripDate` sorts last rather than being dropped — a line that
 * will not say when it ran is still money owed, and hiding it would make the
 * lines stop adding up to the total above them.
 */
function byTripDateDescending(a: CommissionLine, b: CommissionLine): number {
  if (!a.tripDate) return 1;
  if (!b.tripDate) return -1;
  return b.tripDate.localeCompare(a.tripDate);
}

/**
 * A number, or zero.
 *
 * Every total on this screen is `required` in the contract. Treating a missing
 * one as zero is safe in the only direction that matters here: it understates
 * a balance rather than inventing one, and the lines below it are what an
 * operator checks anyway.
 */
function int(v: number | undefined): number {
  return Number.isInteger(v) ? (v as number) : 0;
}

/**
 * Whether the lines account for the total shown above them.
 *
 * The whole design intent is that every line is checkable, which is only true
 * if they add up. When they do not — a page of lines against a wider total, or
 * a server mid-deploy — the screen says so rather than letting an operator
 * discover it with a calculator and lose confidence in the number.
 */
export function linesReconcile(commission: Commission): boolean {
  if (commission.lines.length !== commission.bookings) return false;
  const summed = commission.lines.reduce((n, l) => n + l.commissionPaise, 0);
  return summed === commission.commissionPaise;
}
