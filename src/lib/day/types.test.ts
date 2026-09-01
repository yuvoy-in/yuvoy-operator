import { describe, it, expect } from "vitest";
import { isHolding, orderParties, type Party } from "./types";

const party = (over: Partial<Party>): Party => ({
  bookingId: "bkg_x",
  reference: "YV-0000000",
  name: "Somebody",
  guests: 1,
  state: "confirmed",
  arrived: false,
  ...over,
});

/**
 * What the manifest shows, and in what order.
 *
 * Small logic with a real cost behind it: an operator on a dock reads this
 * list top to bottom while somebody says their name.
 */
describe("the manifest's parties", () => {
  it("treats a party with no bookingId as a hold, whatever the state says", () => {
    // The contract says a hold carries an empty bookingId. Trusting `state`
    // alone would render a party with attendance buttons that cannot work.
    expect(isHolding(party({ bookingId: "", state: "confirmed" }))).toBe(true);
    expect(isHolding(party({ state: "holding" }))).toBe(true);
    expect(isHolding(party({}))).toBe(false);
  });

  it("puts confirmed parties first and sorts them by name", () => {
    const ordered = orderParties([
      party({ name: "Zara", bookingId: "b1" }),
      party({ name: "Alice", bookingId: "", state: "holding" }),
      party({ name: "Bo", bookingId: "b2" }),
    ]);

    expect(ordered.map((p) => p.name)).toEqual(["Bo", "Zara", "Alice"]);
  });

  it("sorts by name and not by booking time", () => {
    // The operator is matching a person who just said their name. Booking
    // order is meaningless information at a jetty.
    const ordered = orderParties([
      party({ name: "Priya", bookingId: "b3" }),
      party({ name: "Asha", bookingId: "b1" }),
      party({ name: "Daniel", bookingId: "b2" }),
    ]);
    expect(ordered.map((p) => p.name)).toEqual(["Asha", "Daniel", "Priya"]);
  });

  it("does not mutate what it was given", () => {
    const input = [party({ name: "Zara" }), party({ name: "Alice" })];
    const before = input.map((p) => p.name);
    orderParties(input);
    expect(input.map((p) => p.name)).toEqual(before);
  });
});
