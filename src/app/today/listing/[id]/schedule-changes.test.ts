import { describe, expect, it } from "vitest";
import { closingSentence, removedTimes } from "./schedule-changes";

const TUE = { weekday: 2, startTime: "09:00", seats: 8 };
const FRI = { weekday: 5, startTime: "14:30", seats: 6 };

describe("what a schedule save closes", () => {
  it("is every weekday and time the listing had that the rows do not", () => {
    expect(removedTimes([TUE, FRI], [FRI])).toEqual([TUE]);
    // A changed time is the old one removed.
    expect(removedTimes([TUE], [{ ...TUE, startTime: "07:15" }])).toEqual([
      TUE,
    ]);
    // A changed day too.
    expect(removedTimes([TUE], [{ ...TUE, weekday: 3 }])).toEqual([TUE]);
  });

  it("is nothing for a change of seats, a new row, or rows in a new order", () => {
    expect(removedTimes([TUE], [{ ...TUE, seats: 12 }])).toEqual([]);
    expect(removedTimes([TUE], [TUE, FRI])).toEqual([]);
    expect(removedTimes([TUE, FRI], [FRI, TUE])).toEqual([]);
  });

  it("names a time once, however many rows had it", () => {
    expect(removedTimes([TUE, { ...TUE, seats: 4 }], [])).toEqual([TUE]);
  });
});

describe("what the question says", () => {
  it("names the days and times, and that the bookings stay", () => {
    expect(closingSentence([TUE])).toBe(
      "Departures it made on Tuesdays at 09:00 stop taking new bookings. Bookings already on them stay.",
    );
    expect(
      closingSentence([TUE, FRI, { weekday: 0, startTime: "06:00", seats: 2 }]),
    ).toBe(
      "Departures it made on Tuesdays at 09:00, Fridays at 14:30 and Sundays at 06:00 stop taking new bookings. Bookings already on them stay.",
    );
  });
});
