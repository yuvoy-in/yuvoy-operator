import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markChange } from "./mark";

/*
  The mark (O01, O03, O08): a forest tint laid over what changed, fading out
  over 1.2s, and gone afterwards with nothing left behind on the row.
*/
describe("marking what changed", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function row() {
    document.body.innerHTML = `<ul><li id="row">Asha Menon</li></ul>`;
    return document.getElementById("row") as HTMLElement;
  }

  it("lays a tint over the row that a screen reader never hears", () => {
    const el = row();
    markChange(el);
    const tint = el.querySelector(".motion-mark");
    expect(tint).not.toBeNull();
    expect(tint).toHaveAttribute("aria-hidden", "true");
    // Colour, not motion: it plays the same under reduced motion.
    expect(tint).toHaveAttribute("data-motion");
    expect(el).toHaveTextContent("Asha Menon");
  });

  it("makes the row its box while it is on it, and gives that back after", () => {
    const el = row();
    markChange(el);
    expect(el.style.position).toBe("relative");
    vi.advanceTimersByTime(1300);
    expect(el.querySelector(".motion-mark")).toBeNull();
    expect(el.style.position).toBe("");
    expect(el.dataset.motionMarkPositioned).toBeUndefined();
  });

  it("goes when its fade ends", () => {
    const el = row();
    markChange(el);
    el.querySelector(".motion-mark")!.dispatchEvent(new Event("animationend"));
    expect(el.querySelector(".motion-mark")).toBeNull();
    expect(el.style.position).toBe("");
  });

  it("starts again from full when the row changes again while it fades", () => {
    const el = row();
    markChange(el);
    vi.advanceTimersByTime(600);
    markChange(el);
    expect(el.querySelectorAll(".motion-mark")).toHaveLength(1);
    // The first one's timer runs out: the second tint stays, and so does its box.
    vi.advanceTimersByTime(700);
    expect(el.querySelectorAll(".motion-mark")).toHaveLength(1);
    expect(el.style.position).toBe("relative");
    vi.advanceTimersByTime(700);
    expect(el.querySelector(".motion-mark")).toBeNull();
    expect(el.style.position).toBe("");
  });

  it("leaves a row that is already positioned exactly as it was", () => {
    const el = row();
    el.style.position = "absolute";
    markChange(el);
    vi.advanceTimersByTime(1300);
    expect(el.style.position).toBe("absolute");
  });

  it("does nothing for a row that is not on the page", () => {
    const el = document.createElement("li");
    expect(() => markChange(el)).not.toThrow();
    expect(el.querySelector(".motion-mark")).toBeNull();
    expect(() => markChange(null)).not.toThrow();
  });
});
