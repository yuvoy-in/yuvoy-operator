import { describe, it, expect } from "vitest";
import {
  describeKind,
  describeMissingPreview,
  countLibrary,
  canWithdraw,
  unattached,
  type MediaItem,
} from "./media";

const item = (over: Partial<MediaItem> = {}): MediaItem => ({
  id: "med_1",
  state: "approved",
  createdAt: "2026-09-07T06:00:00Z",
  ...over,
});

describe("describeKind", () => {
  it("names the two kinds the contract declares", () => {
    expect(describeKind("video")?.label).toBe("Reel");
    expect(describeKind("image")?.label).toBe("Photograph");
  });

  it("claims nothing when the API did not say", () => {
    /*
      The rule this whole module exists to hold. The only available guess —
      absent `durationSeconds` means a photograph — is wrong in the case that
      happens most: a clip still `uploaded` or `processing` has no duration
      either, so the first thing an operator sees after posting a reel would be
      that reel labelled a photograph.
    */
    expect(describeKind(undefined)).toBeNull();
  });

  it("claims nothing about a kind this build has not met", () => {
    // Same call `describeStatus` makes about an unknown listing status: an
    // unrecognised value is shown without a claim, never sorted into the
    // nearest bucket.
    expect(describeKind("audio")).toBeNull();
    expect(describeKind("")).toBeNull();
  });

  it("gives a reel an upright frame and a photograph a shallower one", () => {
    /*
      A reel is 9:16 because the uploader refuses anything else. A photograph
      has no declared dimensions anywhere in the contract and is usually
      landscape, and cropping one into a 9:16 slot removes most of it — on the
      one screen whose job is letting somebody recognise which photo a row is.
    */
    expect(describeKind("video")?.frame).toBe("aspect-[9/16]");
    expect(describeKind("image")?.frame).toBe("aspect-[4/3]");
  });
});

describe("countLibrary", () => {
  it("counts the two kinds separately", () => {
    const items = [
      item({ kind: "video" }),
      item({ kind: "video" }),
      item({ kind: "image" }),
    ];
    expect(countLibrary(items)).toBe("2 reels · 1 photograph");
  });

  it("says only the kind that is there", () => {
    expect(countLibrary([item({ kind: "image" })])).toBe("1 photograph");
    expect(countLibrary([item({ kind: "video" })])).toBe("1 reel");
  });

  it("keeps a stable order as an operator uploads", () => {
    // Reels first whichever arrived first, so the sentence does not reshuffle
    // under somebody reading it.
    const photoFirst = [item({ kind: "image" }), item({ kind: "video" })];
    expect(countLibrary(photoFirst)).toBe("1 reel · 1 photograph");
  });

  it("counts what it cannot name, honestly and separately", () => {
    /*
      Never folded into whichever kind is larger. An operator reading "3 reels"
      when one of them is something this build has never heard of is being told
      a number they will plan around.
    */
    /*
      `"audio"` is cast because the generated union has two members — which is
      the point. The wire is not the type: a client built against today's
      contract will meet tomorrow's enum, and this is the branch that decides
      whether that arrives as an honest count or as a wrong label.
    */
    const items = [
      item({ kind: "video" }),
      item({}),
      item({ kind: "audio" as unknown as MediaItem["kind"] }),
    ];
    expect(countLibrary(items)).toBe("1 reel · 2 other items");
  });

  it("falls back to a plain count when nothing can be named", () => {
    // An API that stopped sending `kind`, or this build against an older one.
    // The old wording was defensible for exactly this case.
    expect(countLibrary([item({}), item({})])).toBe("2 other items");
  });

  it("has something to say about an empty library", () => {
    expect(countLibrary([])).toBe("Nothing yet");
  });
});

describe("canWithdraw", () => {
  it("offers a takedown only where there is something to take down", () => {
    for (const state of [
      "approved",
      "published",
      "attested",
      "in_moderation",
    ]) {
      expect(canWithdraw(item({ state })), state).toBe(true);
    }
  });

  it("refuses the states the API would 404", () => {
    /*
      A clip mid-upload, one already withdrawn and one a reviewer refused are
      all things the operator cannot act on, and a button that 404s teaches
      them to distrust the screen.
    */
    for (const state of [
      "uploaded",
      "processing",
      "ready",
      "rejected",
      "quarantined",
      "withdrawn",
      "failed",
    ]) {
      expect(canWithdraw(item({ state })), state).toBe(false);
    }
  });

  it("refuses a row with no id, because there is nothing to address", () => {
    expect(canWithdraw(item({ id: undefined }))).toBe(false);
  });
});

