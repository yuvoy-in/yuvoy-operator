import { describe, it, expect } from "vitest";
import {
  bookingReconciles,
  byDeparture,
  describeCash,
  toBookingCash,
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
    expect(line.cash).toBeUndefined();
  });
});

describe("a booking paid at the counter — yuvoy-operator#40 §1", () => {
  it("is a cash booking exactly when the wire carries `cash`", () => {
    // Presence is the signal. "Absent means they have already paid us and you
    // collect nothing" — so a card booking in `paid_pending_ops` stays a card
    // booking, however alike the two states look.
    expect(
      toBookingLine(booking({ state: "paid_pending_ops" })).cash,
    ).toBeUndefined();
    expect(
      toBookingLine(
        booking({
          state: "paid_pending_ops",
          cash: { collectPaise: 1_000_000, collected: false },
        }),
      ).cash,
    ).toEqual({ collectPaise: 1_000_000, collected: false });
  });

  it("never shows card arithmetic on a cash booking", () => {
    /*
      What the API really sends: captured is 0, the commission on the fare is
      stored, so gross ₹0 − commission ₹1,500 = net −₹1,500, and it even
      reconciles. Rendered, that tells an operator they lost money on a trip
      they were paid for in full.
    */
    const line = toBookingLine(
      booking({
        cash: { collectPaise: 1_000_000, collected: false },
        money: {
          grossPaise: 0,
          commissionPaise: 150_000,
          refundsPaise: 0,
          netPaise: -150_000,
        },
      }),
    );
    expect(line.money).toBeUndefined();
    expect(line.cash?.collectPaise).toBe(1_000_000);
  });

  it("keeps a cash booking a cash booking when the fare is unreadable", () => {
    const cash = toBookingCash({
      collectPaise: "lots",
      collected: false,
    } as unknown as OperatorBooking["cash"]);
    expect(cash).toEqual({ collectPaise: null, collected: false });
  });

  it("reads a recorded time as a recorded collection", () => {
    // The dangerous reading of a contradiction is "not taken": it offers the
    // button again and asks a traveller for the money twice.
    const cash = toBookingCash({
      collectPaise: 1_000_000,
      collected: false,
      collectedAt: "2026-09-14T03:34:00Z",
      collectedPaise: 1_000_000,
    });
    expect(cash?.collected).toBe(true);
  });

  it("says what to take, and after, what was taken and when", () => {
    expect(
      describeCash(
        { collectPaise: 1_000_000, collected: false },
        "Asia/Kolkata",
      ),
    ).toBe("₹10,000 to take in cash");
    expect(
      describeCash(
        {
          collectPaise: 1_000_000,
          collected: true,
          collectedAt: "2026-09-14T03:34:00Z",
          collectedPaise: 1_000_000,
        },
        "Asia/Kolkata",
      ),
    ).toBe("₹10,000 taken · 09:04");
  });

  it("names the fare beside a collection only when less was taken", () => {
    // The mis-key case — 300 typed for 3000 — is the one the fare exposes.
    expect(
      describeCash(
        {
          collectPaise: 1_000_000,
          collected: true,
          collectedAt: "2026-09-14T03:34:00Z",
          collectedPaise: 300_000,
        },
        "Asia/Kolkata",
      ),
    ).toBe("₹3,000 taken of ₹10,000 · 09:04");
  });

  it("never says 'paid' — they were paid, we were not", () => {
    for (const text of [
      describeCash(
        { collectPaise: 1_000_000, collected: false },
        "Asia/Kolkata",
      ),
      describeCash({ collectPaise: null, collected: false }, "Asia/Kolkata"),
      describeCash(
        {
          collectPaise: null,
          collected: true,
          collectedAt: "2026-09-14T03:34:00Z",
        },
        "Asia/Kolkata",
      ),
    ]) {
      expect(text.toLowerCase()).not.toContain("paid");
    }
  });
});
