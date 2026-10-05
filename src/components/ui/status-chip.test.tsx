import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { StatusChip } from "./status-chip";

/*
  A booking's state, seen to change (O03 A, approved 4 Oct 2026): the words
  cross-fade and the pill's edge eases to its new width, as a clip. The
  first words simply appear.
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
  saved.offsetWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetWidth",
  );
  // A chip is as wide as its words, near enough: 7px a letter.
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return (this.textContent ?? "").length * 7;
    },
  });
  Element.prototype.animate = function (
    this: Element,
    frames: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    played.push({ el: this, frames, options });
    return { finished: Promise.resolve(), cancel() {} } as unknown as Animation;
  } as typeof Element.prototype.animate;
  reduce(false);
});

afterEach(() => {
  if (saved.offsetWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      saved.offsetWidth,
    );
  }
  delete (Element.prototype as unknown as Record<string, unknown>).animate;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a booking's state, as it changes", () => {
  it("draws the first words still", () => {
    const { container } = render(
      <StatusChip label="Collect ₹9,000" tone="accent" />,
    );
    expect(container.querySelector(".motion-in, .motion-out")).toBeNull();
    expect(played).toHaveLength(0);
  });

  it("cross-fades the words: the old ones leave, hidden from a screen reader", () => {
    const { rerender, container } = render(
      <StatusChip label="Collect ₹9,000" tone="accent" />,
    );
    rerender(<StatusChip label="Confirmed" tone="accent" />);
    const now = screen.getByText("Confirmed");
    expect(now).toHaveClass("motion-in");
    expect(now).toHaveAttribute("data-motion");
    const old = container.querySelector("[data-chip-was]");
    // Drawn from an attribute: the row's text is still its one state.
    expect(old).toHaveAttribute("data-chip-was", "Collect ₹9,000");
    expect(old).toHaveTextContent(/^$/);
    expect(container.textContent).toBe("Confirmed");
    expect(old).toHaveClass("motion-out");
    expect(old).toHaveAttribute("aria-hidden", "true");
  });

  it("eases a narrower chip's edge in, on the old chip, over 200ms", () => {
    const { rerender, container } = render(
      <StatusChip label="Collect ₹9,000" tone="accent" />,
    );
    rerender(<StatusChip label="Confirmed" tone="accent" />);
    const old = container.querySelector("[data-chip-was]");
    const edge = played.find((p) => p.el === old);
    expect(edge).toBeDefined();
    // 14 letters to 9: the edge travels 35px.
    expect(edge!.frames).toEqual([
      { clipPath: "inset(0px 0px 0px 0px round 9999px)" },
      { clipPath: "inset(0px 0px 0px 35px round 9999px)" },
    ]);
    expect(edge!.options).toMatchObject({ duration: 200 });
  });

  it("eases a wider chip's edge out, on the new chip", () => {
    const { rerender } = render(<StatusChip label="Confirmed" tone="accent" />);
    rerender(<StatusChip label="Checked in on time" tone="accent" />);
    const now = screen.getByText("Checked in on time");
    const edge = played.find((p) => p.el === now);
    expect(edge!.frames[0]).toEqual({
      clipPath: "inset(0px 0px 0px 63px round 9999px)",
    });
  });

  it("moves no edge under reduced motion, and still cross-fades", () => {
    reduce(true);
    const { rerender, container } = render(
      <StatusChip label="Collect ₹9,000" tone="accent" />,
    );
    rerender(<StatusChip label="Confirmed" tone="neutral" />);
    expect(played).toHaveLength(0);
    expect(container.querySelector("[data-chip-was]")).not.toBeNull();
  });

  it("lets the old words go once the change has played", () => {
    vi.useFakeTimers();
    const { rerender, container } = render(
      <StatusChip label="Confirmed" tone="accent" />,
    );
    rerender(<StatusChip label="Checked in" tone="accent" />);
    act(() => vi.advanceTimersByTime(250));
    expect(container.querySelector("[data-chip-was]")).toBeNull();
    expect(screen.getByText("Checked in")).toBeInTheDocument();
  });
});
