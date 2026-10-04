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

  it("never uses font-semibold: the type system has three weights", () => {
    // 400, 500 and 700, and nothing between (yuvoy-app docs/DESIGN_SYSTEM.md v3.0).
    const offenders = FILES.filter((f) => /font-semibold/.test(read(f))).map(
      rel,
    );
    expect(offenders).toEqual([]);
  });

  it("never puts the display face at a weight other than its own", () => {
    // One baked condensed-bold cut, registered at 400 (src/lib/fonts.ts): a
    // heavier class would make the browser synthesise a bolder copy.
    const offenders = FILES.filter((f) =>
      /*
        Within ONE declaration, not across the file (the fix yuvoy-app made to
        its own copy of this rule). `[^"'`]*` spans a single class string in a
        `.tsx`, but in `globals.css` it ran from `--font-display` to the next
        quote, dozens of lines on, and matched a `font-bold` in an unrelated
        utility. Excluding `;` and the braces bounds it to one declaration; a
        real offender (`font-display font-bold` in one string or one `@apply`)
        still has nothing between them to stop it.
      */
      /font-display[^"'`;{}]*font-(medium|bold|black)/.test(read(f)),
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
   * The mark drawn for a dark surface, against the canvas token.
   *
   * This portal has no brand generator at all: `public/brand` is a hand-copy
   * of yuvoy-app's compact mark, generated there from yuvoy-web's delivered
   * art, and that art is drawn in `cream` and will stay that way. So the
   * regression is a single careless copy away, and it is a quiet one: the
   * drawing is right, the geometry is right, and only the colour is a year
   * out of date.
   *
   * It matters because a cream mark beside white chrome text measures
   * 1.15:1: the "two whites" version of the failure v2.1 fixed when it merged
   * the two darks, which reads as a dirty logo rather than as a bug.
   *
   * The compact mark since yuvoy-operator#80 t1: the tagline lockup this used
   * to read is gone from the portal, and `Wordmark` draws only this file.
   */
  it("draws the dark-surface mark in the canvas token", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    const paper = /--color-paper:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1];
    expect(paper, "--color-paper").toBeDefined();

    const mark = join(
      process.cwd(),
      "public/brand/yuvoy-mark-compact-on-dark.svg",
    );
    const svg = readFileSync(mark, "utf8").toLowerCase();
    expect(svg, "the mark does not use the canvas token").toContain(paper!);
    expect(svg, "the mark is still drawn in the retired cream").not.toContain(
      "#f4efe4",
    );
    // And it is the mark alone: the tagline and its underline are not in it.
    expect(svg, "the mark still carries the tagline").not.toMatch(
      /experience more/i,
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

  describe("motion (the system approved 4 Oct 2026, yuvoy/motion-lab)", () => {
    /**
     * Each class-ish string literal in component source, so a `duration-` is
     * only ever read with the curve written in the SAME className.
     */
    function literals(): { where: string; text: string }[] {
      return FILES.filter((f) => /\.tsx?$/.test(f)).flatMap((file) =>
        [...read(file).matchAll(/"[^"\n]*"|`[^`\n]*`/g)].map(([text]) => ({
          where: rel(file),
          text,
        })),
      );
    }

    /** `150ms`, `1.6s` and `0.001ms`, as milliseconds. */
    const ms = (value: string, unit: string) =>
      unit === "s" ? Number(value) * 1000 : Number(value);

    /**
     * Every duration the stylesheet declares, item by item: the first time in
     * a `transition` or `animation` item is its duration (a second one is its
     * delay), and a `-duration` longhand lists them outright. A `var()` is
     * set from script (the undo window's length is the store's own constant)
     * and is not a literal to read.
     */
    function cssDurations(): {
      where: string;
      ms: number;
      progress: boolean;
      name: string;
    }[] {
      const css = read(join(SRC, "app/globals.css"));
      const out: {
        where: string;
        ms: number;
        progress: boolean;
        name: string;
      }[] = [];
      for (const [whole, property, longhand, value] of css.matchAll(
        /\b(transition|animation)(-duration)?\s*:\s*([^;{}]+);/g,
      )) {
        // Split on the commas between items, not those inside a function.
        const items: string[] = [];
        let depth = 0;
        let item = "";
        for (const ch of value) {
          if (ch === "(") depth += 1;
          if (ch === ")") depth -= 1;
          if (ch === "," && depth === 0) {
            items.push(item);
            item = "";
          } else item += ch;
        }
        items.push(item);
        for (const one of items) {
          const times = [...one.matchAll(/(-?\d*\.?\d+)(ms|s)\b/g)];
          const durations = longhand ? times : times.slice(0, 1);
          for (const [, n, unit] of durations) {
            out.push({
              where: `${property}${longhand ?? ""}: ${whole.trim()}`,
              ms: ms(n, unit),
              progress: /\blinear\b|\bsteps\(/.test(one),
              name: property === "animation" && !longhand ? one.trim() : "",
            });
          }
        }
      }
      return out;
    }

    /*
      The one motion the study left running past the ceiling on a curve: the
      skeleton's sweep, a loading loop. No operator experiment changed loading
      (the traveller's T11 did, for the traveller). A Map, so an exemption
      cannot be added without writing down why.
    */
    const LOOPS_LEFT_AS_THEY_WERE = new Map([
      [
        "skeleton-sweep",
        "The route skeletons' light sweep: loading, left as it was. No operator experiment changed loading.",
      ],
    ]);

    it("keeps every motion inside the portal's 200ms ceiling, but progress", () => {
      /*
        The portal's budget (motion-system.md, section 14): 200ms for
        anything but progress, because an operator does each of these
        dozens of times a shift with a queue at the boat. Progress is what
        is allowed to be long, and it is the information: the five-second
        undo window draining, a spinner turning, the mark fading on a
        linear curve. So a long duration is allowed only beside `linear` or
        `steps()`, in the same className or the same CSS item.

        Read where the rule can actually be broken: the Tailwind classes in
        component source, the durations written by hand in globals.css, and
        an inline style that names one.
      */
      let checked = 0;
      for (const { where, text } of literals()) {
        const progress = /\bease-linear\b/.test(text);
        for (const [, n] of text.matchAll(/\bduration-(\d+)\b/g)) {
          checked += 1;
          if (progress) continue;
          expect(
            Number(n),
            `${where}: duration-${n} is over the portal's 200ms ceiling`,
          ).toBeLessThanOrEqual(200);
        }
        for (const [, n, unit] of text.matchAll(
          /\bduration-\[(\d*\.?\d+)(ms|s)\]/g,
        )) {
          checked += 1;
          if (progress) continue;
          expect(
            ms(n, unit),
            `${where}: duration-[${n}${unit}] is over the ceiling`,
          ).toBeLessThanOrEqual(200);
        }
        /*
          A Tailwind animation names no duration in its class: `pulse` is 2s
          and `bounce` 1s on a curve, and neither is progress. `spin` is a
          linear turn, which is.
        */
        const named = /\banimate-(?!spin\b|none\b)([a-z-]+)/.exec(text);
        expect(
          named,
          `${where}: animate-${named?.[1]} carries a duration over the ceiling`,
        ).toBeNull();
      }
      for (const file of FILES.filter((f) => f.endsWith(".tsx"))) {
        for (const [, n, unit] of read(file).matchAll(
          /(?:transition|animation)Duration:\s*["'`](\d*\.?\d+)(ms|s)/g,
        )) {
          checked += 1;
          expect(
            ms(n, unit),
            `${rel(file)}: an inline duration over the ceiling`,
          ).toBeLessThanOrEqual(200);
        }
      }
      for (const { where, ms: duration, progress, name } of cssDurations()) {
        checked += 1;
        if (progress) continue;
        const loop = [...LOOPS_LEFT_AS_THEY_WERE.keys()].find((key) =>
          new RegExp(`^${key}\\b`).test(name),
        );
        if (loop) continue;
        expect(
          duration,
          `globals.css ${where} is over the portal's 200ms ceiling`,
        ).toBeLessThanOrEqual(200);
      }
      expect(
        checked,
        "no durations found to check: the scan is looking in the wrong place",
      ).toBeGreaterThan(20);
    });

    it("runs every script motion through lib/motion, on its named durations", () => {
      /*
        A Web Animations call cannot read the stylesheet, so its timing is
        script, and script is where a 400ms "it felt nicer" goes unseen.
        Every call goes through `play()` in lib/motion, whose durations are
        pinned by motion.test.ts, and nothing outside it writes a number of
        milliseconds into one.
      */
      let scanned = 0;
      for (const file of FILES) {
        if (/[/\\]lib[/\\]motion[/\\]/.test(file)) continue;
        const src = read(file);
        scanned += 1;
        expect(
          /\.animate\(/.test(src),
          `${rel(file)}: calls animate() directly. Use play() from lib/motion.`,
        ).toBe(false);
        if (!/\bplay\(/.test(src)) continue;
        expect(
          /\bduration:\s*\d/.test(src),
          `${rel(file)}: writes a duration by hand. Use DURATION from lib/motion.`,
        ).toBe(false);
      }
      expect(
        scanned,
        "no files found to check: the scan is looking in the wrong place",
      ).toBeGreaterThan(50);
    });

    it("lets every press animate the property it presses with", () => {
      /*
        Tailwind 4 writes `active:scale-*` to the standalone `scale` property.
        Every press in the portal used to sit beside a transition list naming
        only `transform`, so all of them snapped in and snapped back, and no
        test noticed because each class string looked right on its own
        (found by the motion study, 4 Oct 2026). A press must share its
        string with a list that names `scale`: one of the motion utilities,
        `transition-transform` (which covers translate, scale and rotate in
        Tailwind 4), or an explicit list.
      */
      let presses = 0;
      for (const { where, text } of literals()) {
        if (!/\bactive:scale-/.test(text)) continue;
        presses += 1;
        const animates =
          /\bmotion-(control|disc)\b/.test(text) ||
          /\btransition-transform\b/.test(text) ||
          /\btransition-\[[^\]]*\bscale\b/.test(text);
        expect(
          animates,
          `${where}: "${text.slice(1, 80)}" presses with a scale nothing animates`,
        ).toBe(true);
      }
      expect(
        presses,
        "no presses found: the scan is looking in the wrong place",
      ).toBeGreaterThan(2);
    });
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
