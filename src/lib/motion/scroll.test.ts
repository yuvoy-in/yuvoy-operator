import { afterEach, describe, expect, it, vi } from "vitest";
import { cubicBezier, easeMove, scrollLeftTo } from "./scroll";

/*
  The one property CSS cannot ease, played in script on the system's own
  curve: the Bookings pills centring the one just tapped (O05 B).
*/
describe("the curve, as a function", () => {
  it("starts at nothing and ends at the whole way", () => {
    expect(easeMove(0)).toBe(0);
    expect(easeMove(1)).toBe(1);
    expect(easeMove(-1)).toBe(0);
    expect(easeMove(2)).toBe(1);
  });

  it("is the straight line when the control points are on it", () => {
    const line = cubicBezier(0, 0, 1, 1);
    for (const t of [0.1, 0.25, 0.5, 0.9]) {
      expect(line(t)).toBeCloseTo(t, 4);
    }
  });

  it("is --ease-move: well past half the way at half the time, never past the end", () => {
    // cubic-bezier(0.2, 0, 0, 1) puts about 87% of the journey behind it at half time.
    expect(easeMove(0.5)).toBeGreaterThan(0.8);
    expect(easeMove(0.5)).toBeLessThan(0.95);
    let last = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeMove(t);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v).toBeLessThanOrEqual(1);
      last = v;
    }
  });
});

describe("scrolling a row", () => {
  afterEach(() => vi.unstubAllGlobals());

  function rowAt(left: number) {
    const el = document.createElement("nav");
    let x = left;
    Object.defineProperty(el, "scrollLeft", {
      get: () => x,
      set: (v: number) => (x = v),
    });
    return el;
  }

  it("lands in one frame under reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      () =>
        ({
          matches: true,
          addEventListener() {},
          removeEventListener() {},
        }) as unknown as MediaQueryList,
    );
    const el = rowAt(0);
    scrollLeftTo(el, 240);
    expect(el.scrollLeft).toBe(240);
  });

  it("plays 200ms on the curve, frame by frame, and can be stopped", () => {
    const frames: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    let ids = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      ids += 1;
      return ids;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => cancelled.push(id));
    const el = rowAt(100);
    const stop = scrollLeftTo(el, 300);
    frames.shift()!(1000);
    expect(el.scrollLeft).toBe(100);
    frames.shift()!(1100);
    expect(el.scrollLeft).toBeCloseTo(100 + 200 * easeMove(0.5), 5);
    stop();
    expect(cancelled).toEqual([3]);
  });

  it("does not move a row that is already there", () => {
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    const el = rowAt(120);
    scrollLeftTo(el, 120.4);
    expect(raf).not.toHaveBeenCalled();
  });
});
