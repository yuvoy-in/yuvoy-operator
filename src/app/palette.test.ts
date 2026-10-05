import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { twMerge } from "tailwind-merge";
import { cn } from "@/lib/cn";

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
          /\bmotion-(control|disc|press)\b/.test(text) ||
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

    /**
     * Every piece of text a `pendingLabel` can draw, from one file's code: a
     * string, the strings of an expression (a branch between two verbs), and
     * the words in a fragment (an icon beside the verb).
     */
    function pendingLabels(src: string): string[] {
      const out: string[] = [];
      for (const m of src.matchAll(/\bpendingLabel(?:=|\s*:\s*)/g)) {
        let i = m.index + m[0].length;
        while (/\s/.test(src[i] ?? "")) i += 1;
        const open = src[i];
        if (open === '"' || open === "'" || open === "`") {
          out.push(src.slice(i + 1, src.indexOf(open, i + 1)));
          continue;
        }
        if (open !== "{") continue;
        let depth = 0;
        let end = i;
        for (; end < src.length; end += 1) {
          if (src[end] === "{") depth += 1;
          if (src[end] === "}" && --depth === 0) break;
        }
        const expression = src.slice(i + 1, end);
        for (const [, , text] of expression.matchAll(
          /(["'`])((?:(?!\1)[^\n])*)\1/g,
        )) {
          out.push(text);
        }
        for (const [, text] of expression.matchAll(/>([^<>{}]+)</g)) {
          if (text.trim()) out.push(text.trim());
        }
      }
      return out;
    }

    it("names a busy button's working verb with no ellipsis (O04 A)", () => {
      /*
        The approved label is "Saving", with no ellipsis (O04 A, approved
        4 Oct 2026; yuvoy/motion-lab, experiments/o04-forms.js): the button
        keeps its colour and says it is busy, and the ring that turns beside
        the verb after 300ms is what says it is still going. Three dots said
        it a second time, in type. Read from every way a label reaches the
        busy button, so a branch or a fragment cannot slip one past.
      */
      let labels = 0;
      const offenders: string[] = [];
      for (const file of FILES.filter((f) => f.endsWith(".tsx"))) {
        for (const label of pendingLabels(read(file))) {
          labels += 1;
          if (/(?:…|\.\.\.)\s*$/.test(label)) {
            offenders.push(`${rel(file)}: "${label}"`);
          }
        }
      }
      expect(offenders).toEqual([]);
      expect(
        labels,
        "no working verbs found: the scan is looking in the wrong place",
      ).toBeGreaterThan(40);
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

/* ------------------------------------------------------------------ type */

/**
 * Brand Kit v3.2, three voices, enforced on every class string.
 *
 * A class string is a string literal in code (comments are already gone, see
 * `read`) or one `@apply` in a stylesheet, so a rule is judged within ONE
 * declaration and never across a file: a `font-display` in one utility once
 * matched a `font-bold` forty lines and six utilities later in globals.css,
 * and the old rule reported a violation that did not exist. Variant prefixes
 * are dropped, so `sm:text-lg` is still a size.
 */
function classStrings(src: string): string[][] {
  return classLiterals(src).map((s) =>
    s
      .split(/\s+/)
      .map((token) => token.replace(/^(?:[^[\]:]*:)+/, ""))
      .filter(Boolean),
  );
}

/** The same declarations as written, `${...}` blanked and variants kept. */
function classLiterals(src: string): string[] {
  const literals = [...src.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? "",
  );
  const applies = [...src.matchAll(/@apply\s+([^;]+);/g)].map((m) => m[1]);
  return [...literals, ...applies].map((s) => s.replace(/\$\{[^}]*\}/g, " "));
}

const WEIGHT =
  /^font-(thin|extralight|light|medium|semibold|bold|extrabold|black)$/;
const FACE = /^font-(sans|serif|mono|display|board|host)$/;
const TRACKING = /^tracking-/;
const CASE = /^(uppercase|lowercase|capitalize)$/;
const NUMERIC =
  /^(normal-nums|ordinal|slashed-zero|lining-nums|oldstyle-nums|proportional-nums|tabular-nums|diagonal-fractions|stacked-fractions)$/;
const SIZE = /^text-(xs|sm|base|lg|xl|[2-9]xl|\[[^\]]+\]|button|body)(\/\S+)?$/;

/**
 * The type classes a merge took out of one class string. cn() is
 * tailwind-merge, and a class it drops is dropped silently: under the stock
 * rule a size removed any `leading-*` before it, and the prettier plugin,
 * which does not know the theme, sorts `leading-display` ahead of `text-3xl`
 * in every headline (src/lib/cn.ts).
 */
function typeLosses(s: string, merge: (s: string) => string = cn): string[] {
  const kept = new Set(merge(s).split(/\s+/));
  return s.split(/\s+/).filter((token) => {
    const c = token.replace(/^(?:[^[\]:]*:)+/, "");
    return (
      (/^(leading|tracking|font)-/.test(c) || SIZE.test(c)) && !kept.has(token)
    );
  });
}

const TYPE_RULES: { rule: string; broken: (t: string[]) => boolean }[] = [
  {
    // Each cut is ONE baked instance registered at 400 (src/lib/fonts.ts): a
    // weight class makes the browser synthesise a bolder copy of a bold face.
    rule: "a baked cut at a weight class",
    broken: (t) =>
      t.some((c) => c === "font-display" || c === "font-board") &&
      t.some((c) => WEIGHT.test(c)),
  },
  {
    // The board is untracked. `tracking-normal` is that zero, written on a
    // figure inside a tracked headline, so it is the one tracking allowed.
    rule: "a figure on the board without tabular figures, or tracked",
    broken: (t) =>
      t.includes("font-board") &&
      (!t.includes("tabular-nums") ||
        t.some((c) => TRACKING.test(c) && c !== "tracking-normal")),
  },
  {
    rule: "a Yuvoy headline without its leading and its balance",
    broken: (t) =>
      t.includes("font-display") &&
      !(t.includes("leading-display") && t.includes("text-balance")),
  },
  {
    rule: "the headline leading without balance",
    broken: (t) => t.includes("leading-display") && !t.includes("text-balance"),
  },
  {
    rule: "running text without its pretty last line",
    broken: (t) =>
      (t.includes("leading-body") || t.includes("text-body")) &&
      !t.includes("text-pretty"),
  },
  {
    // `voice-host` pins Gotu's one weight, turns synthesis off, and sets its
    // own spacing, case and figures. Anything beside it is our voice leaking
    // into the host's words.
    rule: "the host's words in our weight, face, spacing, case or figures",
    broken: (t) =>
      t.includes("voice-host") &&
      t.some(
        (c) =>
          WEIGHT.test(c) ||
          FACE.test(c) ||
          TRACKING.test(c) ||
          CASE.test(c) ||
          NUMERIC.test(c),
      ),
  },
  {
    rule: "the host's face without voice-host",
    broken: (t) => t.includes("font-host"),
  },
  {
    // A label is 13/18 at every use, so it never sits beside a size: in the
    // cascade the size would win and the label would quietly change.
    rule: "a label or eyebrow resized",
    broken: (t) =>
      (t.includes("label") || t.includes("eyebrow")) &&
      t.some((c) => SIZE.test(c)),
  },
  {
    // A label is weight 500 at every use, as it is 13/18: a weight beside it
    // wins in the cascade and turns the label back into a heading.
    rule: "a label or eyebrow at another weight",
    broken: (t) =>
      (t.includes("label") || t.includes("eyebrow")) &&
      t.some((c) => WEIGHT.test(c)),
  },
  {
    // `uppercase` on machine text (an IFSC, typed in either case) is the
    // data's own case rather than a voice, and it is never tracked.
    rule: "tracked capitals",
    broken: (t) =>
      t.some((c) => /^tracking-(wide|wider|widest|label)$/.test(c)) ||
      (t.includes("uppercase") && !t.includes("font-mono")),
  },
];

describe("type", () => {
  it("keeps the three voices in every class string", () => {
    const offenders = FILES.flatMap((f) =>
      classStrings(read(f)).flatMap((tokens) =>
        TYPE_RULES.filter(({ broken }) => broken(tokens)).map(
          ({ rule }) => `${rel(f)}: ${rule}: "${tokens.join(" ")}"`,
        ),
      ),
    );
    expect(offenders).toEqual([]);
  });

  /*
    Each rule, shown firing on the defect it exists for and quiet on the
    shape it allows, so a rule that stops matching fails here rather than
    passing silently over the whole tree.
  */
  it.each([
    [
      "font-display tracking-display leading-display text-balance font-bold",
      "a baked cut at a weight class",
    ],
    [
      "font-board text-3xl leading-none tabular-nums font-bold",
      "a baked cut at a weight class",
    ],
    [
      "font-board text-3xl leading-none",
      "a figure on the board without tabular figures, or tracked",
    ],
    [
      "font-board tracking-display text-3xl tabular-nums",
      "a figure on the board without tabular figures, or tracked",
    ],
    [
      "font-display tracking-display text-3xl leading-tight",
      "a Yuvoy headline without its leading and its balance",
    ],
    [
      "voice-host leading-display text-3xl",
      "the headline leading without balance",
    ],
    [
      "text-forest/70 text-body mt-3",
      "running text without its pretty last line",
    ],
    ["voice-host leading-body", "running text without its pretty last line"],
    [
      "voice-host text-base font-bold",
      "the host's words in our weight, face, spacing, case or figures",
    ],
    [
      "voice-host font-display text-3xl",
      "the host's words in our weight, face, spacing, case or figures",
    ],
    [
      "voice-host tracking-wide text-sm",
      "the host's words in our weight, face, spacing, case or figures",
    ],
    [
      "voice-host tabular-nums",
      "the host's words in our weight, face, spacing, case or figures",
    ],
    ["font-host text-sm", "the host's face without voice-host"],
    ["label text-forest/75 text-xs", "a label or eyebrow resized"],
    ["eyebrow text-terra-deep sm:text-sm", "a label or eyebrow resized"],
    ["label text-[11px] font-bold", "a label or eyebrow resized"],
    ["label text-forest/75 font-bold", "a label or eyebrow at another weight"],
    [
      "eyebrow text-terra-deep font-medium",
      "a label or eyebrow at another weight",
    ],
    ["text-xs font-bold uppercase", "tracked capitals"],
    ["label tracking-wider", "tracked capitals"],
    ["font-mono text-sm tracking-wider", "tracked capitals"],
    ["font-mono uppercase tracking-widest", "tracked capitals"],
  ])("fires on %j: %s", (planted, rule) => {
    const fired = classStrings(`"${planted}"`).flatMap((tokens) =>
      TYPE_RULES.filter(({ broken }) => broken(tokens)).map((r) => r.rule),
    );
    expect(fired).toContain(rule);
  });

  it.each([
    "font-display tracking-display leading-display text-3xl text-balance sm:text-4xl",
    "font-board mt-2 text-3xl leading-tight tabular-nums",
    "font-board tracking-normal tabular-nums",
    "voice-host text-paper leading-display line-clamp-3 text-3xl text-balance",
    "voice-host text-forest/70 leading-body mt-3 max-w-prose text-sm text-pretty",
    "text-forest/70 text-body mt-3 max-w-prose text-pretty",
    "label text-forest/75",
    "eyebrow text-terra-deep",
    "text-button font-bold",
    "tracking-ref text-lg font-bold slashed-zero tabular-nums",
    "mt-2 font-mono uppercase",
  ])("allows %j", (allowed) => {
    const fired = classStrings(`"${allowed}"`).flatMap((tokens) =>
      TYPE_RULES.filter(({ broken }) => broken(tokens)).map((r) => r.rule),
    );
    expect(fired).toEqual([]);
  });

  it("keeps every type class in a string that passes through cn", () => {
    const offenders = FILES.filter((f) => !f.endsWith(".css")).flatMap((f) =>
      classLiterals(read(f)).flatMap((s) =>
        typeLosses(s).map((lost) => `${rel(f)}: "${s.trim()}" loses ${lost}`),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("would catch the stock merge dropping a headline's leading", () => {
    const headline = "font-display leading-tight text-3xl text-balance";
    expect(typeLosses(headline, twMerge)).toEqual(["leading-tight"]);
    expect(typeLosses(headline)).toEqual([]);
    expect(typeLosses("text-sm sm:text-base leading-body text-pretty")).toEqual(
      [],
    );
  });

  it("sets no tracked capitals in a stylesheet either", () => {
    const offenders = FILES.filter((f) => f.endsWith(".css"))
      .filter((f) =>
        /text-transform:\s*uppercase|--tracking-label\b/.test(read(f)),
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("reads class strings from code and from @apply, one declaration each", () => {
    expect(
      classStrings(
        '<p className="label text-xs">\n@apply font-board tabular-nums;',
      ),
    ).toEqual([
      ["label", "text-xs"],
      ["font-board", "tabular-nums"],
    ]);
    expect(
      classStrings('cn("text-body", `sm:${x} hover:text-pretty`)'),
    ).toEqual([["text-body"], ["text-pretty"]]);
  });
});
