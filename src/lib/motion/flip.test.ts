import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EASE } from ".";
import {
  dropLifted,
  fadeIn,
  followersOf,
  lift,
  MAX_SLIDES,
  slideFrom,
  topsOf,
} from "./flip";

/*
  Showing where things went (FLIP) and drawing what left where it stood.
  jsdom has no layout and no Web Animations, so both are given here: each
  element's top is read from `data-top`, and `animate` records what it was
  asked to play.
*/

type Played = {
  el: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
};
let played: Played[] = [];
const saved: Record<string, PropertyDescriptor | undefined> = {};

function reduce(on: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: on && query === "(prefers-reduced-motion: reduce)",
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  played = [];
  for (const key of ["getBoundingClientRect", "getClientRects", "animate"]) {
    saved[key] = Object.getOwnPropertyDescriptor(Element.prototype, key);
  }
  Object.defineProperties(Element.prototype, {
    getBoundingClientRect: {
      configurable: true,
      value(this: HTMLElement) {
        const top = Number(this.dataset?.top ?? 0);
        return {
          top,
          left: 0,
          width: 300,
          height: 40,
          right: 300,
          bottom: top + 40,
          x: 0,
          y: top,
        } as DOMRect;
      },
    },
    getClientRects: {
      configurable: true,
      value(this: HTMLElement) {
        return this.dataset?.hidden === undefined ? [{}] : [];
      },
    },
    animate: {
      configurable: true,
      value(
        this: Element,
        frames: Keyframe[],
        options: KeyframeAnimationOptions,
      ) {
        played.push({ el: this, frames, options });
        return {
          finished: Promise.resolve(),
          cancel() {},
        } as unknown as Animation;
      },
    },
  });
  vi.stubGlobal("innerHeight", 800);
  reduce(false);
});

afterEach(() => {
  for (const [key, descriptor] of Object.entries(saved)) {
    if (descriptor) Object.defineProperty(Element.prototype, key, descriptor);
    else delete (Element.prototype as unknown as Record<string, unknown>)[key];
  }
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function page(html: string) {
  document.body.innerHTML = html;
  return (id: string) => document.getElementById(id) as HTMLElement;
}

describe("what a change pushes or pulls", () => {
  it("is everything after it, level by level, up to its scope", () => {
    const $ = page(`
      <section data-motion-scope id="scope">
        <div id="list"><p id="changed"></p><p id="next"></p></div>
        <p id="after"></p>
      </section>
      <footer id="outside"></footer>`);
    expect(followersOf($("changed")).map((el) => el.id)).toEqual([
      "next",
      "after",
    ]);
  });
});

describe("sliding from where things were", () => {
  it("plays each moved element back from its old top, on the move curve", () => {
    const $ = page(
      `<p id="a" data-top="100"></p><p id="b" data-top="200"></p>`,
    );
    const before = topsOf([$("a"), $("b")]);
    $("a").dataset.top = "160";
    $("b").dataset.top = "200";
    slideFrom(before);
    expect(played).toHaveLength(1);
    expect(played[0].el).toBe($("a"));
    expect(played[0].frames).toEqual([
      { transform: "translateY(-60px)" },
      { transform: "none" },
    ]);
    expect(played[0].options).toEqual({ duration: 200, easing: EASE.move });
  });

  it("moves nothing under reduced motion", () => {
    reduce(true);
    const $ = page(`<p id="a" data-top="100"></p>`);
    const before = topsOf([$("a")]);
    $("a").dataset.top = "300";
    slideFrom(before);
    expect(played).toHaveLength(0);
  });

  it("leaves alone what nobody can see, before or after", () => {
    const $ = page(`<p id="a" data-top="1200"></p>`);
    const before = topsOf([$("a")]);
    $("a").dataset.top = "1300";
    slideFrom(before);
    expect(played).toHaveLength(0);
  });

  it("skips what is not drawn, and what has left the page", () => {
    const $ = page(
      `<p id="a" data-top="100" data-hidden></p><p id="b" data-top="100"></p>`,
    );
    const before = topsOf([$("a"), $("b")]);
    expect(before.has($("a"))).toBe(false);
    $("b").remove();
    slideFrom(before);
    expect(played).toHaveLength(0);
  });

  it(`moves at most ${MAX_SLIDES} things at once`, () => {
    const ids = Array.from({ length: MAX_SLIDES + 3 }, (_, i) => `p${i}`);
    const $ = page(
      ids.map((id, i) => `<p id="${id}" data-top="${i * 50}"></p>`).join(""),
    );
    const before = topsOf(ids.map($));
    ids.forEach((id, i) => ($(id).dataset.top = String(i * 50 + 30)));
    slideFrom(before);
    expect(played).toHaveLength(MAX_SLIDES);
  });
});

describe("a held copy of what left", () => {
  it("is a picture: no ids, no names, inert and hidden from a screen reader", () => {
    const $ = page(`
      <form id="confirm" data-top="300">
        <h2 id="q">Call it off?</h2>
        <input type="radio" name="reasonCode" value="weather" checked>
        <textarea id="note" name="note"></textarea>
      </form>`);
    const lifted = lift($("confirm"))!;
    expect(lifted).not.toBeNull();
    const copy = lifted.copy;
    expect(copy.hasAttribute("id")).toBe(false);
    expect(copy.querySelectorAll("[id]")).toHaveLength(0);
    expect(copy.querySelectorAll("[name]")).toHaveLength(0);
    expect(copy.inert).toBe(true);
    expect(copy).toHaveAttribute("aria-hidden", "true");
    // The box ticked comes with it.
    expect((copy.querySelector("input") as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("is drawn where it stood and fades out accelerating away, then is gone", async () => {
    const $ = page(
      `<div id="was" data-top="300">Keep it</div><p id="anchor"></p>`,
    );
    const lifted = lift($("was"))!;
    $("was").remove();
    dropLifted(lifted, $("anchor"));
    expect(lifted.copy.isConnected).toBe(true);
    expect(lifted.copy.style.position).toBe("absolute");
    expect(lifted.copy.style.top).toBe("300px");
    expect(played.at(-1)!.options).toMatchObject({
      duration: 150,
      easing: EASE.exit,
      fill: "forwards",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(lifted.copy.isConnected).toBe(false);
  });

  it("fades in 120ms on a linear curve under reduced motion", () => {
    reduce(true);
    const $ = page(`<div id="was" data-top="10"></div><p id="anchor"></p>`);
    const lifted = lift($("was"))!;
    dropLifted(lifted, $("anchor"));
    expect(played.at(-1)!.options).toMatchObject({
      duration: 120,
      easing: "linear",
    });
  });

  it("goes at once where nothing can animate it", () => {
    const $ = page(`<div id="was" data-top="10"></div><p id="anchor"></p>`);
    const lifted = lift($("was"))!;
    delete (Element.prototype as unknown as Record<string, unknown>).animate;
    dropLifted(lifted, $("anchor"));
    expect(lifted.copy.isConnected).toBe(false);
  });
});

describe("fading in where it stands", () => {
  it("takes 150ms on the interaction curve, after a delay", () => {
    const $ = page(`<p id="a"></p>`);
    fadeIn($("a"), 100);
    expect(played[0].options).toEqual({
      duration: 150,
      delay: 100,
      easing: EASE.interaction,
      fill: "backwards",
    });
  });

  it("takes 120ms, linear and at once, under reduced motion", () => {
    reduce(true);
    const $ = page(`<p id="a"></p>`);
    fadeIn($("a"), 100);
    expect(played[0].options).toEqual({
      duration: 120,
      easing: "linear",
      fill: "backwards",
    });
  });
});
