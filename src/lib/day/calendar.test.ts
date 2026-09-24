import { describe, it, expect } from "vitest";
import type { BookingLine } from "@/lib/money/bookings";
import type { OperatorSlot } from "./types";
import {
  CLOSING_SENTENCE,
  alreadyConfirmedSentence,
  apiWindow,
  calendarDays,
  confirmedGuestsByDay,
  daySummary,
  departuresOn,
  inMarketDays,
  everyDepartureClosed,
  soldOn,
  startTimeCount,
} from "./calendar";

const slot = (over: Partial<OperatorSlot> = {}): OperatorSlot => ({
  id: "slot_1",
  title: "Try-dive at Nemo Reef",
  startsAt: "2026-09-11T03:30:00Z",
  timezone: "Asia/Kolkata",
  seats: 8,
  sold: 0,
  remaining: 8,
  status: "open",
  ...over,
});

const line = (over: Partial<BookingLine> = {}): BookingLine => ({
  id: "bkg_1",
  reference: "YV-4K2M9P7Q",
  name: "Asha Menon",
  guests: 2,
  experience: "Try-dive at Nemo Reef",
  startsAt: "2026-09-11T03:30:00Z",
  timezone: "Asia/Kolkata",
  state: "confirmed",
  ...over,
});

/** 05:00 IST on 11 September is 23:30 UTC on the 10th. */
const DAWN_ON_THE_11TH = "2026-09-10T23:30:00Z";
const DAWN_ON_THE_12TH = "2026-09-11T23:30:00Z";

describe("the fourteen days — yuvoy-operator#45", () => {
  it("is today and the next thirteen, across a month end", () => {
    const days = calendarDays("2026-09-25");
    expect(days).toHaveLength(14);
    expect(days[0]).toBe("2026-09-25");
    expect(days[13]).toBe("2026-10-08");
  });
});

describe("a day's boats, whatever the hour they leave", () => {
  it("asks the API for a day either side, because it reads dates as UTC days", () => {
    expect(apiWindow("2026-09-11", "2026-09-24")).toEqual({
      from: "2026-09-10",
      to: "2026-09-25",
    });
  });

  it("puts a 05:00 departure on its own morning, not the evening before", () => {
    const early = slot({ id: "early", startsAt: DAWN_ON_THE_11TH });
    const next = slot({ id: "next", startsAt: DAWN_ON_THE_12TH });
    expect(
      inMarketDays([early, next], "2026-09-11", "2026-09-11").map((s) => s.id),
    ).toEqual(["early"]);
    expect(departuresOn([early, next], "2026-09-12").map((s) => s.id)).toEqual([
      "next",
    ]);
  });

  it("places nothing it cannot read", () => {
    expect(
      inMarketDays([slot({ startsAt: "" })], "2026-09-11", "2026-09-11"),
    ).toEqual([]);
  });
});

describe("what a day says about itself", () => {
  it("counts start times, not departures, and not a boat that was called off", () => {
    const day = [
      slot({ id: "a", startsAt: "2026-09-11T03:30:00Z" }), // 09:00
      slot({ id: "b", startsAt: "2026-09-11T03:30:00Z" }), // 09:00, another listing
      slot({ id: "c", startsAt: "2026-09-11T08:30:00Z" }), // 14:00
      slot({ id: "d", startsAt: "2026-09-11T11:30:00Z", status: "cancelled" }),
    ];
    expect(startTimeCount(day)).toBe(2);
  });

  it("adds up what is sold on the boats still running", () => {
    expect(
      soldOn([
        slot({ sold: 5 }),
        slot({ sold: 2 }),
        slot({ sold: 4, status: "cancelled" }),
      ]),
    ).toBe(7);
  });

  it("says every running departure is closed, which is not the same as the day being closed", () => {
    /*
      Renamed in #45, because the name was the bug. "Closed" on the day row now
      comes from `GET /blackouts`: a day with NO departures can be closed, and
      this rule could never see it, so a fortnight closed in January showed
      fourteen ordinary empty days. It also could never say why.
    */
    expect(everyDepartureClosed([slot({ status: "closed" })])).toBe(true);
    expect(
      everyDepartureClosed([
        slot({ status: "closed" }),
        slot({ status: "open" }),
      ]),
    ).toBe(false);
    // A call-off is its own act, and an empty day is not a closed one.
    expect(
      everyDepartureClosed([
        slot({ status: "closed" }),
        slot({ status: "cancelled" }),
      ]),
    ).toBe(true);
    expect(everyDepartureClosed([slot({ status: "cancelled" })])).toBe(false);
    expect(everyDepartureClosed([])).toBe(false);
  });
});

