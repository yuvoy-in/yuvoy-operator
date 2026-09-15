import { describe, expect, it } from "vitest";
import { declineLine, replaceNote, sheetActions } from "./reel-sheet";

const ON = { experienceId: "exp_1" };

describe("sheetActions", () => {
  it("offers the reason and a replacement on a declined reel", () => {
    const can = sheetActions({ situation: "changes_needed" });
    expect(can.whyDeclined).toBe(true);
    expect(can.replace).toBe(true);
    expect(can.takeDown).toBe(true);
    expect(can.confirmRights).toBe(false);
  });

  it("offers rights on a reel that is waiting for them, and nothing to publish", () => {
    const can = sheetActions({ situation: "needs_rights" });
    expect(can.confirmRights).toBe(true);
    expect(can.putOnAnother).toBe(false);
    expect(can.coverOrGallery).toBe(false);
  });

  it("offers cover and gallery only when the listing is known", () => {
    expect(
      sheetActions({ situation: "live", listing: ON }).coverOrGallery,
    ).toBe(true);
    /*
      Both halves matter. `live` with no `experienceId` is a response that
      cannot say which listing to publish to, and a button that sends an empty
      one is a 400 the operator did nothing to earn.
    */
    expect(sheetActions({ situation: "live" }).coverOrGallery).toBe(false);
    expect(
      sheetActions({ situation: "not_attached", listing: ON }).coverOrGallery,
    ).toBe(false);
  });

  it("offers another listing from every attached state and from none", () => {
    for (const situation of [
      "live",
      "waiting_on_listing",
      "listing_withdrawn",
      "not_attached",
    ]) {
      expect(sheetActions({ situation }).putOnAnother).toBe(true);
    }
    expect(sheetActions({ situation: "in_review" }).putOnAnother).toBe(false);
  });

  it("never offers taking down what is already down", () => {
    expect(sheetActions({ situation: "withdrawn" }).takeDown).toBe(false);
    expect(sheetActions({ situation: "processing" }).takeDown).toBe(true);
  });

  it("gives an unknown situation the one safe action and no others", () => {
    const can = sheetActions({ situation: "something_new", listing: ON });
    expect(can.takeDown).toBe(true);
    expect(can.putOnAnother).toBe(false);
    expect(can.coverOrGallery).toBe(false);
    expect(can.confirmRights).toBe(false);
    expect(can.replace).toBe(false);
    expect(can.whyDeclined).toBe(false);
  });

  it("treats an absent situation as unknown rather than as live", () => {
    expect(sheetActions({}).putOnAnother).toBe(false);
    expect(sheetActions({}).takeDown).toBe(true);
  });
});

describe("declineLine", () => {
  it("words the reviewer's code as the reels page words it", () => {
    expect(declineLine("NOT_THIS_EXPERIENCE")).toBe("not this experience");
  });

  it("shows a code this build has not met rather than swallowing it", () => {
    expect(declineLine("SOMETHING_ELSE_ENTIRELY")).toBe(
      "something else entirely",
    );
  });

  it("says nothing when the reviewer gave no code", () => {
    expect(declineLine(undefined)).toBeNull();
    expect(declineLine("  ")).toBeNull();
  });
});

describe("replaceNote", () => {
  it("tells a live reel to stay up until the new one is through", () => {
    expect(replaceNote("live")).toMatch(/Keep this one up/);
  });

  it("says nothing where there is nothing up to keep", () => {
    expect(replaceNote("changes_needed")).toBeNull();
    expect(replaceNote("failed")).toBeNull();
  });
});
