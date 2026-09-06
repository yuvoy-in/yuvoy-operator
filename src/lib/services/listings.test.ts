import { describe, expect, it } from "vitest";
import {
  describeRejection,
  describeStatus,
  listingsWithoutFootage,
  orderListings,
  type OperatorExperience,
} from "./listings";

const listing = (
  over: Partial<OperatorExperience> = {},
): OperatorExperience => ({
  id: "exp_1",
  title: "Reef dive",
  status: "live",
  ...over,
});

describe("what a status says", () => {
  it("never says a listing is on sale when it is not", () => {
    /*
      The claim that costs an operator a season. "An operator who submits and
      sees 'Saved' will assume they are selling, and will ring us on the day
      nobody books."
    */
    for (const status of [
      "draft",
      "in_review",
      "changes_rejected",
      "withdrawn",
    ]) {
      expect(describeStatus(status).selling, status).toBe(false);
    }
  });

  it("keeps a listing selling while an edit is with us", () => {
    /*
      The state the contract calls out because "the obvious assumption is the
      opposite": an edit under review does NOT take a live listing off sale.
      A screen that read this as off-sale would tell an operator to stop
      taking bookings they are still taking.
    */
    const s = describeStatus("live_changes_in_review");
    expect(s.selling).toBe(true);
    expect(s.body).toMatch(/still on sale/i);
    // And there is nothing to send while we hold one.
    expect(s.canSubmit).toBe(false);
  });

  it("offers no submit while we already have it", () => {
    expect(describeStatus("in_review").canSubmit).toBe(false);
    expect(describeStatus("draft").canSubmit).toBe(true);
    expect(describeStatus("changes_rejected").canSubmit).toBe(true);
  });

  it("claims nothing about a status it has never met", () => {
    /*
      Not a fallback to "draft" or to "live". Telling an operator a listing is
      on sale when this build cannot tell is the one direction to avoid — the
      same rule an unrecognised role follows on the team screen.
    */
    const s = describeStatus("archived_pending_appeal");
    expect(s.label).toBe("archived_pending_appeal");
    expect(s.selling).toBe(false);
    expect(s.canSubmit).toBe(false);
    expect(s.body).toMatch(/cannot describe/i);
  });

  it("says nothing at all for a missing status", () => {
    expect(describeStatus(undefined).selling).toBe(false);
  });
});

describe("why we came back", () => {
  it("renders the closed set rather than paraphrasing it", () => {
    expect(describeRejection("meeting_point_unclear")).toMatch(
      /meeting point/i,
    );
    expect(describeRejection("unsafe_claim")).toMatch(/safety/i);
  });

  it("returns null for a code it does not know, so the note can speak", () => {
    // The row falls back to the API's own note. A guess here would put words
    // in a reviewer's mouth about somebody's listing.
    expect(describeRejection("brand_new_code")).toBeNull();
    expect(describeRejection(undefined)).toBeNull();
  });
});

describe("the order they read in", () => {
  it("puts what we are waiting on them for first", () => {
    const ordered = orderListings([
      listing({ id: "a", title: "Alpha", status: "in_review" }),
      listing({ id: "b", title: "Bravo", status: "live" }),
      listing({ id: "c", title: "Charlie", status: "changes_rejected" }),
      listing({ id: "d", title: "Delta", status: "draft" }),
    ]);
    expect(ordered.map((l) => l.id)).toEqual(["c", "d", "b", "a"]);
  });

  it("breaks a tie by title, so the list does not shuffle between loads", () => {
    const ordered = orderListings([
      listing({ id: "z", title: "Zulu", status: "live" }),
      listing({ id: "a", title: "Alpha", status: "live" }),
    ]);
    expect(ordered.map((l) => l.id)).toEqual(["a", "z"]);
  });

  it("does not mutate what it was given", () => {
    const input = [
      listing({ id: "a", status: "in_review" }),
      listing({ id: "b", status: "draft" }),
    ];
    orderListings(input);
    expect(input.map((l) => l.id)).toEqual(["a", "b"]);
  });
});

describe("which activities have no video", () => {
  it("names a selling listing with nothing attached", () => {
    /*
      The defect this answers is visible to travellers: `yuvoy.in` rendered two
      real listings as BLACK CARDS because no clip had ever been attached to
      one. The operator had no screen that could say so.
    */
    const blank = listingsWithoutFootage(
      [
        listing({ id: "a", status: "live" }),
        listing({ id: "b", status: "live" }),
      ],
      new Set(["b"]),
    );
    expect(blank.map((l) => l.id)).toEqual(["a"]);
  });

  it("says nothing about a draft, because a draft sells nothing", () => {
    // Flagging every unfinished listing would train an operator to ignore the
    // one row that matters.
    const blank = listingsWithoutFootage(
      [
        listing({ id: "d", status: "draft" }),
        listing({ id: "r", status: "in_review" }),
        listing({ id: "w", status: "withdrawn" }),
      ],
      new Set(),
    );
    expect(blank).toEqual([]);
  });

  it("counts a listing selling with an edit in review", () => {
    // It is on sale, so a traveller is seeing its card right now.
    const blank = listingsWithoutFootage(
      [listing({ id: "e", status: "live_changes_in_review" })],
      new Set(),
    );
    expect(blank.map((l) => l.id)).toEqual(["e"]);
  });

  it("flags every live listing for an operator with no clips at all", () => {
    // The state every operator starts in, and the reason their cards are
    // blank on the traveller app.
    const blank = listingsWithoutFootage(
      [listing({ id: "a" }), listing({ id: "b" })],
      new Set(),
    );
    expect(blank).toHaveLength(2);
  });
});
