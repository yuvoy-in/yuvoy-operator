import type { components } from "@/lib/api/schema.gen";

/**
 * Cash the business is holding that is not theirs — yuvoy-operator#95.
 *
 * ## Why this exists
 *
 * Calling a departure off refunds "everything captured ONLINE". A traveller
 * who paid at the counter paid nothing online, so they add nothing to
 * `refundedPaise`, and the portal said "Everybody has been told and refunded
 * in full" while the operator still had their notes. The cancelled parties
 * then dropped off the manifest, and nothing anywhere named the money.
 *
 * `CashToGiveBack` is the API's answer, on the call-off result and on the
 * manifest: one line per cancelled booking whose cash was recorded taken, and
 * still not recorded given back. A party leaves the list when
 * `POST /bookings/{id}/cash-returned` is recorded, so the manifest keeps
 * naming the money until it is handed back.
 *
 * ## Absent is the ordinary case
 *
 * "Present only when there is somebody on it." A departure called off with
 * nobody owed cash carries none, so `null` renders nothing at all. A block
 * that is present but has no usable line is also `null`: a heading over an
 * empty list would ask an operator to hand back money to nobody.
 */

type Raw = components["schemas"]["CashToGiveBack"];

export interface GiveBackParty {
  bookingId: string;
  /** The booking reference, which is what the traveller will show. */
  reference: string;
  /** A first name and nothing else (D-018). Empty when none is held. */
  name: string;
  guests: number;
  /** What was recorded taken, which is all of what goes back. */
  amountPaise: number;
}

export interface GiveBack {
  totalPaise: number;
  parties: GiveBackParty[];
}

const isPaise = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

export function toGiveBack(raw: Raw | null | undefined): GiveBack | null {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.parties)) {
    return null;
  }

  const parties = raw.parties
    .filter((p) => typeof p?.bookingId === "string" && p.bookingId !== "")
    .map((p) => ({
      bookingId: p.bookingId,
      reference: p.reference?.trim() || "",
      name: p.name?.trim() || "",
      guests: Number.isInteger(p.guests) && p.guests > 0 ? p.guests : 0,
      amountPaise: isPaise(p.amountPaise) ? p.amountPaise : 0,
    }))
    /*
      A line with nothing to hand back is not a line. "Whole: no partial
      return is recorded anywhere", so a zero here is a malformed row, not a
      party owed nothing.
    */
    .filter((p) => p.amountPaise > 0);

  if (parties.length === 0) return null;

  /*
    The total is the API's when it agrees with the lines, and the lines' sum
    when it does not: "what the lines below add up to" is the contract's own
    definition, and a total that disagreed with the list under it would be
    the one number an operator checks with a calculator.
  */
  const summed = parties.reduce((n, p) => n + p.amountPaise, 0);
  return {
    totalPaise: raw.totalPaise === summed ? raw.totalPaise : summed,
    parties,
  };
}
