import { describe, it, expect } from "vitest";
import {
  ABOUT_MAX,
  ABOUT_MIN,
  aboutIssue,
  aboutSize,
  languagesIssue,
  parseLanguages,
  toStory,
} from "./story";

describe("how long `about` is — yuvoy-operator#41", () => {
  it("measures what the API measures: CHARACTERS of the trimmed text", () => {
    /*
      It measured bytes, because `SaveStory` checked Go's `len`, which is bytes
      of UTF-8. The rule was wrong on both sides and landed on exactly the
      wrong people: every letter of Bengali or Devanagari is three bytes, so a
      business writing in one got about 200 characters rather than 600.

      The API counts `utf8.RuneCountInString` now, which is what the database
      constraint always measured. These three are the cases that told the two
      apart, and they now agree with the letters typed.
    */
    expect(aboutSize("  Two boats.  ")).toBe(10);
    // The apostrophe a phone types for ' was three bytes and is one character.
    expect(aboutSize("We’re")).toBe(5);
    // Devanagari: six code points, eighteen bytes.
    expect(aboutSize("नमस्ते")).toBe(6);
  });

  it("counts code points, not UTF-16 units", () => {
    /*
      `"🐠".length` is 2: a string's `.length` counts UTF-16 code units, and
      anything outside the basic plane is a surrogate pair. A business that put
      an emoji in its story would be charged double for it, and the count would
      disagree with the API for the second time in the same field.
    */
    expect(aboutSize("🐠")).toBe(1);
    expect("🐠".length).toBe(2);
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

  it("no longer refuses a paragraph the API would accept", () => {
    /*
      The inverse of the old assertion, and the reason this changed. 598
      characters with two curly apostrophes is 602 BYTES: the portal refused it
      while the API and the database were happy. Written in Bengali the same
      paragraph was refused at a third of the length.
    */
    const text = "a".repeat(596) + "’’";
    expect([...text]).toHaveLength(598);
    expect(aboutIssue(text)).toBeNull();

    // A Bengali paragraph of 600 characters is ~1800 bytes and is fine.
    expect(aboutIssue("আ".repeat(ABOUT_MAX))).toBeNull();
    expect(aboutIssue("আ".repeat(ABOUT_MAX + 1))).not.toBeNull();
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
