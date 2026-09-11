import { describe, it, expect } from "vitest";
import { describeBookingState, isUpcomingBooking } from "./booking-state";

/**
 * yuvoy-operator#34. `GET /operator/v1/bookings` returns `b.fulfilment_state`
 * verbatim — a column value, not the projected state the traveller app shows —
 * so the values arriving here are ours and none of them is English.
 */
describe("describeBookingState", () => {
  it("never lets an internal token reach an operator", () => {
    // The sharpest one: on a CARD booking it means paid and not yet visible to
    // the projection. Printed raw it reads as a database error.
    expect(describeBookingState("paid_pending_ops", undefined)?.label).toBe(
      "Payment clearing",
    );
    expect(describeBookingState("pending_request", undefined)?.label).toBe(
      "Waiting on you",
    );
    expect(describeBookingState("no_show", undefined)?.label).toBe(
      "Did not board",
    );
  });

  it("says what a state means to the OPERATOR, not to the traveller", () => {
    /*
      `declined` reads "Refunded" to the person who was charged. To the
      operator it means the sale did not complete and the seat came back —
      the same row, a different fact.
    */
    expect(describeBookingState("declined", undefined)?.label).toBe(
      "Not taken · refunded",
    );
  });

  it("returns null for a state it has never seen", () => {
    /*
      The set is a database column, not a contract enum — `state` is typed as
      a bare `string` — so it grows on the server with no deploy here. There
      is no honest generic that is true of both a completed trip and a
      cancelled one, and the raw token is the defect. The caller renders no
      chip.
    */
    expect(describeBookingState("teleported", undefined)).toBeNull();
    expect(describeBookingState("", undefined)).toBeNull();
    expect(describeBookingState(undefined, undefined)).toBeNull();
  });

  it("does not care about case or stray whitespace", () => {
    expect(describeBookingState(" Confirmed ", undefined)?.label).toBe(
      "Confirmed",
    );
  });
});

describe("describeBookingState — a booking paid at the counter (#40 §1)", () => {
  const owed = { collectPaise: 1_000_000, collected: false };
  const taken = {
    collectPaise: 1_000_000,
    collected: true,
    collectedAt: "2026-09-14T03:34:00Z",
    collectedPaise: 1_000_000,
  };

  it("never says a cash booking's payment is clearing", () => {
    /*
      YV-5DT6RKVQ, in production: a cash booking in `paid_pending_ops` read
      "Payment clearing". Nothing was clearing — the operator was the person
      who had to collect ₹10,000, and their own screen said the opposite.
    */
    const copy = describeBookingState("paid_pending_ops", owed);
    expect(copy?.label).toBe("Collect ₹10,000");
    expect(copy?.label).not.toMatch(/clearing/i);
    expect(copy?.live).toBe(true);
  });

  it("asks for the money on a confirmed cash booking until it is taken", () => {
    expect(describeBookingState("confirmed", owed)?.label).toBe(
      "Collect ₹10,000",
    );
    expect(describeBookingState("confirmed", taken)?.label).toBe("Confirmed");
  });

  it("does not fall back to 'clearing' when the state lags the collection", () => {
    // The API moves the booking to `confirmed` in the same write; a read
    // racing it must not land on the card sentence.
    expect(describeBookingState("paid_pending_ops", taken)?.label).toBe(
      "Cash taken",
    );
  });

  it("asks for nothing from a booking that is over", () => {
    // A no-show who never paid them owes nobody anything.
    expect(describeBookingState("no_show", owed)?.label).toBe("Did not board");
    expect(describeBookingState("cancelled", owed)?.label).toBe("Cancelled");
    // And nothing was refunded, because nothing was ever charged.
    expect(describeBookingState("declined", owed)?.label).toBe("Not taken");
  });

  it("still names a cash booking whose fare did not load", () => {
    expect(
      describeBookingState("paid_pending_ops", {
        collectPaise: null,
        collected: false,
      })?.label,
    ).toBe("Collect cash");
  });
});

describe("isUpcomingBooking", () => {
  it("splits the list without making a claim", () => {
    expect(isUpcomingBooking("confirmed")).toBe(true);
    expect(isUpcomingBooking("pending_request")).toBe(true);
    expect(isUpcomingBooking("completed")).toBe(false);
    expect(isUpcomingBooking("cancelled")).toBe(false);
  });

  it("sorts an unknown state with the past", () => {
    // A booking nobody can name is not one to promise a traveller a seat on.
    expect(isUpcomingBooking("teleported")).toBe(false);
  });
});
