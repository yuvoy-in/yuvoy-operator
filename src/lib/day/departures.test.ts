import { describe, expect, it } from "vitest";
import {
  MAX_DEPARTURES_PER_PRESS,
  MAX_RANGE_DAYS,
  countDepartures,
  departureCount,
  departureDates,
  departureProblem,
} from "./departures";

const TODAY = "2026-09-05"; // a Saturday, in the market

describe("departureDates", () => {
  it("is a single day when the range is one day", () => {
    expect(departureDates("2026-09-12", "2026-09-12")).toEqual(["2026-09-12"]);
  });

  it("is inclusive at both ends", () => {
    expect(departureDates("2026-09-12", "2026-09-14")).toEqual([
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
    ]);
  });

  it("filters to the weekdays asked for, with 0 as Sunday", () => {
    // 12 Sep 2026 is a Saturday. Saturdays only, over a fortnight.
    expect(departureDates("2026-09-12", "2026-09-26", [6])).toEqual([
      "2026-09-12",
      "2026-09-19",
      "2026-09-26",
    ]);
    // And Sunday is 0, not 7.
    expect(departureDates("2026-09-12", "2026-09-20", [0])).toEqual([
      "2026-09-13",
      "2026-09-20",
    ]);
  });

  it("treats an empty weekday list as every day", () => {
    expect(departureDates("2026-09-12", "2026-09-14", [])).toHaveLength(3);
  });

  /*
    The one worth having. These are calendar dates, not instants — the twelfth
    is the twelfth wherever the operator is standing. Built in local time, a
    phone west of UTC turns midnight on the twelfth into the eleventh and the
    weekday filter silently selects the wrong days.
  */
  it("does not depend on the device's timezone", () => {
    const tz = process.env.TZ;
    const run = () => departureDates("2026-09-12", "2026-09-26", [6]);
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14
    const east = run();
    process.env.TZ = "Pacific/Midway"; // UTC-11
    const west = run();
    process.env.TZ = tz;
    expect(east).toEqual(west);
    expect(east).toEqual(["2026-09-12", "2026-09-19", "2026-09-26"]);
  });

  it("is empty when the range runs backwards or is malformed", () => {
    expect(departureDates("2026-09-14", "2026-09-12")).toEqual([]);
    expect(departureDates("14/09/2026", "2026-09-12")).toEqual([]);
  });
});

describe("countDepartures", () => {
  it("multiplies days by times", () => {
    expect(
      countDepartures({
        fromDate: "2026-09-12",
        toDate: "2026-09-14",
        times: ["07:00", "14:00"],
      }),
    ).toBe(6);
  });

  it("defaults the last day to the first", () => {
    expect(countDepartures({ fromDate: "2026-09-12", times: ["07:00"] })).toBe(
      1,
    );
  });

  it("ignores a half-typed time rather than counting it", () => {
    // The preview updates on every keystroke, and "0" is a keystroke.
    expect(
      countDepartures({ fromDate: "2026-09-12", times: ["07:00", "0"] }),
    ).toBe(1);
  });
});

describe("departureProblem", () => {
  const ok = { fromDate: "2026-09-12", times: ["07:00"] };

  it("passes a plan worth sending", () => {
    expect(departureProblem(ok, TODAY)).toBeNull();
  });

  it("refuses a day that has gone", () => {
    expect(
      departureProblem({ ...ok, fromDate: "2026-09-04" }, TODAY)?.field,
    ).toBe("fromDate");
  });

  it("allows today itself", () => {
    // The market's today, not the phone's. A 4pm departure booked at 9am is
    // an ordinary thing to add.
    expect(departureProblem({ ...ok, fromDate: TODAY }, TODAY)).toBeNull();
  });

  it("refuses a range that runs backwards", () => {
    expect(
      departureProblem({ ...ok, toDate: "2026-09-11" }, TODAY)?.field,
    ).toBe("toDate");
  });

  it("refuses no times, and a time that is not one", () => {
    expect(departureProblem({ ...ok, times: [] }, TODAY)?.field).toBe("times");
    expect(departureProblem({ ...ok, times: ["7am"] }, TODAY)?.field).toBe(
      "times",
    );
    expect(departureProblem({ ...ok, times: ["25:00"] }, TODAY)?.field).toBe(
      "times",
    );
  });

  it("refuses the same time twice", () => {
    // Two departures at 07:00 on one day is not a thing, and the API would
    // create one and silently drop the other.
    expect(
      departureProblem({ ...ok, times: ["07:00", "07:00"] }, TODAY)?.message,
    ).toMatch(/twice/);
  });

  /*
    The refusal this module exists for. An operator meaning "next Saturday at
    seven" who leaves the last day at the end of the season asks for a
    departure every day — and Yuvoy sells a seat on every one.
  */
  it("refuses a range longer than a season", () => {
    const problem = departureProblem({ ...ok, toDate: "2027-09-12" }, TODAY);
    expect(problem?.field).toBe("toDate");
    expect(problem?.message).toContain(String(MAX_RANGE_DAYS));
  });

  it("refuses more departures than one press should make", () => {
    const problem = departureProblem(
      {
        fromDate: "2026-09-12",
        toDate: "2026-11-12", // 62 days
        times: ["06:00", "09:00", "12:00", "15:00"], // × 4 = 248
      },
      TODAY,
    );
    expect(problem?.message).toContain(String(MAX_DEPARTURES_PER_PRESS));
  });

  it("catches a weekday filter that matches nothing in the range", () => {
    /*
      "Every Saturday", over Monday to Friday. The API would answer
      `created: 0` — which is indistinguishable from "they already existed" —
      so the difference is caught here, where it can still be explained.
    */
    const problem = departureProblem(
      {
        fromDate: "2026-09-14", // Monday
        toDate: "2026-09-18", // Friday
        times: ["07:00"],
        weekdays: [6],
      },
      TODAY,
    );
    expect(problem?.field).toBe("weekdays");
    expect(problem?.message).toMatch(/nothing to add/);
  });

  it("does not pre-empt a rule the API owns", () => {
    // Dates that already have a departure at that time are the API's business
    // and `created: 0` is a legitimate answer. Nothing here guesses at it.
    expect(
      departureProblem(
        { fromDate: "2026-09-12", toDate: "2026-09-12", times: ["07:00"] },
        TODAY,
      ),
    ).toBeNull();
  });
});

describe("departureCount", () => {
  it("counts one thing singular", () => {
    expect(departureCount(1)).toBe("1 departure");
    expect(departureCount(0)).toBe("0 departures");
    expect(departureCount(14)).toBe("14 departures");
  });
});
