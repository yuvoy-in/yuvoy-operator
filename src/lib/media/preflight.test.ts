import { describe, it, expect } from "vitest";
import {
  formatBytes,
  parseAspectRatio,
  preflight,
  refuses,
  type LocalVideoFacts,
} from "./preflight";

const LIMITS = {
  maxBytes: 200 * 1024 * 1024,
  maxSeconds: 60,
  aspectRatio: "9:16",
};

const file = (
  over: Partial<{ name: string; size: number; type: string }> = {},
) => ({
  name: "reef.mp4",
  size: 40 * 1024 * 1024,
  type: "video/mp4",
  ...over,
});

const messages = (facts: LocalVideoFacts, over = {}) =>
  preflight(file(over), LIMITS, facts).map((p) => p.message);

/**
 * The uplink is 0.5–3 Mbps. Everything here is about not spending twenty
 * minutes of somebody's morning discovering something a browser knew in
 * milliseconds.
 */
describe("before a byte leaves the phone", () => {
  it("passes an ordinary upright clip with nothing to say", () => {
    expect(
      preflight(file(), LIMITS, { seconds: 22, width: 1080, height: 1920 }),
    ).toEqual([]);
  });

  it("refuses a file that is not a video, and names what it is", () => {
    const p = preflight(file({ type: "image/heic" }), LIMITS, {});
    expect(refuses(p)).toBe(true);
    expect(p[0].message).toContain("image");
  });

  it("refuses an empty file before anything else", () => {
    expect(preflight(file({ size: 0 }), LIMITS, {})).toEqual([
      { severity: "refuse", message: "That file is empty." },
    ]);
  });

  it("refuses one over the limit and says both numbers", () => {
    const p = preflight(file({ size: 260 * 1024 * 1024 }), LIMITS, {});
    expect(refuses(p)).toBe(true);
    expect(p[0].message).toContain("260 MB");
    expect(p[0].message).toContain("200 MB");
  });

  it("uses the limits it was given, never a hardcoded one", () => {
    // The server decides. A client with its own idea of the ceiling refuses
    // good footage the day the ceiling moves.
    const p = preflight(
      file({ size: 9 * 1024 * 1024 }),
      { ...LIMITS, maxBytes: 8 * 1024 * 1024 },
      {},
    );
    expect(refuses(p)).toBe(true);
  });

  it("refuses a clip that is too long, once it knows the length", () => {
    expect(messages({ seconds: 95 })).toContainEqual(
      expect.stringContaining("95 seconds"),
    );
    expect(refuses(preflight(file(), LIMITS, { seconds: 95 }))).toBe(true);
  });

  it("refuses landscape, because the feed is upright", () => {
    const p = preflight(file(), LIMITS, {
      seconds: 20,
      width: 1920,
      height: 1080,
    });
    expect(refuses(p)).toBe(true);
    expect(p[0].message).toContain("sideways");
  });

  it("accepts every upright phone shape, not just exactly 9:16", () => {
    /*
      1080×1920 is 0.5625 and a 1284×2778 iPhone frame is 0.4622. Both are
      "somebody held their phone up", which is what the feed wants — a
      tolerance rather than an equality.
    */
    expect(
      preflight(file(), LIMITS, { seconds: 20, width: 1284, height: 2778 }),
    ).toEqual([]);
    expect(
      preflight(file(), LIMITS, { seconds: 20, width: 1080, height: 1920 }),
    ).toEqual([]);
    // 2:3, a common vertical crop.
    expect(
      preflight(file(), LIMITS, { seconds: 20, width: 1200, height: 1800 }),
    ).toEqual([]);
  });

  it("warns rather than refuses a merely off upright shape", () => {
    // 3:4 — held up, but squarer than the feed. Croppable, not wrong.
    const p = preflight(file(), LIMITS, {
      seconds: 20,
      width: 1200,
      height: 1600,
    });
    expect(refuses(p)).toBe(false);
    expect(p[0].message).toContain("cropped");
  });

  it("does not refuse a file this browser could not decode", () => {
    /*
      A phone's HEVC clip is something one browser reads and another does not,
      and Cloudflare handles both. Refusing good footage because the local
      decoder shrugged would be rejecting it for a reason that has nothing to
      do with the footage — so it warns, says the checks did not run, and lets
      the upload go.
    */
    const p = preflight(file(), LIMITS, {});
    expect(refuses(p)).toBe(false);
    expect(p[0].message).toContain("could not read the video");
  });

  it("says nothing about shape when the server did not ask for one", () => {
    const p = preflight(
      file(),
      { maxBytes: LIMITS.maxBytes, maxSeconds: 60 },
      {
        seconds: 20,
        width: 1920,
        height: 1080,
      },
    );
    expect(p).toEqual([]);
  });
});

describe("reading the server's aspect ratio", () => {
  it("parses the shapes the contract might send", () => {
    expect(parseAspectRatio("9:16")).toBeCloseTo(0.5625);
    expect(parseAspectRatio("9/16")).toBeCloseTo(0.5625);
    expect(parseAspectRatio(" 9 : 16 ")).toBeCloseTo(0.5625);
  });

  it("returns null rather than guessing", () => {
    // A wrong guess here silently refuses every clip an operator owns.
    expect(parseAspectRatio(undefined)).toBeNull();
    expect(parseAspectRatio("vertical")).toBeNull();
    expect(parseAspectRatio("9:0")).toBeNull();
    expect(parseAspectRatio("")).toBeNull();
  });
});

describe("sizes an operator can read", () => {
  it("keeps one decimal until it stops meaning anything", () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatBytes(48 * 1024 * 1024)).toBe("48 MB");
    expect(formatBytes(400 * 1024)).toBe("400 KB");
  });
});
