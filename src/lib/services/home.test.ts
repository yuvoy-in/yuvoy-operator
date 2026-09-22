import { describe, it, expect } from "vitest";
import {
  dayLine,
  listingGroup,
  listingLabel,
  liveWithNothingToSell,
  nextDeparture,
  orderListings,
  posterFor,
  requestsLine,
  seatsLine,
  withinFortnight,
} from "./home";
import type { OperatorSlot } from "@/lib/day/types";

/**
 * What the API actually sends for `sentBack`: an object, not a boolean.
 *
 * "Present while a reviewer has sent this listing back to you", carrying the
 * code, the note and when. Presence is the signal, and the fixture uses the
 * real shape so a reader cannot mistake it for a flag.
 */
const SENT_BACK = {
  rejectionCode: "unclear_description",
  rejectionNote: "Say what is included.",
  at: "2026-09-10T04:00:00Z",
};

function slot(over: Partial<OperatorSlot> = {}): OperatorSlot {
  return {
    id: "slot_1",
    title: "Dawn dive",
    startsAt: "2026-09-15T01:00:00Z",
    timezone: "Asia/Kolkata",
    seats: 8,
    sold: 6,
    remaining: 2,
    status: "open",
    ...over,
  };
}

describe("where a listing sits on Home", () => {
  it("puts a declined edit that still sells beside the live ones", () => {
    /*
      The subtlety `changes_rejected` carries: the same status means "your edit
      was declined and the live version still sells" and "this is back with
      you", and `sentBack` is what tells them apart. Putting both in the pile of
      things to fix would file a working listing as a problem.
    */
    expect(listingGroup({ status: "changes_rejected" })).toBe(1);
    expect(
      listingGroup({ status: "changes_rejected", sentBack: SENT_BACK }),
    ).toBe(2);
  });

  it("groups by whose move it is, not by the alphabet", () => {
    expect(listingGroup({ status: "live" })).toBe(1);
    expect(listingGroup({ status: "withdrawn" })).toBe(1);
    expect(listingGroup({ status: "draft" })).toBe(2);
    expect(listingGroup({ status: "in_review" })).toBe(3);
    // A state this build has never heard of goes last rather than first.
    expect(listingGroup({ status: "something_new" })).toBe(4);
  });

  it("sorts by group, then title", () => {
    const ordered = orderListings([
      { id: "c", title: "Zebra dive", status: "live" },
      { id: "a", title: "Night dive", status: "in_review" },
      { id: "b", title: "Anchor dive", status: "live" },
      { id: "d", title: "Draft dive", status: "draft" },
    ]);
    expect(ordered.map((l) => l.title)).toEqual([
      "Anchor dive",
      "Zebra dive",
      "Draft dive",
      "Night dive",
    ]);
  });
});

describe("what a listing's badge says", () => {
  it("splits a declined edit two ways", () => {
    expect(listingLabel({ status: "changes_rejected" })).toBe(
      "Changes declined",
    );
    expect(
      listingLabel({ status: "changes_rejected", sentBack: SENT_BACK }),
    ).toBe("Sent back");
  });

  it("calls a withdrawn listing Paused, in the operator's word", () => {
    expect(listingLabel({ status: "withdrawn" })).toBe("Paused");
    expect(listingLabel({ status: "live" })).toBe("Live");
    expect(listingLabel({ status: "in_review" })).toBe("In review");
  });
});

describe("a listing's next departure", () => {
  const now = Date.parse("2026-09-15T04:00:00Z");

  it("is the soonest OPEN one still to come, from the one read", () => {
    /*
      "Never one call per listing." A shop with nine listings would otherwise
      make nine slot requests on the screen an operator opens at six in the
      morning on one bar of signal.
    */
    const rows = [
      slot({
        id: "past",
        experienceId: "exp",
        startsAt: "2026-09-15T01:00:00Z",
      }),
      slot({
        id: "next",
        experienceId: "exp",
        startsAt: "2026-09-15T06:00:00Z",
      }),
      slot({
        id: "later",
        experienceId: "exp",
        startsAt: "2026-09-16T01:00:00Z",
      }),
    ];
    expect(nextDeparture(rows, "exp", now)?.id).toBe("next");
  });

  it("skips a closed or called-off one, which is not what 'next' means", () => {
    const rows = [
      slot({
        id: "closed",
        experienceId: "exp",
        status: "closed",
        startsAt: "2026-09-15T06:00:00Z",
      }),
      slot({
        id: "off",
        experienceId: "exp",
        status: "cancelled",
        startsAt: "2026-09-15T07:00:00Z",
      }),
      slot({
        id: "open",
        experienceId: "exp",
        startsAt: "2026-09-15T08:00:00Z",
      }),
    ];
    expect(nextDeparture(rows, "exp", now)?.id).toBe("open");
  });

  it("never borrows another listing's departure", () => {
    const rows = [
      slot({
        id: "theirs",
        experienceId: "other",
        startsAt: "2026-09-15T06:00:00Z",
      }),
    ];
    expect(nextDeparture(rows, "exp", now)).toBeNull();
  });
});

