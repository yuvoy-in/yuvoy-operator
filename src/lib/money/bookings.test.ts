import { describe, it, expect } from "vitest";
import {
  bookingReconciles,
  byDeparture,
  toBookingLine,
  type OperatorBooking,
} from "./bookings";

const booking = (over: Partial<OperatorBooking> = {}): OperatorBooking => ({
  id: "bkg_1",
  reference: "YV-4K2M9P7Q",
  state: "confirmed",
  guests: 2,
  experience: "Try-dive at Nemo Reef",
  slot: { startsAt: "2026-09-03T01:15:00Z", timezone: "Asia/Kolkata" },
  contact: { name: "Asha Menon" },
  ...over,
});

describe("what one booking contributed", () => {
  it("carries the four figures through untouched", () => {
    const line = toBookingLine(
      booking({
        money: {
          grossPaise: 900_000,
          commissionPaise: 135_000,
          refundsPaise: 0,
          netPaise: 765_000,
        },
      }),
    );
    expect(line.money).toEqual({
      grossPaise: 900_000,
      commissionPaise: 135_000,
      refundsPaise: 0,
      netPaise: 765_000,
    });
    expect(line.name).toBe("Asha Menon");
    expect(line.reference).toBe("YV-4K2M9P7Q");
  });

  it("keeps an absent `money` absent — no money moved, not unknown", () => {
    /*
      "Absent on a booking that never captured — a `pending_request` awaiting
      its operator has moved no money and has none of this." A row of zeroes
      would invite reconciling a booking that has nothing to reconcile.
    */
    const line = toBookingLine(booking({ state: "pending_request" }));
    expect(line.money).toBeUndefined();
    expect(line.state).toBe("pending_request");
  });

  it("refuses a partial money object rather than showing a net with no gross", () => {
    const line = toBookingLine(
      booking({
        money: { netPaise: 765_000 } as unknown as OperatorBooking["money"],
      }),
    );
    expect(line.money).toBeUndefined();
  });

  it("reconciles a row the way the totals are reconciled", () => {
    // `netPaise` is sent, not derived. A row where it disagrees is a row the
    // operator is told not to reconcile against — never one quietly recomputed.
    expect(
      bookingReconciles({
        grossPaise: 900_000,
        commissionPaise: 135_000,
        refundsPaise: 450_000,
        netPaise: 315_000,
      }),
    ).toBe(true);
    expect(
      bookingReconciles({
        grossPaise: 900_000,
        commissionPaise: 135_000,
        refundsPaise: 450_000,
        netPaise: 765_000,
      }),
    ).toBe(false);
  });

  it("orders by departure, the way an operator's book is kept", () => {
    const later = toBookingLine(
      booking({ id: "b", slot: { startsAt: "2026-09-04T03:30:00Z" } }),
    );
    const earlier = toBookingLine(
      booking({ id: "a", slot: { startsAt: "2026-09-03T01:15:00Z" } }),
    );
    const undated = toBookingLine(booking({ id: "c", slot: undefined }));
    expect(
      [later, undated, earlier].sort(byDeparture).map((b) => b.id),
    ).toEqual(["c", "a", "b"]);
  });

  it("invents nothing when the response is thin", () => {
    const line = toBookingLine({});
    expect(line).toEqual({
      id: "",
      reference: "",
      name: "",
      guests: 0,
      experience: "",
      startsAt: undefined,
      timezone: "Asia/Kolkata",
      state: "",
      money: undefined,
    });
  });
});
