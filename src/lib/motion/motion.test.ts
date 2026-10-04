import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DURATION,
  EASE,
  finished,
  play,
  prefersReducedMotion,
  SHOW_DELAY_MS,
} from ".";

/**
 * The curves exist twice: as `--ease-*` tokens in the stylesheet (what CSS
 * transitions use) and as strings here (what a Web Animations call needs,
 * because it cannot read `var()`). Two copies of a value drift; this is what
 * keeps them one.
 */
describe("the motion tokens", () => {
  const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");
  const theme = css.slice(
    css.indexOf("@theme {"),
    css.indexOf("\n}", css.indexOf("@theme {")),
  );

  it.each(Object.entries(EASE))(
    "--ease-%s matches the stylesheet",
    (name, value) => {
      const m = new RegExp(`--ease-${name}:\\s*([^;]+);`).exec(theme);
      expect(m, `--ease-${name} is missing from @theme`).not.toBeNull();
      const squash = (v: string) => v.replace(/\s+/g, "");
      expect(squash(m![1])).toBe(squash(value));
    },
  );

  it("keeps every duration inside the portal's ceiling, but the mark", () => {
    /*
      200ms is the ceiling for anything but progress (motion-system.md,
      section 14). The mark is the one exception, and it is opacity on a
      linear curve: a highlight that decays, not a motion.
    */
    for (const [name, ms] of Object.entries(DURATION)) {
      if (name === "mark") continue;
      expect(ms, `DURATION.${name}`).toBeLessThanOrEqual(200);
    }
    expect(DURATION.mark).toBe(1200);
    expect(SHOW_DELAY_MS).toBe(300);
  });
});

describe("reading the preference", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is false where there is nothing to ask", () => {
    // jsdom has no matchMedia: the instant path's sibling, never more motion.
    expect(prefersReducedMotion()).toBe(false);
  });

  it("asks the system when it can", () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)",
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe("playing an animation", () => {
  it("is nothing, and already finished, where an element cannot animate", async () => {
    const el = document.createElement("div");
    // jsdom has no Web Animations.
    expect(play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 })).toBe(
      null,
    );
    await expect(finished(null)).resolves.toBeUndefined();
  });

  it("hands the element its frames and timing where it can", () => {
    const el = document.createElement("div");
    const animation = { finished: Promise.resolve() } as unknown as Animation;
    const animate = vi.fn(() => animation);
    el.animate = animate as unknown as typeof el.animate;
    const frames = [{ opacity: 0 }, { opacity: 1 }];
    expect(play(el, frames, { duration: 150, easing: EASE.interaction })).toBe(
      animation,
    );
    expect(animate).toHaveBeenCalledWith(frames, {
      duration: 150,
      easing: EASE.interaction,
    });
  });

  it("settles whether the animation ends or is cancelled", async () => {
    const cancelled = {
      finished: Promise.reject(new DOMException("cancelled", "AbortError")),
    } as unknown as Animation;
    await expect(finished(cancelled)).resolves.toBeUndefined();
  });
});
