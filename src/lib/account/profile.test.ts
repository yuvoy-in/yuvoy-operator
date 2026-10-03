import { describe, it, expect } from "vitest";
import {
  businessName,
  orderForProfile,
  orderMedia,
  profileGroup,
  ratingLine,
  readTab,
  reviewSummaryLine,
  reviewerName,
  sinceLine,
  situationBadge,
  tagLine,
  tileFacts,
} from "./profile";

describe("which tab the URL asks for", () => {
  it("defaults rather than refusing an unknown one", () => {
    // It arrives in a URL somebody may have edited or a link somebody kept, and
    // a 404 for a typo in a query string is worse than the default tab.
    expect(readTab("reels")).toBe("reels");
    expect(readTab("reviews")).toBe("reviews");
    expect(readTab("photos")).toBe("listings");
    expect(readTab(undefined)).toBe("listings");
  });
});

describe("what the profile is called", () => {
  it("prefers the name travellers see, then the legal one", () => {
    expect(
      businessName({ displayName: "Reef Divers", legalName: "RD LLP" }),
    ).toBe("Reef Divers");
    expect(businessName({ displayName: "  ", legalName: "RD LLP" })).toBe(
      "RD LLP",
    );
  });

  it("is never blank, because a heading-less profile reads as a failure", () => {
    expect(businessName({})).toBe("Your business");
    expect(businessName(null)).toBe("Your business");
  });
});

describe("the line under the numbers", () => {
  it("joins what is there and leaves out what is not", () => {
    expect(sinceLine(2014, ["English", "Hindi"])).toBe(
      "since 2014 · English, Hindi",
    );
    expect(sinceLine(2014, [])).toBe("since 2014");
    expect(sinceLine(undefined, ["English"])).toBe("English");
  });

  it("is nothing at all when neither half is there", () => {
    // Rather than a stray separator, or "since" with nothing after it.
    expect(sinceLine(undefined, undefined)).toBeNull();
    expect(sinceLine(undefined, ["  "])).toBeNull();
  });
});

describe("the rating", () => {
  it("is a 0 over the word Reviews when there are none, like the others", () => {
    /*
      yuvoy-operator#86 s9: "'No reviews yet' sits where a number belongs ...
      Show '0' with the word Reviews under it, exactly like the others." A
      count of reviews, never a score: "0.0 ★" would say travellers scored
      them nothing, which is a different and much worse claim.
    */
    expect(ratingLine({ average: null, count: 0 })).toEqual({
      value: "0",
      label: "Reviews",
    });
    expect(ratingLine({ average: null, count: 0 })?.value).not.toContain("★");
  });

  it("carries the count under the average", () => {
    expect(ratingLine({ average: 4.8, count: 37 })).toEqual({
      value: "4.8 ★",
      label: "37 reviews",
    });
    expect(ratingLine({ average: 5, count: 1 })).toEqual({
      value: "5 ★",
      label: "1 review",
    });
  });

  it("draws no average it was not given, only the count", () => {
    // The contract has the average null only at a count of 0; a response that
    // disagrees with itself still gets no invented score.
    expect(ratingLine({ average: null, count: 3 })).toEqual({
      value: "3",
      label: "Reviews",
    });
  });

  it("draws nothing when the response did not say, rather than a 0", () => {
    // A zero nobody measured is worse than a gap in the row.
    expect(ratingLine(undefined)).toBeNull();
    expect(ratingLine({ average: 4.2 })).toBeNull();
  });
});

