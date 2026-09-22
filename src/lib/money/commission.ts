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
  /** Owed now: completed cash trips the operator recorded taking cash for. */
  bookings: number;
  farePaise: number;
  /**
   * The cash recorded taken on the trips owed now, which can be short of the
   * fares. Absent on an older API, which never said.
   */
  collectedPaise?: number;
  commissionPaise: number;
  lines: CommissionLine[];
  /**
   * Cash recorded taken for trips still to run (yuvoy-api#211, op#94). None of
   * its share is owed yet: it moves to owed when the trip is completed.
   * `null` when the API sent none of the held figures, an older API, so the
   * screen draws nothing rather than "₹0 held".
   */
  held: CashBucket | null;
  /**
   * Cash trips that ran more than six hours ago with no cash recorded
   * (yuvoy-api#221). Nothing says whether the business was paid, so none of it
   * is held or owed, and only the operator can close each one. `null` when the
   * API sent none of these figures.
   */
  unrecorded: UnrecordedCash | null;
}

export interface CashBucket {
  bookings: number;
  farePaise: number;
  collectedPaise: number;
  commissionPaise: number;
  lines: CommissionLine[];
}

export interface UnrecordedCash {
  bookings: number;
  /** The fares agreed, "not cash anybody is known to have". */
  farePaise: number;
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
    ...(Number.isInteger(raw.collectedPaise)
      ? { collectedPaise: raw.collectedPaise as number }
      : {}),
    commissionPaise: int(raw.commissionPaise),
    lines: (raw.lines ?? []).map(toLine).sort(byTripDateDescending),
    held: toHeld(raw),
    unrecorded: toUnrecorded(raw),
  };
}

/**
 * The held figures, or `null` when the API sent none of them.
 *
 * Required in the contract since 22 Sep and read as optional all the same: a
 * pinned contract says what the API WILL send, and "₹0 held" drawn from an API
 * that never said would tell an operator with ₹25,000 in hand that they hold
 * nothing. The count is the signal, because a held bucket is its count.
 */
function toHeld(raw: CommissionOwed): CashBucket | null {
  if (!Number.isInteger(raw.heldBookings)) return null;
  return {
    bookings: int(raw.heldBookings),
    farePaise: int(raw.heldFarePaise),
    collectedPaise: int(raw.heldCollectedPaise),
    commissionPaise: int(raw.heldCommissionPaise),
    /*
      Soonest trip first, as the API orders them: these are trips still to
      run, and the next one is the one an operator is about to take money for.
    */
    lines: (raw.heldLines ?? []).map(toLine).sort(byTripDateAscending),
  };
}

/** The unrecorded figures, or `null` when the API sent none of them. */
function toUnrecorded(raw: CommissionOwed): UnrecordedCash | null {
  if (!Number.isInteger(raw.unrecordedBookings)) return null;
  return {
    bookings: int(raw.unrecordedBookings),
    farePaise: int(raw.unrecordedFarePaise),
    lines: (raw.unrecordedLines ?? []).map(toLine).sort(byTripDateDescending),
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

/** Soonest trip first, for trips still to run. A dateless row still sorts last. */
function byTripDateAscending(a: CommissionLine, b: CommissionLine): number {
  if (!a.tripDate) return 1;
  if (!b.tripDate) return -1;
  return a.tripDate.localeCompare(b.tripDate);
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
export function linesReconcile(commission: {
  bookings: number;
  commissionPaise: number;
  lines: CommissionLine[];
}): boolean {
  if (commission.lines.length !== commission.bookings) return false;
  const summed = commission.lines.reduce((n, l) => n + l.commissionPaise, 0);
  return summed === commission.commissionPaise;
}

/**
 * All the cash the operator has recorded taking, owed and held together:
 * "`collectedPaise` plus `heldCollectedPaise` is all the cash you have
 * recorded taking on those bookings". `null` when either half is unknown,
 * because a total missing a half would understate what is in their hand.
 */
export function cashInHand(commission: Commission): number | null {
  if (commission.collectedPaise === undefined || !commission.held) return null;
  return commission.collectedPaise + commission.held.collectedPaise;
}
