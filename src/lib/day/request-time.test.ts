import { describe, it, expect } from "vitest";
import { requestAge, requestWhen } from "./request-time";

/** 09:30 IST on 11 September 2026. */
const AT = Date.parse("2026-09-11T04:00:00Z");

describe("how long ago they asked — yuvoy-operator#43", () => {
  it("says it in the units a glance can take", () => {
    expect(requestAge("2026-09-11T03:59:30Z", AT)).toBe("asked just now");
    expect(requestAge("2026-09-11T03:48:00Z", AT)).toBe("asked 12 min ago");
    expect(requestAge("2026-09-11T01:00:00Z", AT)).toBe("asked 3 h ago");
    expect(requestAge("2026-09-09T04:00:00Z", AT)).toBe("asked 2 d ago");
  });

  it("says nothing about a time it cannot read, and never a negative age", () => {
    expect(requestAge(undefined, AT)).toBeNull();
    expect(requestAge("soon", AT)).toBeNull();
    // A request stamped a minute ahead of our clock was not asked in the future.
    expect(requestAge("2026-09-11T04:01:00Z", AT)).toBe("asked just now");
  });
});

describe("when the trip is", () => {
  it("names the day in words and the time in the market's zone", () => {
    expect(
      requestWhen(
        {
          startsAt: "2026-09-12T03:30:00Z",
          timezone: "Asia/Kolkata",
          requestedAt: "2026-09-11T03:48:00Z",
        },
        AT,
        "2026-09-11",
        "2026-09-12",
      ),
    ).toBe("Tomorrow at 09:00 · asked 12 min ago");
  });

  it("puts a 05:00 boat on its own morning, not the evening before", () => {
    expect(
      requestWhen(
        { startsAt: "2026-09-11T23:30:00Z", timezone: "Asia/Kolkata" },
        AT,
        "2026-09-11",
        "2026-09-12",
      ),
    ).toBe("Tomorrow at 05:00");
  });

  it("says nothing at all when it has nothing to go on", () => {
    expect(requestWhen({}, AT, "2026-09-11", "2026-09-12")).toBeNull();
  });
});