describe("the order the Listings grid uses", () => {
  it("is NOT Home's order, and the difference is what each screen is for", () => {
    /*
      Home is the working day, so what is selling comes first. This is where
      listings are made and mended, so what is waiting on the operator leads and
      what is quietly selling comes last.
    */
    expect(profileGroup({ status: "changes_rejected" })).toBe(1);
    expect(profileGroup({ status: "in_review" })).toBe(2);
    expect(profileGroup({ status: "draft" })).toBe(3);
    expect(profileGroup({ status: "live" })).toBe(4);
    expect(profileGroup({ status: "withdrawn" })).toBe(5);
    expect(profileGroup({ status: "something_new" })).toBe(6);
  });

  it("sorts by group, then title", () => {
    expect(
      orderForProfile([
        { title: "Zebra", status: "live" },
        { title: "Anchor", status: "live" },
        { title: "Sent back", status: "changes_rejected" },
      ]).map((l) => l.title),
    ).toEqual(["Sent back", "Anchor", "Zebra"]);
  });
});

/*
  Operator A, approved 3 Oct 2026: "Listings come first, each with its state,
  and a draft says in words what is still missing."
*/
describe("what a listing's tile says", () => {
  it("gives a live listing its state, quietly, and its price", () => {
    expect(
      tileFacts({
        status: "live",
        publicationState: "published",
        unitPricePaise: 450_000,
        pricingUnit: "per_person",
        publishBlockers: [],
        bookableDatesNext30Days: 12,
      }),
    ).toEqual({ state: "Live", attention: false, line: "₹4,500 per person" });
  });

  it("says a group price is for the group", () => {
    expect(
      tileFacts({
        status: "live",
        unitPricePaise: 1_200_000,
        pricingUnit: "per_group",
      }).line,
    ).toBe("₹12,000 for the group");
  });

  it("never prints a basis nobody stated", () => {
    // `pricingUnit` is NOT NULL, so the value is there whether or not anybody
    // chose it: the blocker is the answer, and the figure stands alone.
    expect(
      tileFacts({
        status: "live",
        unitPricePaise: 1_200_000,
        pricingUnit: "per_person",
        publishBlockers: ["pricingUnit"],
      }).line,
    ).toBe("₹12,000");
  });

  it("names a live listing with nothing to sell, and asks for attention", () => {
    expect(
      tileFacts({
        status: "live",
        unitPricePaise: 400_000,
        pricingUnit: "per_person",
        bookableDatesNext30Days: 0,
      }),
    ).toEqual({
      state: "No dates in 30 days",
      attention: true,
      line: "₹4,000 per person",
    });
  });

  it("says in words everything a draft is still missing", () => {
    expect(
      tileFacts({
        status: "draft",
        publicationState: "draft",
        publishBlockers: [
          "summary",
          "activityType",
          "unitPricePaise",
          "pricingUnit",
        ],
        sellable: false,
      }),
    ).toEqual({
      state: "Draft",
      attention: true,
      line: "Still missing: a short summary, what kind of activity it is, a price, whether that price is per person or for the group",
    });
  });

  it("says a draft with nothing missing is ready to send", () => {
    expect(
      tileFacts({
        status: "draft",
        publicationState: "draft",
        publishBlockers: [],
      }).line,
    ).toBe("Ready to send for review");
  });

  it("claims neither when an older API sent no list", () => {
    expect(tileFacts({ status: "draft" }).line).toBeNull();
    // `sellable` is the one thing it can still say.
    expect(tileFacts({ status: "draft", sellable: false }).line).toBe(
      "Still missing: a price",
    );
  });

  it("says why a first listing was sent back, in the closed set's words", () => {
    expect(
      tileFacts({
        status: "changes_rejected",
        publicationState: "draft",
        unitPricePaise: 340_000,
        sentBack: {
          rejectionCode: "meeting_point_unclear",
          rejectionNote: "Which jetty gate?",
        },
      }),
    ).toEqual({
      state: "Sent back",
      attention: true,
      line: "A traveller could not find the meeting point from this.",
    });
  });

  it("falls back to the reviewer's own note, long dashes out", () => {
    expect(
      tileFacts({
        status: "changes_rejected",
        sentBack: {
          rejectionCode: "a_code_this_build_never_met",
          rejectionNote: " Which gate \u2014 the north one? ",
        },
      }).line,
    ).toBe("Which gate. The north one?");
    expect(
      tileFacts({ status: "changes_rejected", sentBack: { rejectionNote: "" } })
        .line,
    ).toBeNull();
  });

  it("keeps the price on a listing whose edit was declined: it still sells", () => {
    expect(
      tileFacts({
        status: "changes_rejected",
        publicationState: "published",
        unitPricePaise: 220_000,
        pricingUnit: "per_person",
      }),
    ).toEqual({
      state: "Changes declined",
      attention: true,
      line: "₹2,200 per person",
    });
  });

  it("says nothing more about a listing that is with us", () => {
    expect(
      tileFacts({
        status: "in_review",
        publicationState: "in_review",
        unitPricePaise: 300_000,
        publishBlockers: [],
      }),
    ).toEqual({ state: "In review", attention: false, line: null });
  });

  it("asks for attention on a listing that is not selling, and not on a paused one", () => {
    expect(tileFacts({ status: "not_selling" }).attention).toBe(true);
    expect(tileFacts({ status: "withdrawn", unitPricePaise: 110_000 })).toEqual(
      {
        state: "Paused",
        attention: false,
        line: "₹1,100",
      },
    );
  });
});

