import { describe, it, expect } from "vitest";
import { describeBookingState, isUpcomingBooking } from "./booking-state";

/**
 * yuvoy-operator#34. `GET /operator/v1/bookings` returns `b.fulfilment_state`
 * verbatim — a column value, not the projected state the traveller app shows —
 * so the values arriving here are ours and none of them is English.
 */
describe("describeBookingState", () => {
  it("never lets an internal token reach an operator", () => {
    // The sharpest one: it means paid and not yet visible to the projection.
    // Printed raw it reads as a database error to somebody running a boat.
    expect(describeBookingState("paid_pending_ops")?.label).toBe(
      "Payment clearing",
    );
    expect(describeBookingState("pending_request")?.label).toBe(
      "Waiting on you",
    );
    expect(describeBookingState("no_show")?.label).toBe("Did not board");
  });

  it("says what a state means to the OPERATOR, not to the traveller", () => {
    /*
      `declined` reads "Refunded" to the person who was charged. To the
      operator it means the sale did not complete and the seat came back —
      the same row, a different fact.
    */
    expect(describeBookingState("declined")?.label).toBe(
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
    expect(describeBookingState("teleported")).toBeNull();
    expect(describeBookingState("")).toBeNull();
    expect(describeBookingState(undefined)).toBeNull();
  });

  it("does not care about case or stray whitespace", () => {
    expect(describeBookingState(" Confirmed ")?.label).toBe("Confirmed");
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
