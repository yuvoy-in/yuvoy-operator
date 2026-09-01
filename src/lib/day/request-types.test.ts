import { describe, it, expect } from "vitest";
import {
  DECLINE_REASONS,
  canGrant,
  timeToAnswer,
  urgencyOf,
  type OpenRequest,
} from "./request-types";

const req = (over: Partial<OpenRequest>): OpenRequest => ({
  id: "req_1",
  slotId: "slot_1",
  experience: "Try-dive at Nemo Reef",
  guests: 2,
  startsAt: "2026-08-18T01:15:00Z",
  timezone: "Asia/Kolkata",
  requestedAt: "2026-08-17T10:00:00Z",
  expiresAt: "2026-08-18T00:00:00Z",
  contactName: "Somebody",
  seatsGrantable: 4,
  minutesToAnswer: 120,
  ...over,
});

/**
 * The clock and the ceiling — the two numbers an operator decides on.
 *
 * Both come from the server and neither is re-derived here. `minutesToAnswer`
 * is computed server-side "so every client agrees", and two clients computing
 * it from `expiresAt` would disagree by however far apart their clocks are.
 */
describe("a waiting request", () => {
  it("reads the clock from the server's minutes, never from expiresAt", () => {
    // Same expiresAt, different server minutes: the server wins.
    expect(timeToAnswer(24)).toBe("24 min left");
    expect(timeToAnswer(175)).toBe("2h 55m left");
    expect(timeToAnswer(180)).toBe("3h left");
    expect(timeToAnswer(1800)).toBe("1d left");
  });

  it("says out of time rather than showing a negative", () => {
    // The contract says minutesToAnswer is never negative, but zero happens
    // and "0 min left" reads as a working clock rather than a closed door.
    expect(timeToAnswer(0)).toBe("Out of time");
    expect(timeToAnswer(undefined)).toBe("Out of time");
  });

  it("calls anything inside an hour critical", () => {
    // The failure being designed against is requests rotting unanswered.
    expect(urgencyOf(24)).toBe("critical");
    expect(urgencyOf(60)).toBe("critical");
    expect(urgencyOf(61)).toBe("soon");
    expect(urgencyOf(240)).toBe("soon");
    expect(urgencyOf(241)).toBe("later");
  });

  it("refuses to offer an accept that would exceed the ceiling", () => {
    // "Accept with no sense of what is left is a decision made blind" — and
    // accepting past it answers 409 grant_ceiling_exceeded, so the button is
    // disabled rather than offered and refused.
    expect(canGrant(req({ guests: 2, seatsGrantable: 4 }))).toBe(true);
    expect(canGrant(req({ guests: 4, seatsGrantable: 4 }))).toBe(true);
    expect(canGrant(req({ guests: 5, seatsGrantable: 4 }))).toBe(false);
    // Missing means none, not unlimited.
    expect(canGrant(req({ guests: 1, seatsGrantable: undefined }))).toBe(false);
  });

  it("offers exactly the closed set of decline reasons the contract defines", () => {
    // The traveller reads a sentence derived from this code, so an invented
    // one produces a sentence nobody wrote.
    expect(DECLINE_REASONS.map((r) => r.code)).toEqual([
      "no_capacity",
      "weather",
      "not_operating",
      "party_too_large",
      "unsafe_for_party",
      "other",
    ]);
  });
});