describe("a media tile's badge", () => {
  it("comes from `situation`, which the server computes", () => {
    /*
      "Deriving the situation from two enumerations client side gets it wrong in
      ways nobody notices for a month." A wrong badge is an operator waiting for
      something that already happened.
    */
    expect(situationBadge("changes_needed")).toBe("Changes needed");
    expect(situationBadge("waiting_on_listing")).toBe("Waiting on the listing");
    expect(situationBadge("withdrawn")).toBe("Taken down");
  });

  it("is nothing for a value this build has never heard of", () => {
    // No badge rather than the raw value: a word nobody wrote is worse on a
    // tile than no word at all.
    expect(situationBadge("teleported")).toBeNull();
    expect(situationBadge(undefined)).toBeNull();
  });

  it("puts what needs answering first, and keeps API order after that", () => {
    expect(
      orderMedia([
        { situation: "live" },
        { situation: "needs_rights" },
        { situation: "changes_needed" },
        { situation: "processing" },
      ]).map((m) => m.situation),
    ).toEqual(["changes_needed", "needs_rights", "live", "processing"]);
  });
});

describe("the reviews summary", () => {
  it("does not say 1 reviews", () => {
    expect(reviewSummaryLine({ averageRating: 5, count: 1 })).toBe(
      "5 ★ · 1 review",
    );
    expect(reviewSummaryLine({ averageRating: 4.8, count: 37 })).toBe(
      "4.8 ★ · 37 reviews",
    );
  });

  it("says there are none rather than printing a null average", () => {
    expect(reviewSummaryLine({ averageRating: null, count: 0 })).toBe(
      "No reviews yet",
    );
  });

  it("lists the tags travellers chose, highest first", () => {
    expect(
      tagLine({
        guide: 21,
        safety: 18,
        value: 9,
        organisation: 0,
        punctuality: 0,
        equipment: 0,
      }),
    ).toBe("Guide 21 · Safety 18 · Value 9");
  });

  it("breaks a tie in the guide-first order, so two businesses read alike", () => {
    expect(tagLine({ equipment: 3, guide: 3 })).toBe("Guide 3 · Equipment 3");
  });

  it("leaves out a tag nobody chose rather than showing a zero", () => {
    // A list of zeroes says something about the business that nobody said.
    expect(tagLine({ guide: 0, safety: 0 })).toBeNull();
    expect(tagLine(undefined)).toBeNull();
  });
});

describe("who left a review", () => {
  it("is a traveller when the API names nobody", () => {
    expect(reviewerName(null)).toBe("A traveller");
    expect(reviewerName("   ")).toBe("A traveller");
  });

  it("is the first name the API sent, and nothing more", () => {
    // D-018: a review is published to whoever opens the operator's page, so a
    // surname or a contact detail here reaches strangers.
    expect(reviewerName("Asha")).toBe("Asha");
  });
});
