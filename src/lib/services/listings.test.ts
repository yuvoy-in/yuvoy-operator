import { describe, expect, it } from "vitest";
import {
  describeBlockers,
  describePricingUnit,
  PRICING_UNITS,
  describeRejection,
  describeStatus,
  listingsWithoutFootage,
  orderListings,
  type OperatorExperience,
  isDraft,
} from "./listings";

/*
  `status` is widened to a plain string on purpose. `not_selling` is real on
  the server and is not in the pinned contract yet (yuvoy-operator#28,
  yuvoy-api migration 0053), so the generated union does not carry it — and a
  fixture that could not express it could not test the copy an operator whose
  listings have stopped earning will actually see.
*/
const listing = (
  over: Partial<Omit<OperatorExperience, "status">> & { status?: string } = {},
): OperatorExperience =>
  ({
    id: "exp_1",
    title: "Reef dive",
    status: "live",
    ...over,
  }) as OperatorExperience;

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

  it("uses the product's three words — Live, Paused, In review (#44)", () => {
    expect(describeStatus("live").label).toBe("Live");
    expect(describeStatus("withdrawn").label).toBe("Paused");
    expect(describeStatus("in_review").label).toBe("In review");
    // Selling while an edit is read, said in the same vocabulary.
    expect(describeStatus("live_changes_in_review").label).toBe(
      "Live · edit in review",
    );
  });

  it("never tells a paused operator that putting it back waits on us", () => {
    /*
      D-032.4. Resuming is the operator's own switch and is immediate. The old
      body — "send a change to put it back in front of us" — was false twice:
      an approved edit never republished a withdrawn listing, and since
      yuvoy-api#157 nothing waits on a review at all. An operator who believes
      it does waits for a queue that does not exist.
    */
    const body = describeStatus("withdrawn").body.toLowerCase();
    expect(body).toContain("resume");
    for (const stale of ["review", "send a change", "in front of us"]) {
      expect(body, stale).not.toContain(stale);
    }
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

describe("a listing that is published and not selling", () => {
  /*
    yuvoy-operator#28. The listing IS published and is still absent from every
    feed, absent from search and refusing checkout — because the operator is
    not selling, a kill switch is engaged, the price is gone, or a credential
    lapsed.

    Built ahead of the contract deliberately: `describeStatus` takes a string,
    so this is inert while the API never sends the value and correct the moment
    it does. What it replaces is the fallback — "this version of the portal
    cannot describe this state" — which is the wrong thing to show somebody
    whose listings have stopped earning.
  */
  it("does not call it on sale", () => {
    expect(describeStatus("not_selling").selling).toBe(false);
  });

  it("gives it its own label rather than the honest shrug", () => {
    const s = describeStatus("not_selling");
    expect(s.label).toBe("Not selling");
    expect(s.body).not.toContain("cannot describe this state");
    // Published, which is what makes it different from every other non-selling
    // state, and the word an operator needs to see.
    expect(s.body).toContain("Published");
  });

  it("names no reason, because the reason is not on this object", () => {
    /*
      The four causes belong to the ACCOUNT — `GET /me` returns the blockers
      that name them and the Business screen renders them. A row that guessed
      "your insurance expired" would be a sentence an operator plans a season
      around.
    */
    const body = describeStatus("not_selling").body.toLowerCase();
    for (const guess of [
      "licence",
      "license",
      "insurance",
      "certificate",
      "expired",
    ]) {
      expect(body, guess).not.toContain(guess);
    }
  });

  it("sends them to Business, and says the operator has to act", () => {
    const s = describeStatus("not_selling");
    expect(s.accountGap).toBe(true);
    expect(s.needsAnswer).toBe(true);
  });

  it("still lets them send an edit", () => {
    // Nothing about this state is about the listing's text. Refusing the edit
    // would be a second, invented refusal on top of the real one.
    expect(describeStatus("not_selling").canSubmit).toBe(true);
  });

  it("claims nothing about a state it cannot name", () => {
    // The fallback must not acquire either flag by accident: a build that
    // cannot name a state cannot know whose move it is.
    const s = describeStatus("archived_pending_appeal");
    expect(s.accountGap).toBe(false);
    expect(s.needsAnswer).toBe(false);
  });

  it("is the only state that sends anybody to Business", () => {
    for (const status of [
      "draft",
      "in_review",
      "live",
      "live_changes_in_review",
      "changes_rejected",
      "withdrawn",
    ]) {
      expect(describeStatus(status).accountGap, status).toBe(false);
    }
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

  it("puts a listing that has STOPPED earning above one that never started", () => {
    /*
      `not_selling` was published and is now earning nothing, so it has a meter
      running; `changes_rejected` is a revision we came back on, which never
      went live. Both are the operator's homework and only one is costing them
      money while they read the screen.

      Raised on yuvoy-operator#28 rather than decided silently, so a different
      intended reading moves this rather than leaving it wrong.
    */
    const ordered = orderListings([
      listing({ id: "a", title: "Alpha", status: "changes_rejected" }),
      listing({ id: "b", title: "Bravo", status: "not_selling" }),
      listing({ id: "c", title: "Charlie", status: "live" }),
    ]);
    expect(ordered.map((l) => l.id)).toEqual(["b", "a", "c"]);
  });

  it("still sorts withdrawn and unrecognised states last", () => {
    const ordered = orderListings([
      listing({ id: "a", title: "Alpha", status: "archived_pending_appeal" }),
      listing({ id: "b", title: "Bravo", status: "withdrawn" }),
      listing({ id: "c", title: "Charlie", status: "draft" }),
    ]);
    expect(ordered[0].id).toBe("c");
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

describe("how a price is stated", () => {
  /*
    yuvoy-operator#30 §1. The column always existed and checkout always divided
    correctly for a group price; what was missing is anybody SAYING which one
    applies, so a listing nobody was asked about was indistinguishable from a
    charter deliberately priced for the group.
  */
  it("offers exactly the two the contract declares", () => {
    expect(PRICING_UNITS.map((u) => u.value)).toEqual([
      "per_person",
      "per_group",
    ]);
  });

  it("names each one in words an operator uses", () => {
    expect(describePricingUnit("per_person")).toBe("Per person");
    expect(describePricingUnit("per_group")).toBe("For the group");
  });

  it("returns null for a basis nobody has stated", () => {
    /*
      The whole point of migration 0056: absent is UNSTATED, not per-person.
      A helper that fell back to "Per person" here would put the misstatement
      back one layer down, which is exactly what the API stopped doing.
    */
    expect(describePricingUnit(undefined)).toBeNull();
    expect(describePricingUnit("")).toBeNull();
  });

  it("claims nothing about a basis it does not recognise", () => {
    expect(describePricingUnit("per_boat")).toBeNull();
  });

  it("gives every option a hint, because the labels alone are ambiguous", () => {
    // "For the group" without "one price for the whole booking" is the sort of
    // phrase an operator reads two ways and picks the wrong one.
    for (const unit of PRICING_UNITS) {
      expect(unit.hint.length, unit.value).toBeGreaterThan(10);
    }
  });
});

describe("what is still missing before publication", () => {
  /*
    yuvoy-operator#30 §3. The row used to say only "No price yet", derived from
    `sellable` — true and incomplete, so an operator sent it for review and
    found out the rest.
  */
  it("says each blocker in words an operator uses", () => {
    expect(describeBlockers(["unitPricePaise", "summary"])).toEqual([
      "a price",
      "a short summary",
    ]);
  });

  it("explains the pricing basis rather than naming the field", () => {
    /*
      The subtle one. The column is NOT NULL, so the value alone cannot say
      whether anybody chose it — an unstated basis blocks publication rather
      than printing a guessed phrase beside the price, which is the same defect
      yuvoy-app#20 fixed on the traveller's card.
    */
    expect(describeBlockers(["pricingUnit"])).toEqual([
      "whether that price is per person or for the group",
    ]);
  });

  it("keeps a blocker it cannot name rather than dropping it", () => {
    /*
      Dropping one would make the row claim the listing is ready while the API
      refuses it — the row would be lying on the API's behalf.
    */
    expect(describeBlockers(["someNewField"])).toEqual(["someNewField"]);
  });

  it("is empty when nothing is outstanding", () => {
    expect(describeBlockers([])).toEqual([]);
    expect(describeBlockers(undefined)).toEqual([]);
  });
});

/*
  The audit before release, O3: the listing's screen read `publicationState`
  and the edit screen read `status`, so a first listing sent back (a draft
  again, `changes_rejected` in `status`) opened the revision form.
*/
describe("which listing is a draft", () => {
  it("reads what the listing IS, a sent-back one included", () => {
    expect(isDraft({ publicationState: "draft", status: "draft" })).toBe(true);
    expect(
      isDraft({ publicationState: "draft", status: "changes_rejected" }),
    ).toBe(true);
    expect(
      isDraft({ publicationState: "in_review", status: "in_review" }),
    ).toBe(false);
    // A published listing whose EDIT was declined is not a draft.
    expect(
      isDraft({ publicationState: "published", status: "changes_rejected" }),
    ).toBe(false);
    expect(
      isDraft({ publicationState: "withdrawn", status: "withdrawn" }),
    ).toBe(false);
  });

  it("falls back to the status, sent-back included, on an API that sends no publication state", () => {
    expect(isDraft({ status: "draft" })).toBe(true);
    expect(isDraft({ status: "changes_rejected", sentBack: { at: "x" } })).toBe(
      true,
    );
    expect(isDraft({ status: "changes_rejected" })).toBe(false);
    expect(isDraft({ status: "live" })).toBe(false);
  });
});