describe("who is already confirmed on a day", () => {
  const days = ["2026-09-11", "2026-09-12"];

  it("counts the promises already made, on the market's day", () => {
    const counts = confirmedGuestsByDay(
      [
        line({ guests: 2, startsAt: DAWN_ON_THE_11TH }),
        // Paying at the counter is still a promise made.
        line({ guests: 3, state: "paid_pending_ops" }),
        // Not yet a promise, and not one any more.
        line({ guests: 5, state: "pending_request" }),
        line({ guests: 1, state: "declined" }),
      ],
      days,
    );
    expect(counts?.get("2026-09-11")).toBe(5);
    expect(counts?.get("2026-09-12")).toBe(0);
  });

  it("will not give a number it cannot stand behind, and now only for that reason", () => {
    /*
      `null` is a FAILED READ and nothing else. It used to mean that too, and
      also "a hundred rows came back and may have been cut short" — which threw
      the count away exactly when an operator had most bookings to lose by
      closing the day. `listBookings` pages until the API says `complete`, so a
      hundred rows is a hundred bookings (yuvoy-operator#45 item 3).
    */
    expect(confirmedGuestsByDay(null, days)).toBeNull();

    const hundred = Array.from({ length: 100 }, (_, i) =>
      line({ id: `b${i}`, guests: 1, startsAt: DAWN_ON_THE_11TH }),
    );
    expect(confirmedGuestsByDay(hundred, days)?.get("2026-09-11")).toBe(100);
  });

  it("says both of the issue's sentences word for word", () => {
    expect(CLOSING_SENTENCE).toBe(
      "Closing stops new bookings straight away. Bookings you've already confirmed stay live. Resolve those one by one in Bookings.",
    );
    expect(alreadyConfirmedSentence(4)).toBe(
      "4 guests are already confirmed. Closing won't move them. Resolve each booking in Bookings.",
    );
    expect(alreadyConfirmedSentence(1)).toBe(
      "1 guest is already confirmed. Closing won't move them. Resolve each booking in Bookings.",
    );
  });
});

describe("what a day's row says", () => {
  const at = (over: Partial<OperatorSlot>): OperatorSlot => ({
    id: "s",
    title: "Reef dive",
    startsAt: "2026-09-27T03:30:00Z",
    timezone: "Asia/Kolkata",
    seats: 8,
    sold: 3,
    remaining: 5,
    status: "open",
    ...over,
  });

  it("counts start times and what is sold", () => {
    expect(
      daySummary([
        at({ id: "a" }),
        at({ id: "b", startsAt: "2026-09-27T08:30:00Z", sold: 2 }),
      ]),
    ).toBe("2 start times · 5 sold");
  });

  it("says a day whose every departure was called off was called off", () => {
    // It read "0 start times · 0 sold" (the audit before release, O9).
    expect(daySummary([at({ status: "cancelled" })])).toBe(
      "1 departure called off",
    );
    expect(
      daySummary([
        at({ id: "a", status: "cancelled" }),
        at({ id: "b", status: "cancelled", startsAt: "2026-09-27T08:30:00Z" }),
      ]),
    ).toBe("2 departures called off");
  });

  it("says an empty day is empty", () => {
    expect(daySummary([])).toBe("No departures scheduled");
  });
});
