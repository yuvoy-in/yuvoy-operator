import { describe, expect, it } from "vitest";
import type { OperatorSlot } from "@/lib/day/types";
import { departureOf } from "./departure-of";

const slot = (over: Partial<OperatorSlot>): OperatorSlot => ({
  id: "slot_1",
  title: "Try-dive",
  experienceId: "exp_dive",
  startsAt: "2026-10-04T01:30:00Z",
  timezone: "Asia/Kolkata",
  seats: 8,
  sold: 5,
  remaining: 3,
  status: "open",
  ...over,
});

const booking = { experienceId: "exp_dive", startsAt: "2026-10-04T01:30:00Z" };

/*
  Until yuvoy-api#259 sends the departure's id on a booking: the listing and
  the start time find it, and anything but exactly one match is no link.
*/
describe("which departure a booking is on", () => {
  it("is the one departure of its listing at its start time", () => {
    expect(
      departureOf(booking, [
        slot({ id: "other_listing", experienceId: "exp_snorkel" }),
        slot({ id: "later", startsAt: "2026-10-04T05:00:00Z" }),
        slot({ id: "the_one" }),
      ]),
    ).toBe("the_one");
  });

  it("matches the instant, not the spelling of it", () => {
    expect(
      departureOf({ ...booking, startsAt: "2026-10-04T07:00:00+05:30" }, [
        slot({ id: "the_one" }),
      ]),
    ).toBe("the_one");
  });

  it("is no link when two departures could be it, rather than a guess", () => {
    expect(
      departureOf(booking, [slot({ id: "boat_a" }), slot({ id: "boat_b" })]),
    ).toBeNull();
  });

  it("is no link when it cannot know", () => {
    expect(departureOf({ startsAt: booking.startsAt }, [slot({})])).toBeNull();
    expect(departureOf({ experienceId: "exp_dive" }, [slot({})])).toBeNull();
    expect(departureOf(booking, [])).toBeNull();
  });
});
