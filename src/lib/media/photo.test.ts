import { describe, expect, it } from "vitest";
import { localPhotoRefusals, photoPreflight } from "./photo";
import { refuses } from "./preflight";

const MB = 1024 * 1024;
const limits = { maxBytes: 5 * MB };
const file = (
  over: Partial<{ name: string; size: number; type: string }> = {},
) => ({
  name: "reef.jpg",
  size: 2 * MB,
  type: "image/jpeg",
  ...over,
});

describe("the refusals that cost nothing", () => {
  it("runs before an intent is ever asked for", () => {
    /*
      The clip path learned this the expensive way: asking for a slot to
      discover somebody picked the wrong file spends a slot on a file that was
      never going to be uploaded. These two need no limits, so they are free.
    */
    expect(localPhotoRefusals(file({ size: 0 }))[0].message).toMatch(/empty/);
    expect(localPhotoRefusals(file({ type: "video/mp4" }))[0].message).toMatch(
      /not a photograph/,
    );
  });

  it("gets the article right on the kind it names", () => {
    // "an audio", "a video" — the article follows the word, not the sentence.
    expect(localPhotoRefusals(file({ type: "audio/mpeg" }))[0].message).toMatch(
      /That is an audio/,
    );
    expect(localPhotoRefusals(file({ type: "video/mp4" }))[0].message).toMatch(
      /That is a video/,
    );
  });

  it("refuses a GIF, which is a video wearing an image's content type", () => {
    /*
      It would upload and then sit in a gallery as a still of its first frame,
      which is not what anybody chose. Named rather than silently accepted.
    */
    const problems = localPhotoRefusals(file({ type: "image/gif" }));
    expect(refuses(problems)).toBe(true);
    expect(problems[0].message).toMatch(/single still/);
  });

  it("says nothing about an ordinary photograph", () => {
    expect(localPhotoRefusals(file())).toEqual([]);
    expect(localPhotoRefusals(file({ type: "image/png" }))).toEqual([]);
  });

  it("accepts a file whose type the browser could not name", () => {
    // An empty `type` is a browser that did not recognise the extension, not a
    // reason to refuse a file the host handles.
    expect(localPhotoRefusals(file({ type: "" }))).toEqual([]);
  });
});

describe("the size ceiling", () => {
  it("comes from the intent, never from a constant here", () => {
    /*
      Ours is 5 MB where the host allows 10, and it must be able to move
      server-side without a deploy. A file that is too big for one ceiling and
      fine for another proves the number is read rather than baked in.
    */
    const big = file({ size: 8 * MB });
    expect(refuses(photoPreflight(big, { maxBytes: 5 * MB }, {}))).toBe(true);
    expect(refuses(photoPreflight(big, { maxBytes: 10 * MB }, {}))).toBe(false);
  });

  it("says both numbers, and why a smaller one is better for the traveller", () => {
    const problems = photoPreflight(file({ size: 8 * MB }), limits, {});
    // 8.0, not 8: `formatBytes` keeps a decimal below 10 MB, which is where
    // the difference between 4.9 and 5.1 actually matters to somebody.
    expect(problems[0].message).toMatch(/8\.0 MB/);
    expect(problems[0].message).toMatch(/5\.0 MB/);
    expect(problems[0].message).toMatch(/island 4G/);
  });
});

describe("a photograph too small to look good", () => {
  it("WARNS and never refuses", () => {
    /*
      The server asks for no dimensions at all, so refusing on this would be
      inventing a rule the API does not have. But a 400px picture stretched
      across a phone card is visibly soft, and the operator is the only person
      who can go and find a bigger one.
    */
    const problems = photoPreflight(file(), limits, {
      width: 640,
      height: 480,
    });
    expect(refuses(problems)).toBe(false);
    expect(problems[0].severity).toBe("warn");
    expect(problems[0].message).toMatch(/soft/);
  });

  it("says nothing about a picture big enough", () => {
    expect(
      photoPreflight(file(), limits, { width: 2000, height: 1500 }),
    ).toEqual([]);
  });

  it("measures the LONG edge, so a tall picture is not called small", () => {
    // 1200 tall is fine on a card even though its width is under the floor.
    expect(
      photoPreflight(file(), limits, { width: 800, height: 1200 }),
    ).toEqual([]);
  });
});

describe("a browser that could not read the file", () => {
  it("says so rather than swallowing it", () => {
    /*
      Same call the clip path makes: if the checks did not run, the operator
      should know the upload is on trust — not be told silently that everything
      was fine.
    */
    const problems = photoPreflight(file(), limits, {});
    expect(refuses(problems)).toBe(false);
    expect(problems.some((p) => /could not read/.test(p.message))).toBe(true);
  });

  it("still enforces the size, which needs no decoding", () => {
    const problems = photoPreflight(file({ size: 9 * MB }), limits, {});
    expect(refuses(problems)).toBe(true);
  });
});

describe("the order problems arrive in", () => {
  it("names the wrong KIND of file before anything about its size", () => {
    // A 200 MB `.mov` is the common mistake, and naming it beats a number.
    const problems = photoPreflight(
      file({ type: "video/quicktime", size: 200 * MB }),
      limits,
      {},
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toMatch(/not a photograph/);
  });
});
