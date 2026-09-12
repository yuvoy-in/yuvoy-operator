import { describe, it, expect } from "vitest";
import {
  ABOUT_MAX,
  ABOUT_MIN,
  aboutIssue,
  aboutSize,
  countsFaster,
  languagesIssue,
  parseLanguages,
  toStory,
} from "./story";

describe("how long `about` is — yuvoy-operator#41", () => {
  it("measures what the API measures: bytes of the trimmed text", () => {
    expect(aboutSize("  Two boats.  ")).toBe(10);
    // The apostrophe a phone types for ' is three bytes.
    expect(aboutSize("We’re")).toBe(7);
    // Devanagari: three bytes a letter.
    expect(aboutSize("नमस्ते")).toBe(18);
  });

  it("says when the count will run ahead of the typing", () => {
    expect(countsFaster("Two boats and a crew")).toBe(false);
    expect(countsFaster("We’re out by seven")).toBe(true);
  });

  it("allows empty, which clears it", () => {
    expect(aboutIssue("")).toBeNull();
    expect(aboutIssue("   \n ")).toBeNull();
  });

  it("refuses two words, and allows exactly forty", () => {
    expect(aboutIssue("We dive.")).toMatch(/At least 40 characters/);
    expect(aboutIssue("a".repeat(ABOUT_MIN - 1))).not.toBeNull();
    expect(aboutIssue("a".repeat(ABOUT_MIN))).toBeNull();
  });

  it("allows exactly six hundred, and refuses one more", () => {
    expect(aboutIssue("a".repeat(ABOUT_MAX))).toBeNull();
    expect(aboutIssue("a".repeat(ABOUT_MAX + 1))).toMatch(
      /600 characters at most\. This is 601/,
    );
  });

  it("refuses what the API would refuse, even when it looks short enough", () => {
    // 598 letters, two of them curly apostrophes: 602 bytes.
    const text = "a".repeat(596) + "’’";
    expect([...text]).toHaveLength(598);
    expect(aboutIssue(text)).not.toBeNull();
  });
});

describe("the languages box", () => {
  it("splits on whatever a thumb reached for", () => {
    expect(parseLanguages("English, Hindi;Bengali\nTamil")).toEqual([
      "English",
      "Hindi",
      "Bengali",
      "Tamil",
    ]);
  });

  it("drops blanks and repeats, keeping the first spelling", () => {
    expect(parseLanguages(" English , , english,Hindi, ")).toEqual([
      "English",
      "Hindi",
    ]);
  });

  it("cleans before it counts, because the API counts first", () => {
    const eightAndABlank = "A, B, C, D, E, F, G, H, ";
    expect(parseLanguages(eightAndABlank)).toHaveLength(8);
    expect(languagesIssue(parseLanguages(eightAndABlank))).toBeNull();
    expect(languagesIssue(parseLanguages("A,B,C,D,E,F,G,H,I"))).toMatch(
      /8 languages at most\. This is 9/,
    );
  });
});

describe("reading GET /story", () => {
  it("gives every unset field one shape", () => {
    expect(
      toStory({
        about: "",
        languages: null,
        photos: [],
        reviewed: { operatingSince: null, findThemAt: "", why: "Because." },
      }),
    ).toEqual({
      about: "",
      languages: [],
      photos: [],
      reviewed: { operatingSince: null, findThemAt: null, why: "Because." },
    });
  });

  it("keeps the gallery in the order it is shown", () => {
    const story = toStory({
      about: "",
      languages: [],
      photos: [
        { id: "b", position: 3, url: "https://imagedelivery.net/h/b/card" },
        { id: "a", position: 1 },
        { position: 2 },
      ],
      reviewed: {},
    });
    expect(story?.photos).toEqual([
      { id: "a", position: 1, url: null },
      { id: "b", position: 3, url: "https://imagedelivery.net/h/b/card" },
    ]);
  });

  it("is nothing for a response that is not a story", () => {
    expect(toStory(null)).toBeNull();
    expect(toStory("nope")).toBeNull();
  });
});
