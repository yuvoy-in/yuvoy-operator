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

  it("keeps THEME_COLOR and the no-CSS boundary on the forest token", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    const forest = /--color-forest:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1];
    const theme = readFileSync(join(SRC, "lib/site/theme.ts"), "utf8");
    expect(/THEME_COLOR = "(#[0-9a-fA-F]{6})"/.exec(theme)?.[1]).toBe(forest);
    const boundary = read(join(SRC, "app/global-error.tsx"));
    for (const hex of boundary.match(/#[0-9a-fA-F]{6}/g) ?? []) {
      expect([forest, "#f4efe4"]).toContain(hex.toLowerCase());
    }
  });

  it("never puts text below the documented opacity floor", () => {
    const offenders = FILES.filter((f) =>
      /text-forest\/(0|5|10|15|20|25|30|35|40|45|50|55|60|65)\b|text-cream\/(0|5|10|15|20|25|30|35|40|45|50|55)\b/.test(
        read(f),
      ),
    ).map(rel);
    expect(offenders).toEqual([]);
  });
});