describe("the picture on a listing's tile", () => {
  it("prefers a live one, then the newest", () => {
    // `OperatorMedia` has no hero field yet, so this is the issue's rule and
    // not a guess about which picture is the cover.
    const media = [
      {
        listing: { experienceId: "exp" },
        posterUrl: "newest.jpg",
        situation: "processing",
      },
      {
        listing: { experienceId: "exp" },
        posterUrl: "live.jpg",
        situation: "live",
      },
    ];
    expect(posterFor(media, "exp")).toBe("live.jpg");
    expect(posterFor([media[0]], "exp")).toBe("newest.jpg");
  });

  it("is nothing rather than somebody else's boat", () => {
    expect(
      posterFor(
        [{ listing: { experienceId: "other" }, posterUrl: "x.jpg" }],
        "exp",
      ),
    ).toBeNull();
    // A row with no poster is not a picture. "An unpublished clip has no
    // public URL", and a broken image is worse than a blank tile.
    expect(posterFor([{ listing: { experienceId: "exp" } }], "exp")).toBeNull();
    // And media that predates the upload-time choice carries no listing at all.
    expect(posterFor([{ posterUrl: "x.jpg" }], "exp")).toBeNull();
  });
});

describe("the day's header and rows", () => {
  it("counts every departure and only the guests still going", () => {
    /*
      A called-off departure's seats were cancelled and refunded. Counting them
      would tell an operator to expect people who are not coming, which is the
      one arithmetic error on this screen that puts somebody on a jetty.
    */
    expect(
      dayLine("Today", [
        slot({ sold: 6 }),
        slot({ sold: 5 }),
        slot({ sold: 4, status: "cancelled" }),
      ]),
    ).toBe("Today · 3 departures · 11 guests");
  });

  it("does not say 1 departures or 1 guests", () => {
    expect(dayLine("Tomorrow", [slot({ sold: 1 })])).toBe(
      "Tomorrow · 1 departure · 1 guest",
    );
  });

  it("says what each row is, on its right", () => {
    expect(seatsLine(slot())).toBe("6/8");
    expect(seatsLine(slot({ status: "closed" }))).toBe("6/8 · Closed");
    // Never seats on a called-off departure: there is nothing to sell and
    // nobody on it.
    expect(seatsLine(slot({ status: "cancelled" }))).toBe("Called off");
  });
});

describe("the requests strip", () => {
  it("is not drawn at zero", () => {
    // A strip saying "0 requests waiting" is a line an operator reads every
    // morning and learns to skip.
    expect(requestsLine(0, 0)).toBeNull();
  });

  it("adds the urgent count only when there is one", () => {
    expect(requestsLine(5, 2)).toBe("5 requests waiting · 2 within the hour");
    expect(requestsLine(5, 0)).toBe("5 requests waiting");
    expect(requestsLine(1, 1)).toBe("1 request waiting · 1 within the hour");
  });
});

describe("the fortnight", () => {
  it("keeps the days it was asked for, read in the market's clock", () => {
    // 06:30 in Havelock is the evening before in UTC, and the operator reading
    // this is in Havelock.
    const rows = [
      slot({ id: "in", startsAt: "2026-09-15T01:00:00Z" }),
      slot({ id: "after", startsAt: "2026-10-01T01:00:00Z" }),
    ];
    expect(
      withinFortnight(rows, "2026-09-15", "2026-09-28").map((r) => r.id),
    ).toEqual(["in"]);
  });
});

describe("a live listing with nothing to sell: yuvoy-operator#95 item 3", () => {
  it("is a live listing the API says has no bookable dates", () => {
    expect(
      liveWithNothingToSell({ status: "live", bookableDatesNext30Days: 0 }),
    ).toBe(true);
    expect(
      liveWithNothingToSell({
        status: "live_changes_in_review",
        bookableDatesNext30Days: 0,
      }),
    ).toBe(true);
  });

  it("is not a listing that has dates", () => {
    expect(
      liveWithNothingToSell({ status: "live", bookableDatesNext30Days: 4 }),
    ).toBe(false);
  });

  it("is not a listing that is off the traveller app for another reason", () => {
    // `not_selling` reads 0 too, because of the account. "Live" would be false.
    for (const status of ["not_selling", "draft", "in_review", "withdrawn"]) {
      expect(
        liveWithNothingToSell({ status, bookableDatesNext30Days: 0 }),
      ).toBe(false);
    }
  });

  it("reads an absent count as unknown, never as zero", () => {
    expect(liveWithNothingToSell({ status: "live" })).toBe(false);
  });
});
