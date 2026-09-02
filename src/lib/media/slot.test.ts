import { describe, expect, it } from "vitest";
import { decideSlot, identityOf, sameFile } from "./slot";

const reef = { name: "reef.mp4", size: 3 * 1024 * 1024, lastModified: 1000 };
const harbour = {
  name: "harbour.mp4",
  size: 2 * 1024 * 1024,
  lastModified: 2000,
};
/** Same name and size as reef, a different file: the corruption case. */
const reefReshot = { ...reef, lastModified: 3000 };

describe("decideSlot", () => {
  it("takes any file when nothing has been bound", () => {
    expect(decideSlot(null, harbour, null)).toEqual({ kind: "fresh" });
    expect(decideSlot(null, harbour, 0)).toEqual({ kind: "fresh" });
  });

  it("resumes the same file from the server's offset", () => {
    expect(decideSlot(reef, reef, 1_048_576)).toEqual({
      kind: "resume",
      uploaded: 1_048_576,
    });
  });

  it("resumes the same file from zero when the server could not be asked", () => {
    // The upload loop re-asks with HEAD before its first PATCH anyway.
    expect(decideSlot(reef, reef, null)).toEqual({
      kind: "resume",
      uploaded: 0,
    });
  });

  it("refuses a different file once the first one's bytes have landed", () => {
    expect(decideSlot(reef, harbour, 1_048_576)).toEqual({
      kind: "held",
      by: reef,
      uploaded: 1_048_576,
    });
  });

  it("refuses a same-named, same-sized file that is not the same file", () => {
    // This is the case that shipped a corrupt reel: the first megabytes of one
    // clip with the tail of another, and nothing between them able to notice.
    expect(decideSlot(reef, reefReshot, 2_097_152).kind).toBe("held");
  });

  it("rebinds when nothing of the first file ever landed", () => {
    expect(decideSlot(reef, harbour, 0)).toEqual({ kind: "fresh" });
  });

  it("treats not knowing as held, never as clean", () => {
    expect(decideSlot(reef, harbour, null)).toEqual({
      kind: "held",
      by: reef,
      uploaded: null,
    });
  });
});

describe("identityOf / sameFile", () => {
  it("reads name, size and modification time off a File", () => {
    const file = new File([new Uint8Array(12)], "clip.mp4", {
      type: "video/mp4",
      lastModified: 4242,
    });
    expect(identityOf(file)).toEqual({
      name: "clip.mp4",
      size: 12,
      lastModified: 4242,
    });
  });

  it("needs all three to agree", () => {
    expect(sameFile(reef, { ...reef })).toBe(true);
    expect(sameFile(reef, { ...reef, size: reef.size + 1 })).toBe(false);
    expect(sameFile(reef, { ...reef, name: "reef2.mp4" })).toBe(false);
    expect(sameFile(reef, reefReshot)).toBe(false);
  });
});
