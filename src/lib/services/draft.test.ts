import { describe, expect, it } from "vitest";
import {
  draftSections,
  missingCount,
  sendLabel,
  type DraftContext,
  type DraftListing,
} from "./draft";

/*
  A draft listing read back as it stands (yuvoy-operator#85 s10). It used to
  say "Still missing: a short summary, a price, where to meet" and nothing
  else: the names of the holes, and not one word of what the listing says.
*/

const FULL: DraftListing = {
  title: "Try-dive at Nemo Reef",
  summary: "A first dive off the boat.",
  description: "Two hours on the reef with a guide.",
  category: "adventure",
  activityType: "scuba",
  activityTypeLabel: "Scuba diving",
  destination: "andaman/havelock",
  unitPricePaise: 450000,
  pricingUnit: "per_person",
  durationMinutes: 180,
  maxPartySize: 6,
  meetingPoint: "Beach 3 dive hut",
  meetingLandmark: "Blue gate beside the fuel pump",
  publishBlockers: [],
};

const CONTEXT = {
  mediaCount: 2,
  categoryLabel: "Adventure",
  destinationLabel: "Havelock (Swaraj Dweep)",
};

/** Every field of every section, by its API name. */
function fields(listing: DraftListing, context: DraftContext = CONTEXT) {
  return new Map(
    draftSections(listing, context)
      .flatMap((s) => s.fields)
      .map((f) => [f.key, f]),
  );
}

describe("a draft read back", () => {
  it("says what it says, what it costs, where it meets and how it looks", () => {
    expect(draftSections(FULL, CONTEXT).map((s) => s.heading)).toEqual([
      "What it says",
      "What it costs",
      "Where it meets",
      "How it will look",
    ]);

    const f = fields(FULL);
    expect(f.get("title")?.value).toBe("Try-dive at Nemo Reef");
    expect(f.get("category")?.value).toBe("Adventure");
    expect(f.get("destination")?.value).toBe("Havelock (Swaraj Dweep)");
    expect(f.get("unitPricePaise")?.value).toBe("₹4,500");
    expect(f.get("pricingUnit")?.value).toBe("Per person");
    expect(f.get("durationMinutes")?.value).toBe("180 minutes");
    expect(f.get("maxPartySize")?.value).toBe("6");
    expect(f.get("meetingPoint")?.value).toBe("Beach 3 dive hut");
    expect(f.get("media")?.value).toBe("2 on it");
  });

  /*
    The word for the code, from the vocabulary, and the code itself when that
    read failed: ugly, and still true. Nothing is invented.
  */
  it("prefers the vocabulary's word and falls back to the code", () => {
    const f = fields(FULL, { mediaCount: 0 });
    expect(f.get("category")?.value).toBeNull();
    expect(f.get("destination")?.value).toBeNull();

    const withCodes = fields(FULL, {
      mediaCount: 0,
      categoryLabel: "adventure",
      destinationLabel: "andaman/havelock",
    });
    expect(withCodes.get("category")?.value).toBe("adventure");
  });

  it("says the activity in the API's own word, or its key", () => {
    expect(fields(FULL).get("activityType")?.value).toBe("Scuba diving");
    const { activityTypeLabel: _label, ...unlabelled } = FULL;
    void _label;
    expect(fields(unlabelled).get("activityType")?.value).toBe("scuba");
  });

  it("names a listing with nothing on it as the blank card it would be", () => {
    const f = fields(FULL, { ...CONTEXT, mediaCount: 0 });
    expect(f.get("media")?.value).toBe(
      "Nothing on it yet. It would show as a blank card.",
    );
    // And it never blocks: media is not something the API refuses a listing for.
    expect(f.get("media")?.missing).toBe(false);
  });

  it("treats whitespace as nothing said", () => {
    expect(
      fields({ ...FULL, summary: "   " }).get("summary")?.value,
    ).toBeNull();
  });
});

describe("what the API says is missing", () => {
  it("marks each blocker on its own field, and sends Edit to its step", () => {
    const f = fields({
      ...FULL,
      publishBlockers: ["summary", "unitPricePaise", "meetingPoint"],
    });

    expect(f.get("summary")?.missing).toBe(true);
    expect(f.get("summary")?.step).toBe("basics");
    expect(f.get("unitPricePaise")?.step).toBe("selling");
    expect(f.get("meetingPoint")?.step).toBe("location");
    // And the fields it did not name are untouched.
    expect(f.get("title")?.missing).toBe(false);
    expect(f.get("durationMinutes")?.missing).toBe(false);
  });

  /*
    `pricingUnit` is NOT NULL, so the column holds a basis whether or not
    anybody chose one. The blocker is the only thing that can tell the two
    apart, and printing "Per person" beside a basis nobody stated is the
    guessed phrase the contract asks clients not to print.
  */
  it("draws a blocked field as empty even when the row holds a value", () => {
    const f = fields({ ...FULL, publishBlockers: ["pricingUnit"] });
    expect(f.get("pricingUnit")?.value).toBeNull();
    expect(f.get("pricingUnit")?.missing).toBe(true);
  });

  /*
    A newer contract can make a field mandatory that this build has never
    drawn. It still has to appear: a count of three over a screen marking two
    is a screen nobody trusts.
  */
  it("gathers a blocker it has no row for, in the API's own words", () => {
    const sections = draftSections(
      { ...FULL, publishBlockers: ["whatTheBoatIsCalled"] },
      CONTEXT,
    );
    const rest = sections[sections.length - 1];
    expect(rest.heading).toBe("Also needed");
    expect(rest.fields).toHaveLength(1);
    expect(rest.fields[0].label).toBe("WhatTheBoatIsCalled");
    expect(rest.fields[0].missing).toBe(true);
    expect(rest.fields[0].step).toBeNull();
  });

  it("adds no section when every blocker has a row", () => {
    const sections = draftSections(
      { ...FULL, publishBlockers: ["title", "meetingPoint"] },
      CONTEXT,
    );
    expect(sections.map((s) => s.id)).not.toContain("draft-rest");
  });

  it("counts what the API named, and nothing else", () => {
    expect(missingCount(FULL)).toBe(0);
    expect(missingCount({ publishBlockers: ["title", "summary"] })).toBe(2);
    expect(missingCount({})).toBe(0);
  });
});

/*
  The send button stays on the screen while the listing is not ready, counting.
  A button that disappears answers neither "can I send this" nor "how much is
  left".
*/
describe("what the send button says", () => {
  it("counts one thing, several things, and stops counting at none", () => {
    expect(sendLabel("Send for review", 1)).toBe(
      "Send for review (1 thing missing)",
    );
    expect(sendLabel("Send for review", 3)).toBe(
      "Send for review (3 things missing)",
    );
    expect(sendLabel("Send for review", 0)).toBe("Send for review");
    expect(sendLabel("Send again", 2)).toBe("Send again (2 things missing)");
  });
});

/*
  The audit before release, O4: "What to look for" and "Photographs and clips"
  opened the bare edit screen, because the map from a field to its step had no
  entry for either. Asked of every row the read-back draws, so the next field
  added to it cannot be forgotten.
*/
describe("where each row of the read-back opens", () => {
  it("opens a step for every row it draws", () => {
    for (const [key, field] of fields(FULL)) {
      expect(field.step, `${key} opens no step`).not.toBeNull();
    }
  });

  it("opens Location for the landmark and Media for the pictures", () => {
    expect(fields(FULL).get("meetingLandmark")?.step).toBe("location");
    expect(fields(FULL).get("media")?.step).toBe("media");
  });
});
