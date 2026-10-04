import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { Roll } from "./roll";

/*
  A figure that rolls to its new value (O07 A, approved 4 Oct 2026): up as it
  grows, down as it falls; a cross-fade under reduced motion.
*/
type Played = {
  el: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
};
let played: Played[] = [];

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
  Element.prototype.animate = function (
    this: Element,
    frames: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    played.push({ el: this, frames, options });
    return { finished: Promise.resolve(), cancel() {} } as unknown as Animation;
  } as typeof Element.prototype.animate;
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 72,
  });
  reduce(false);
});
afterEach(() => {
  delete (Element.prototype as unknown as Record<string, unknown>).animate;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)
    .offsetHeight;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a figure that rolls", () => {
  it("draws its first number still", () => {
    render(<Roll value={3} />);
    expect(played).toHaveLength(0);
  });

  it("rolls up as it grows: the new number from below, the old one away above", () => {
    const { rerender, container } = render(<Roll value={3} />);
    rerender(<Roll value={5} />);
    const [now, old] = played;
    expect(now.frames[0]).toEqual({
      opacity: 0,
      transform: "translateY(43.199999999999996px)",
    });
    expect(now.options).toMatchObject({ duration: 200 });
    expect(old.frames.at(-1)).toEqual({
      opacity: 0,
      transform: "translateY(-43.199999999999996px)",
    });
    expect(old.options).toMatchObject({ duration: 150, fill: "forwards" });
    // Its text is the one number while the old one leaves.
    expect(container.textContent).toBe("5");
  });

  it("rolls down as it falls", () => {
    const { rerender } = render(<Roll value={5} />);
    rerender(<Roll value={3} />);
    expect(String(played[0].frames[0].transform)).toMatch(/^translateY\(-/);
  });

  it("cross-fades in 120ms under reduced motion, with nothing travelling", () => {
    reduce(true);
    const { rerender } = render(<Roll value={3} />);
    rerender(<Roll value={4} />);
    expect(played.every((p) => p.options.duration === 120)).toBe(true);
    expect(played.some((p) => p.frames.some((f) => "transform" in f))).toBe(
      false,
    );
  });

  it("rolls a fall once, and letting the old number go replays nothing", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Roll value={5} />);
    rerender(<Roll value={3} />);
    const rolled = played.length;
    act(() => vi.advanceTimersByTime(250));
    expect(played).toHaveLength(rolled);
  });

  it("lets the old number go once it has rolled away", () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<Roll value={3} />);
    rerender(<Roll value={4} />);
    expect(container.querySelector("[data-was]")).not.toBeNull();
    act(() => vi.advanceTimersByTime(250));
    expect(container.querySelector("[data-was]")).toBeNull();
  });
});
