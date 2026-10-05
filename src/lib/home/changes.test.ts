import { describe, expect, it } from "vitest";
import type { Need } from "./needs";
import type { RequestView } from "@/lib/day/request-view";
import { changeSentences, needChanges } from "./changes";

function request(id: string, name: string, clock: string): Need {
  return {
    kind: "request",
    key: `request-${id}`,
    view: { id, name, clock } as RequestView,
  };
}
const LINK: Need = {
  kind: "link",
  key: "listing-no-dates",
  text: "A listing has no dates",
  action: "Add dates",
  href: "/calendar",
  tone: "plain",
} as Need;

/*
  What a re-read of Home changed (O01 A, approved 4 Oct 2026): only what the
  operator did not do, said in the owner's words.
*/
describe("what a re-read changed", () => {
  const kavya = request("r3", "Kavya Iyer", "18 min left");
  const daniel = request("r2", "Daniel Okafor", "3h left");
  const asha = request("r1", "Asha Menon", "24 min left");

  it("finds what arrived and what left", () => {
    const change = needChanges([asha, daniel], [kavya, asha], new Set());
    expect(change.arrived).toEqual([kavya]);
    expect(change.gone).toEqual([daniel]);
  });

  it("never counts what the operator answered, opened or took cash on as gone", () => {
    const change = needChanges([asha, daniel], [asha], new Set(["request-r2"]));
    expect(change.gone).toEqual([]);
  });

  it("finds nothing in an answer that changed nothing", () => {
    expect(needChanges([asha], [asha], new Set())).toEqual({
      arrived: [],
      gone: [],
    });
  });
});

describe("what is said", () => {
  it("is the owner's two sentences, with the live values", () => {
    expect(
      changeSentences(
        [request("r3", "Kavya Iyer", "18 min left")],
        [request("r2", "Daniel Okafor", "3h left")],
      ),
    ).toEqual([
      "Seat request from Kavya Iyer, 18 min left.",
      "Daniel Okafor's request is no longer waiting.",
    ]);
  });

  it("says a request with no name as the traveller, mid-sentence or not", () => {
    const nameless = request("r9", "The traveller", "1h left");
    expect(changeSentences([nameless], [nameless])).toEqual([
      "Seat request from the traveller, 1h left.",
      "The traveller's request is no longer waiting.",
    ]);
  });

  it("says nothing for a card without a clock", () => {
    expect(changeSentences([LINK], [LINK])).toEqual([]);
  });
});
