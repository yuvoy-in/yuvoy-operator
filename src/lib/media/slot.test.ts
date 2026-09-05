import { describe, expect, it } from "vitest";
import { decideSlot, identityOf, sameFile, type ServerSlot } from "./slot";

const reef = { name: "reef.mp4", size: 3 * 1024 * 1024, lastModified: 1000 };
const harbour = {
  name: "harbour.mp4",
  size: 2 * 1024 * 1024,
  lastModified: 2000,
};
/** Same name and size as reef, a different file: the corruption case. */
const reefReshot = { ...reef, lastModified: 3000 };

const MB = 1024 * 1024;

/** What `HEAD` said, with the length header the provider may or may not expose. */
const holds = (offset: number, declaredLength: number | null): ServerSlot => ({
  offset,
  declaredLength,
});
/** The common real case: the provider does not expose `Upload-Length`. */
const holdsSilently = (offset: number) => holds(offset, null);

describe("decideSlot", () => {
  it("takes any file when the server holds nothing", () => {
    expect(decideSlot(null, harbour, holdsSilently(0))).toEqual({
      kind: "fresh",
    });
    expect(decideSlot(reef, harbour, holdsSilently(0))).toEqual({
      kind: "fresh",
    });
  });

  it("resumes the same file from the server's offset", () => {
    expect(decideSlot(reef, reef, holdsSilently(MB))).toEqual({
      kind: "resume",
      uploaded: MB,
    });
  });

  it("refuses a different file once the first one's bytes have landed", () => {
    expect(decideSlot(reef, harbour, holdsSilently(MB))).toEqual({
      kind: "held",
      by: reef,
      uploaded: MB,
    });
  });

  it("refuses a same-named, same-sized file that is not the same file", () => {
    // This is the case that shipped a corrupt reel: the first megabytes of one
    // clip with the tail of another, and nothing between them able to notice.
    expect(decideSlot(reef, reefReshot, holdsSilently(2 * MB)).kind).toBe(
      "held",
    );
  });

  it("says the upload server could not be asked, rather than guessing", () => {
    // The upload itself opens with the same HEAD, so this is the same refusal
    // said a moment earlier and in words that name the actual problem.
    expect(decideSlot(reef, reef, null)).toEqual({ kind: "unreachable" });
    expect(decideSlot(null, reef, null)).toEqual({ kind: "unreachable" });
  });

  /*
    The case yuvoy-api#66 §3 created, and the reason this file changed.

    `POST /media/upload-intents` now returns the upload in flight instead of a
    409, so a page that has just loaded can hold a URL for bytes it never sent.
    It has no binding — that lived in a closure that is gone — and the old rule
    read "no binding" as "clean slot". It would have resumed the newly chosen
    clip at the abandoned one's offset: one file's head, another's tail,
    attested and sent to a human reviewer.
  */
  describe("after a reload, with nothing bound in this page", () => {
    it("refuses a slot that already holds bytes it cannot identify", () => {
      expect(decideSlot(null, harbour, holdsSilently(MB))).toEqual({
        kind: "held",
        by: null,
        uploaded: MB,
      });
    });

    it("resumes when the browser remembered which file it was", () => {
      // `recallSlot` supplies `known` after a reload. See `slot-store.ts`.
      expect(decideSlot(reef, reef, holdsSilently(MB))).toEqual({
        kind: "resume",
        uploaded: MB,
      });
    });

    it("resumes on the server's own declared length when nothing remembers", () => {
      // Cleared storage, or a different device. The provider says how big the
      // file it is holding is, and it is this one.
      expect(decideSlot(null, reef, holds(MB, reef.size))).toEqual({
        kind: "resume",
        uploaded: MB,
      });
    });

    it("refuses when the declared length belongs to a different file", () => {
      expect(decideSlot(null, harbour, holds(MB, reef.size))).toEqual({
        kind: "held",
        by: null,
        uploaded: MB,
      });
    });
  });

  it("believes the server over a stale local record", () => {
    /*
      The binding says reef and the server says it is holding something of a
      different size. Our record is stale or about another upload entirely, and
      acting on it would resume into the wrong file with more confidence than a
      page that knew nothing at all.
    */
    expect(decideSlot(reef, reef, holds(MB, harbour.size))).toEqual({
      kind: "held",
      by: null,
      uploaded: MB,
    });
  });

  it("never returns fresh while the server holds bytes", () => {
    /*
      The invariant, asserted directly rather than inferred from the cases
      above: every combination of what is known and what the server declares
      must refuse or resume once a single byte has landed. A future branch that
      reintroduces "no binding means clean" fails here.
    */
    const knowns = [null, reef, harbour, reefReshot];
    const lengths = [null, reef.size, harbour.size, 1];
    for (const known of knowns) {
      for (const declared of lengths) {
        for (const picked of [reef, harbour]) {
          const decision = decideSlot(known, picked, holds(MB, declared));
          expect(decision.kind).not.toBe("fresh");
        }
      }
    }
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
