import { describe, expect, it } from "vitest";
import type { OpenRequest } from "./request-types";
import { declineSentence } from "./request-types";
import { requestView } from "./request-view";

const AT = Date.parse("2026-09-22T00:30:00Z"); // 06:00 on Tue 22 Sep in the market
const DAYS = { at: AT, today: "2026-09-22", tomorrow: "2026-09-23" };

function request(over: Partial<OpenRequest> = {}): OpenRequest {
  return {
    id: "req_1",
    experience: "Snorkel trip",
    guests: 3,
    startsAt: "2026-09-23T03:30:00Z", // 09:00 tomorrow
    timezone: "Asia/Kolkata",
    requestedAt: "2026-09-21T22:30:00Z", // 04:00, two hours before AT
    expiresAt: "2026-09-22T01:50:00Z", // 07:20
    contactName: "Reuben Mathai",
    seatsGrantable: 6,
    minutesToAnswer: 80,
    ...over,
  };
}

/*
  One card for Home and Bookings (audit 5.3, 5.13): who first, the trip, the
  two clocks in one phrasing, and what is left to give.
*/
describe("a request, as its card says it", () => {
  it("leads with the traveller and the party, then the trip", () => {
    expect(requestView(request(), DAYS)).toMatchObject({
      id: "req_1",
      name: "Reuben Mathai",
      firstName: "Reuben",
      title: "Reuben Mathai, 3 people",
      trip: "Snorkel trip · Tomorrow at 09:00",
      seats: "6 seats you can still give",
      short: false,
      preset: null,
    });
  });

  it("says the clock one way: the countdown, and the time it runs out", () => {
    const view = requestView(request(), DAYS);
    expect(view.clock).toBe("1h 20m left");
    expect(view.asked).toBe("Asked 2 h ago · Answer by 07:20");
    expect(view.urgent).toBe(false);
    expect(requestView(request({ minutesToAnswer: 24 }), DAYS).urgent).toBe(
      true,
    );
  });

  it("puts the day on a deadline that is not today's", () => {
    expect(
      requestView(request({ expiresAt: "2026-09-23T02:30:00Z" }), DAYS).asked,
    ).toBe("Asked 2 h ago · Answer by 08:00 on Wed 23 Sep");
  });

  it("says no deadline once there is no time left, and never a clock in the past", () => {
    const view = requestView(request({ minutesToAnswer: 0 }), DAYS);
    expect(view.clock).toBe("Out of time");
    expect(view.asked).toBe("Asked 2 h ago");
  });

  it("says before the tap when the party will not fit, and opens Decline on why", () => {
    expect(
      requestView(request({ guests: 5, seatsGrantable: 3 }), DAYS),
    ).toMatchObject({
      seats: "Only 3 seats left: not enough for this party",
      short: true,
      preset: "party_too_large",
    });
    expect(
      requestView(request({ guests: 2, seatsGrantable: 0 }), DAYS).preset,
    ).toBe("no_capacity");
    // A party that exactly fills what is left can be accepted (`canGrant`).
    expect(
      requestView(request({ guests: 4, seatsGrantable: 4 }), DAYS).short,
    ).toBe(false);
  });

  it("speaks in the singular, and names somebody the API did not", () => {
    expect(
      requestView(request({ guests: 1, seatsGrantable: 1 }), DAYS),
    ).toMatchObject({
      title: "Reuben Mathai, 1 person",
      seats: "1 seat you can still give",
    });
    expect(requestView(request({ contactName: "  " }), DAYS)).toMatchObject({
      name: "The traveller",
      title: "The traveller, 3 people",
    });
  });

  it("names today's departure as today", () => {
    expect(
      requestView(request({ startsAt: "2026-09-22T18:00:00Z" }), DAYS).trip,
    ).toBe("Snorkel trip · Today at 23:30");
  });

  /*
    The card sets the host's name for the experience in the host's voice and
    the time on our clock (v3.2), so it needs the halves, and it must know
    when the name is ours ("A departure") rather than theirs.
  */
  it("gives the trip's two halves, and never passes our stand-in off as theirs", () => {
    expect(requestView(request(), DAYS)).toMatchObject({
      experience: "Snorkel trip",
      when: "Tomorrow at 09:00",
    });
    const nameless = requestView(request({ experience: "  " }), DAYS);
    expect(nameless.experience).toBeNull();
    expect(nameless.trip).toBe("A departure · Tomorrow at 09:00");
    const undated = requestView(request({ startsAt: undefined }), DAYS);
    expect(undated.when).toBe("");
    expect(undated.trip).toBe("Snorkel trip");
  });
});

/*
  The preview the operator reads before declining is the API's own sentence
  (internal/booking/decline.go); `pnpm contract:check` holds the mirror to it.
*/
describe("what a declined traveller reads", () => {
  it("is the API's sentence for each reason, always saying nothing was charged", () => {
    expect(declineSentence("no_capacity")).toBe(
      "The operator is full on that departure. Nothing was charged.",
    );
    expect(declineSentence("weather")).toBe(
      "The operator isn't running that date because of the conditions. Nothing was charged.",
    );
    expect(declineSentence("party_too_large")).toBe(
      "The operator can't take a group that size on this one. Nothing was charged.",
    );
  });

  it("is the API's vague sentence for 'other' and for any code it does not know", () => {
    expect(declineSentence("other")).toBe(
      "The operator couldn't take this one. Nothing was charged.",
    );
    expect(declineSentence("a_new_code")).toBe(
      "The operator couldn't take this one. Nothing was charged.",
    );
  });
});
