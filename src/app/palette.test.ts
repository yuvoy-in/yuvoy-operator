import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The design system, enforced rather than asserted — the portal's copy of
 * the traveller app's guard. The tokens themselves are diffed byte for byte
 * by `pnpm tokens:check`; this covers how they are USED.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? walk(full)
      : /\.(tsx?|css)$/.test(name) && !name.endsWith(".gen.ts")
        ? [full]
        : [];
  });
}

/** Scan CODE, not prose: comments name the banned things constantly. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FILES = walk(SRC).filter((f) => !/\.test\.tsx?$/.test(f));
const read = (f: string) => stripComments(readFileSync(f, "utf8"));
const rel = (f: string) => f.replace(process.cwd() + "/", "");

describe("palette", () => {
  it("declares the v2.7 radius scale", () => {
    const css = read(join(SRC, "app/globals.css"));
    for (const token of [
      "--radius-tile: 0.75rem",
      "--radius-control: 1rem",
      "--radius-card: 1.5rem",
      "--radius-sheet: 2rem",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("keeps the marketing near-square out of the portal's controls (v2.7)", () => {
    // The portal is rounded, like the app. A 2px control here is the
    // marketing site's tell.
    const offenders = FILES.filter((f) => /rounded-edge/.test(read(f))).map(
      rel,
    );
    expect(offenders).toEqual([]);
  });

  it("maps every radius to a token", () => {
    const offenders = FILES.filter((f) => {
      const s = read(f);
      const arbitrary =
        s.match(/\brounded(?:-[trblse]{1,2})?-\[[^\]]*\]/g) ?? [];
      return arbitrary.some((v) => !v.includes("calc(var(--radius-"));
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it("never uses font-semibold — Satoshi ships no 600", () => {
    const offenders = FILES.filter((f) => /font-semibold/.test(read(f))).map(
      rel,
    );
    expect(offenders).toEqual([]);
  });

  it("never puts a display face at a weight other than 400", () => {
    const offenders = FILES.filter((f) =>
      /font-display[^"'`]*font-(medium|bold|black)/.test(read(f)),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it("uses no raw hex outside the token block", () => {
    // Three sanctioned locations: the @theme block, the single literal Next
    // needs for viewport.themeColor before CSS exists, and the boundary that
    // renders when the stylesheet itself may not have arrived.
    const ALLOWED = [
      "src/app/globals.css",
      "src/lib/site/theme.ts",
      "src/app/global-error.tsx",
    ];
    const offenders = FILES.filter((f) => /#[0-9a-fA-F]{6}\b/.test(read(f)))
      .map(rel)
      .filter((f) => !ALLOWED.includes(f));
    expect(offenders).toEqual([]);
  });

  /**
   * The lockup drawn for a dark surface, against the canvas token.
   *
   * This portal has no brand generator at all: `public/brand` is a hand-copy
   * of yuvoy-web's delivered art, and that art is drawn in `cream` and will
   * stay that way. So the regression is a single careless copy away, and it is
   * a quiet one — the drawing is right, the geometry is right, and only the
   * colour is a year out of date.
   *
   * It matters because a cream lockup beside white chrome text measures
   * 1.15:1: the "two whites" version of the failure v2.1 fixed when it merged
   * the two darks, which reads as a dirty logo rather than as a bug.
   */
  it("draws the dark-surface lockup in the canvas token", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    const paper = /--color-paper:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1];
    expect(paper, "--color-paper").toBeDefined();

    const mark = join(process.cwd(), "public/brand/yuvoy-lockup-on-dark.svg");
    const svg = readFileSync(mark, "utf8").toLowerCase();
    expect(svg, "the lockup does not use the canvas token").toContain(paper!);
    expect(svg, "the lockup is still drawn in the retired cream").not.toContain(
      "#f4efe4",
    );
  });

  it("keeps THEME_COLOR and the no-CSS boundary on the real tokens", () => {
    /*
      Both sides are READ from the @theme block, neither is typed here.

      The boundary's literals exist because a failed root layout may never have
      brought the stylesheet, so they are the one place a colour is written out
      by hand — which makes them the one place a colour can silently stop
      matching the token it stands in for. This test was half-written that way
      itself: it compared against a hard-coded light hex, so v2.9 renaming
      `cream` to `paper` would have kept it green while the boundary painted a
      colour the portal no longer uses anywhere.
    */
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    const token = (name: string) =>
      new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1];
    const forest = token("forest");
    const paper = token("paper");
    expect(forest, "--color-forest").toBeDefined();
    expect(paper, "--color-paper").toBeDefined();

    const theme = readFileSync(join(SRC, "lib/site/theme.ts"), "utf8");
    expect(/THEME_COLOR = "(#[0-9a-fA-F]{6})"/.exec(theme)?.[1]).toBe(forest);

    const boundary = read(join(SRC, "app/global-error.tsx"));
    const used = boundary.match(/#[0-9a-fA-F]{6}/g) ?? [];
    expect(
      used.length,
      "the boundary stopped stating its colours",
    ).toBeGreaterThan(0);
    for (const hex of used) {
      expect([forest, paper]).toContain(hex.toLowerCase());
    }
  });

  it("never puts text below the documented opacity floor", () => {
    const offenders = FILES.filter((f) =>
      /text-forest\/(0|5|10|15|20|25|30|35|40|45|50|55|60|65)\b|text-paper\/(0|5|10|15|20|25|30|35|40|45|50|55)\b/.test(
        read(f),
      ),
    ).map(rel);
    expect(offenders).toEqual([]);
  });
});
