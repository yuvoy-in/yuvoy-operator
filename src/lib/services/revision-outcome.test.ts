import { describe, expect, it } from "vitest";
import {
  fieldLabels,
  onlyChanged,
  readRevisionOutcome,
} from "./revision-outcome";

/*
  D-032.3: a change to a published listing goes live at once for what the
  operator owns and waits for a person for what the listing promises. The
  portal told every one of them "with us", including a price that was already
  live, and sent every field on every edit.
*/

describe("readRevisionOutcome", () => {
  it("reads both halves, the API's sentence and its note", () => {
    expect(
      readRevisionOutcome({
        applied: ["unitPricePaise"],
        inReview: ["description"],
        state: "submitted",
        next: "The first list is live now. We read the second, and the listing keeps selling on the old wording meanwhile.",
        note: "Bookings already made are unaffected: they keep the price and terms they were made on.",
      }),
    ).toEqual({
      applied: ["unitPricePaise"],
      inReview: ["description"],
      next: "The first list is live now. We read the second, and the listing keeps selling on the old wording meanwhile.",
      note: "Bookings already made are unaffected: they keep the price and terms they were made on.",
    });
  });

  it("never shows a code where a sentence belongs", () => {
    // Before D-032.3 `next` was `wait_for_review`.
    const outcome = readRevisionOutcome({
      state: "submitted",
      next: "wait_for_review",
    });
    expect(outcome.next).toBeUndefined();
    expect(outcome.applied).toEqual([]);
    expect(outcome.inReview).toEqual([]);
  });

  it("takes the long dashes out of what the API wrote", () => {
    const outcome = readRevisionOutcome({
      applied: [],
      inReview: ["title"],
      next: "We read it first — it keeps selling meanwhile.",
    });
    expect(outcome.next).not.toMatch(/[–—―]/);
  });

  it("survives an answer with nothing in it", () => {
    expect(readRevisionOutcome(undefined)).toEqual({
      applied: [],
      inReview: [],
    });
    expect(readRevisionOutcome({ applied: "price", inReview: [3] })).toEqual({
      applied: [],
      inReview: [],
    });
  });
});

describe("fieldLabels", () => {
  it("names each field as the form does, and the pin once", () => {
    expect(
      fieldLabels([
        "meetingPoint",
        "meetingLat",
        "meetingLng",
        "unitPricePaise",
      ]),
    ).toEqual(["Where to meet", "Pin on the map", "Price"]);
  });

  it("shows a field this build does not know by its own name", () => {
    expect(fieldLabels(["somethingNew"])).toEqual(["somethingNew"]);
  });
});

function formOf(entries: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe("onlyChanged", () => {
  const defaults = {
    title: "Reef dive",
    unitPrice: "4500",
    inclusions: "Mask and fins\nOne guided dive",
    meetingLat: "11.9695",
    meetingLng: "92.9631",
  };

  it("keeps what changed and the id, and drops what nobody touched", () => {
    const out = onlyChanged(
      formOf([
        ["id", "exp_1"],
        ["title", "Reef dive"],
        ["unitPrice", "5000"],
        ["inclusions", "Mask and fins\nOne guided dive"],
      ]),
      defaults,
    );
    expect([...out.entries()]).toEqual([
      ["id", "exp_1"],
      ["unitPrice", "5000"],
    ]);
  });

  it("sends a cleared field, because clearing is a change", () => {
    const out = onlyChanged(formOf([["title", ""]]), defaults);
    expect(out.get("title")).toBe("");
  });

  it("does not mistake a browser's line endings for an edit", () => {
    const out = onlyChanged(
      formOf([["inclusions", "Mask and fins\r\nOne guided dive"]]),
      defaults,
    );
    expect(out.has("inclusions")).toBe(false);
  });

  it("sends both halves of a pair when either moved", () => {
    const pin = [["meetingLat", "meetingLng"]] as const;
    const north = onlyChanged(
      formOf([
        ["meetingLat", "11.97"],
        ["meetingLng", "92.9631"],
      ]),
      defaults,
      pin,
    );
    expect(north.get("meetingLat")).toBe("11.97");
    expect(north.get("meetingLng")).toBe("92.9631");

    const still = onlyChanged(
      formOf([
        ["meetingLat", "11.9695"],
        ["meetingLng", "92.9631"],
      ]),
      defaults,
      pin,
    );
    expect(still.has("meetingLat")).toBe(false);
    expect(still.has("meetingLng")).toBe(false);
  });

  it("leaves out a field the form did not render", () => {
    const out = onlyChanged(formOf([["id", "exp_1"]]), defaults);
    expect([...out.keys()]).toEqual(["id"]);
  });
});
