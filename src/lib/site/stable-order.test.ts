import { describe, expect, it } from "vitest";
import { sameOrder, stableOrder } from "./stable-order";

describe("a list that keeps its answered rows in place", () => {
  it("is the server's order when nothing is kept", () => {
    expect(stableOrder(["a", "b", "c"], ["c", "a"], new Set())).toEqual([
      "c",
      "a",
    ]);
  });

  it("puts a kept row back after the row that came before it", () => {
    // `b` was answered and the server dropped it: it stays between a and c.
    expect(stableOrder(["a", "b", "c"], ["a", "c"], new Set(["b"]))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps a kept first row first, and a run of kept rows in their order", () => {
    expect(
      stableOrder(["x", "y", "a", "b"], ["a", "b"], new Set(["x", "y"])),
    ).toEqual(["x", "y", "a", "b"]);
  });

  it("lets new rows arrive in the server's place around the kept ones", () => {
    expect(
      stableOrder(["a", "b", "c"], ["n", "a", "c"], new Set(["b"])),
    ).toEqual(["n", "a", "b", "c"]);
  });

  it("drops a row nobody kept once the server drops it", () => {
    expect(stableOrder(["a", "b"], ["a"], new Set())).toEqual(["a"]);
  });

  it("settles: the result fed back in is the result again", () => {
    const previous = ["a", "b", "c", "d"];
    const server = ["c", "a"];
    const kept = new Set(["b", "d"]);
    const once = stableOrder(previous, server, kept);
    expect(stableOrder(once, server, kept)).toEqual(once);
    expect(sameOrder(once, stableOrder(once, server, kept))).toBe(true);
  });
});