describe("unattached", () => {
  it("counts approved work that no traveller can see", () => {
    const items = [
      item({ id: "a", state: "approved" }),
      item({
        id: "b",
        state: "approved",
        listing: { experienceId: "exp_1", title: "Dive" },
      }),
      // In review is not work waiting on the OPERATOR. Saying so about every
      // unfinished upload would make the notice worth ignoring.
      item({ id: "c", state: "in_moderation" }),
    ];
    expect(unattached(items).map((m) => m.id)).toEqual(["a"]);
  });

  it("is empty when everything approved is attached", () => {
    expect(
      unattached([
        item({ state: "approved", listing: { experienceId: "e", title: "T" } }),
      ]),
    ).toEqual([]);
  });
});

describe("what a tile says when there is no picture", () => {
  /*
    yuvoy-operator#29. 270 of 342 assets have no stored poster, so this is the
    common row rather than the edge case — and one sentence for all of them
    flattens four situations that mean different things to an operator.
  */
  const line = (over: Partial<MediaItem>) =>
    describeMissingPreview(item(over)).line;

  it("says nothing is wrong while a clip is still arriving", () => {
    for (const state of ["uploaded", "processing"]) {
      const p = describeMissingPreview(item({ kind: "video", state }));
      expect(p.faulted, state).toBe(false);
      expect(p.line, state).toMatch(/still arriving/i);
    }
  });

  it("puts `ready` with the operator, not with us", () => {
    /*
      The one correction to the issue's grouping. It lists `ready` alongside
      `attested` and `in_moderation` as "waiting on us — the most reassuring
      thing this screen can say". It is not: `ready` means the rights have not
      been attested, which is the operator's own next act, and this portal
      already says so on the row. Calling it reassuring parks a clip forever.
    */
    expect(line({ kind: "video", state: "ready" })).toMatch(/below is yours/i);
    expect(line({ kind: "video", state: "approved" })).toMatch(
      /below is yours/i,
    );
  });

  it("says a clip in review is with us", () => {
    for (const state of ["attested", "in_moderation"]) {
      expect(line({ kind: "video", state }), state).toMatch(/with us/i);
    }
  });

  it("says nothing about a picture on a row a person refused", () => {
    /*
      `rejection.code` is a closed set and is rendered below the tile, which is
      the thing that matters. "No preview yet" on a refused row reads as a
      technical hiccup rather than a decision.
    */
    for (const state of ["rejected", "quarantined"]) {
      const p = describeMissingPreview(item({ kind: "video", state }));
      expect(p.line, state).toBe("");
      expect(p.faulted, state).toBe(true);
    }
  });

  it("marks a photograph with no picture as a fault, whatever its state", () => {
    /*
      For an image the picture IS the item and the API builds its URL at read
      time, so there is no state in which a photograph legitimately has nothing
      to show. Explaining a clip's publication rule to somebody looking at a
      photo would be a confident wrong answer.
    */
    for (const state of ["ready", "in_moderation", "published"]) {
      const p = describeMissingPreview(item({ kind: "image", state }));
      expect(p.faulted, state).toBe(true);
      expect(p.line, state).toMatch(/did not load/i);
      expect(p.line, state).not.toMatch(/reel/i);
    }
  });

  it("treats a published clip with no still as anomalous, not as normal", () => {
    // A published clip is exactly the one that should have resolved a poster.
    const p = describeMissingPreview(
      item({ kind: "video", state: "published" }),
    );
    expect(p.faulted).toBe(true);
  });

  it("separates the four groups rather than repeating one sentence", () => {
    // The whole point of the issue: a single grey box flattens them.
    const lines = ["processing", "ready", "in_moderation", "failed"].map(
      (state) => line({ kind: "video", state }),
    );
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("says nothing on a row whose chip already says it", () => {
    /*
      `withdrawn` and the refused pair are deliberately silent. The chip below
      already carries the word, and for `withdrawn` a second paragraph saying
      "Taken down" also collided with the withdrawal receipt's own heading —
      which made an assertion elsewhere resolve to one element or two depending
      on render timing.
    */
    expect(line({ kind: "video", state: "withdrawn" })).toBe("");
  });

  it("claims nothing about a state it cannot name", () => {
    const p = describeMissingPreview(
      item({ kind: "video", state: "teleported" }),
    );
    expect(p.line).toBe("No preview yet.");
    expect(p.faulted).toBe(false);
  });
});
