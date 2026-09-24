import { describe, it, expect } from "vitest";
import {
  listingGroup,
  listingLabel,
  liveWithNothingToSell,
  orderListings,
  posterFor,
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
