import { describe, it, expect } from "vitest";
import { toSettings } from "./notifications";

/**
 * The notification switches as the API sends them: yuvoy-operator#94 item 3.
 *
 * `NotificationGroup` gained `seat_confirmations` at yuvoy-api e7291e3: once a
 * day, the departures off sale, or going off sale within a day, because nobody
 * confirmed their seats. On by default. The screens draw exactly the switches
 * the API sends, in its order and in its words, so the new one appears where
 * the API puts it; and an older API that does not send it gets no row, rather
 * than a switch that pretends to be off.
 */

const API_AT_E7291E3 = {
  userId: "usr_1",
  name: "Priya Raut",
  switches: [
    {
      group: "new_bookings",
      label: "New bookings, requests and messages",
      description: "Sent to everybody at the business.",
      on: true,
    },
    {
      group: "todays_departures",
      label: "Today's departures",
      description: "At 06:00 on a day with booked departures.",
      on: true,
    },
    {
      group: "seat_confirmations",
      label: "Seats to confirm",
      description:
        "Once a day, the departures that are off sale, or will be within a day, because nobody has confirmed their seats. Sent to the owner, admins and managers.",
      on: true,
    },
    {
      group: "settlement_summary",
      label: "Settlement summary",
      description: "A payout has been sent to your bank.",
      on: true,
    },
  ],
  alwaysSent: "Some messages have no switch.",
};

describe("the seat confirmations switch", () => {
  it("is drawn where the API puts it, in the API's words", () => {
    const settings = toSettings(API_AT_E7291E3);
    expect(settings.switches.map((s) => s.group)).toEqual([
      "new_bookings",
      "todays_departures",
      "seat_confirmations",
      "settlement_summary",
    ]);
    const seats = settings.switches.find(
      (s) => s.group === "seat_confirmations",
    );
    expect(seats).toEqual({
      group: "seat_confirmations",
      label: "Seats to confirm",
      description:
        "Once a day, the departures that are off sale, or will be within a day, because nobody has confirmed their seats. Sent to the owner, admins and managers.",
      on: true,
    });
  });

  it("is on when the API leaves `on` out, because nobody has turned it off", () => {
    const settings = toSettings({
      ...API_AT_E7291E3,
      switches: [{ group: "seat_confirmations", label: "Seats to confirm" }],
    });
    expect(settings.switches[0].on).toBe(true);
  });

  it("is off only when the API says off", () => {
    const settings = toSettings({
      ...API_AT_E7291E3,
      switches: [
        { group: "seat_confirmations", label: "Seats to confirm", on: false },
      ],
    });
    expect(settings.switches[0].on).toBe(false);
  });

  it("gets no row at all from an older API that does not send it", () => {
    /*
      A row the API did not send would need an on or off this screen does not
      have. Drawn off, it tells somebody they silenced a message they never
      touched; drawn on, it promises an email the older service never sends.
      So it is not drawn, and the screen is exactly as it was.
    */
    const older = {
      ...API_AT_E7291E3,
      switches: API_AT_E7291E3.switches.filter(
        (s) => s.group !== "seat_confirmations",
      ),
    };
    const settings = toSettings(older);
    expect(settings.switches.map((s) => s.group)).toEqual([
      "new_bookings",
      "todays_departures",
      "settlement_summary",
    ]);
    expect(
      settings.switches.some((s) => s.group === "seat_confirmations"),
    ).toBe(false);
  });
});
