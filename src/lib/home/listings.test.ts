import { describe, expect, it } from "vitest";
import {
  isLive,
  listingsGlance,
  liveWithNoDates,
  neverPublished,
  toHomeListing,
  type HomeListing,
} from "./listings";

const listing = (over: Partial<HomeListing> = {}): HomeListing => ({
  id: "exp_1",
  title: "Dawn dive",
  status: "live",
  publicationState: "published",
  sentBack: false,
  ...over,
});

describe("a listing, as Home reads it", () => {
  it("keeps the counts the API sent, and leaves out the ones it did not", () => {
    const read = toHomeListing({
      id: "exp_1",
      title: "Dawn dive",
      status: "live",
      publicationState: "published",
      bookableDatesNext30Days: 0,
      departuresNotOnSale: 19,
      departuresGoingOffSaleSoon: 1,
      upcomingDepartures: 20,
    });
    expect(read).toEqual({
      id: "exp_1",
      title: "Dawn dive",
      status: "live",
      publicationState: "published",
      sentBack: false,
      bookableDatesNext30Days: 0,
      departuresNotOnSale: 19,
      departuresGoingOffSaleSoon: 1,
      upcomingDepartures: 20,
    });

    /*
      An older API that sends no count must not read as a listing with
      nothing to sell: absent is unknown, never zero.
    */
    const older = toHomeListing({ id: "exp_2", title: "Night dive" });
    expect(older).not.toHaveProperty("bookableDatesNext30Days");
    expect(liveWithNoDates({ ...older!, status: "live" })).toBe(false);
  });

  it("drops a row with nothing to point at, and names one with no title", () => {
    expect(toHomeListing({ title: "No id" })).toBeNull();
    expect(toHomeListing({ id: "exp_3", title: "  " })?.title).toBe(
      "Untitled listing",
    );
  });

  it("carries a sent-back note as the fact it is", () => {
    const read = toHomeListing({
      id: "exp_4",
      status: "changes_rejected",
      sentBack: {
        rejectionCode: "unclear_description",
        rejectionNote: "",
        at: "2026-09-10T04:00:00Z",
      },
    });
    expect(read?.sentBack).toBe(true);
  });
});

describe("where a listing stands", () => {
  it("is live on the traveller app with an edit in review too", () => {
    expect(isLive({ status: "live" })).toBe(true);
    expect(isLive({ status: "live_changes_in_review" })).toBe(true);
    expect(isLive({ status: "not_selling" })).toBe(false);
  });

  it("was never on sale as a draft, a first review, or one sent back", () => {
    expect(neverPublished(listing({ publicationState: "draft" }))).toBe(true);
    expect(neverPublished(listing({ publicationState: "in_review" }))).toBe(
      true,
    );
    expect(neverPublished(listing({ publicationState: "withdrawn" }))).toBe(
      false,
    );
    // Without the publication state, the status says it.
    const bare = { publicationState: undefined };
    expect(neverPublished(listing({ ...bare, status: "draft" }))).toBe(true);
    expect(
      neverPublished(
        listing({ ...bare, status: "changes_rejected", sentBack: true }),
      ),
    ).toBe(true);
    // A declined EDIT on a published listing still sells.
    expect(
      neverPublished(listing({ ...bare, status: "changes_rejected" })),
    ).toBe(false);
  });
});

describe("the listings at a glance", () => {
  it("counts every listing by where it is", () => {
    expect(
      listingsGlance([
        listing({ status: "live" }),
        listing({ status: "live_changes_in_review" }),
        // A declined edit on a published listing still sells.
        listing({ status: "changes_rejected" }),
        listing({ status: "withdrawn" }),
        listing({ status: "draft" }),
        listing({ status: "changes_rejected", sentBack: true }),
        listing({ status: "draft" }),
        listing({ status: "in_review" }),
      ]),
    ).toBe("3 live · 1 paused · 1 in review · 3 drafts");
  });

  it("says one draft in the singular, and never drops a state it does not know", () => {
    expect(
      listingsGlance([
        listing({ status: "draft" }),
        listing({ status: "something_new" }),
        listing({ status: "not_selling" }),
      ]),
    ).toBe("1 not selling · 1 draft · 1 other");
  });

  it("says so when there are none", () => {
    expect(listingsGlance([])).toBe("No listings yet");
  });
});
