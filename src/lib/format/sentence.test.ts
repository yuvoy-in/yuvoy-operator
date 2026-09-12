import { describe, it, expect } from "vitest";
import { sentence } from "./sentence";

describe("sentence", () => {
  it("capitalises and stops an API message, keeping its words", () => {
    expect(
      sentence("you already have five photographs — remove one first"),
    ).toBe("You already have five photographs. Remove one first.");
  });

  it("leaves a sentence that already ends alone", () => {
    expect(sentence("That is not a year!")).toBe("That is not a year!");
  });

  it("is nothing for nothing", () => {
    expect(sentence("   ")).toBe("");
  });
});
