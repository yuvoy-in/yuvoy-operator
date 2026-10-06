import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
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
    // Seven tenths of the roll in, as the lab and the traveller app leave.
    expect(old.options).toMatchObject({ duration: 140, fill: "forwards" });
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

/*
  A hard load of boarding with check-ins kept on this phone (the stability
  audit, P3-4). The server cannot read the phone, so it draws its own count,
  and the first client pass corrects it. That correction rolled, so the
  screen moved on its own after it had appeared.
*/
describe("a figure on a page loaded from the server", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  /** A count only the phone holds: the server says 2, this phone 4. */
  let phone = 4;
  const listeners = new Set<() => void>();
  const store = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(n: number) {
      phone = n;
      for (const listener of listeners) listener();
    },
  };

  function Aboard() {
    const value = useSyncExternalStore(
      store.subscribe,
      () => phone,
      () => 2,
    );
    return <Roll value={value} />;
  }

  async function load() {
    container = document.createElement("div");
    container.innerHTML = renderToString(<Aboard />);
    document.body.appendChild(container);
    expect(container.textContent).toBe("2");
    const recoverable = vi.fn();
    await act(async () => {
      root = hydrateRoot(container!, <Aboard />, {
        onRecoverableError: recoverable,
      });
    });
    expect(recoverable).not.toHaveBeenCalled();
    return container;
  }

  it("lands on the phone's count still, rather than rolling to it", async () => {
    phone = 4;
    const page = await load();
    expect(page.textContent).toBe("4");
    expect(played).toHaveLength(0);
    expect(page.querySelector("[data-was]")).toBeNull();
  });

  it("rolls every change after that, as before", async () => {
    phone = 4;
    const page = await load();
    act(() => store.set(5));
    expect(page.textContent).toBe("5");
    expect(played.length).toBeGreaterThan(0);
    expect(page.querySelector("[data-was]")).not.toBeNull();
  });
});
