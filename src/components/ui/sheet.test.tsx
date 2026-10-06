import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sheet } from "./sheet";

/*
  The sheet, arriving from its edge and leaving the way it came (O08 A,
  approved 4 Oct 2026). Without `motion` it appears and goes as it always
  has.
*/
type Played = {
  el: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
};
let played: Played[] = [];
let ends: (() => void)[] = [];

function media({ reduced = false, wide = false } = {}) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches:
          (reduced && query === "(prefers-reduced-motion: reduce)") ||
          (wide && query === "(min-width: 64rem)"),
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  played = [];
  ends = [];
  Element.prototype.animate = function (
    this: Element,
    frames: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    played.push({ el: this, frames, options });
    let end: () => void = () => {};
    const done = new Promise<void>((resolve) => (end = resolve));
    ends.push(end);
    return { finished: done, cancel() {} } as unknown as Animation;
  } as typeof Element.prototype.animate;
  media();
});

afterEach(() => {
  delete (Element.prototype as unknown as Record<string, unknown>).animate;
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
});

function sheet(props: Partial<Parameters<typeof Sheet>[0]> = {}) {
  return (
    <Sheet title="07:00 Try-dive" onClose={() => {}} {...props}>
      <p>Who is on it</p>
    </Sheet>
  );
}

describe("a sheet that rises", () => {
  it("comes up from the foot of a phone over a backdrop that fades in, 200ms", () => {
    render(sheet({ motion: "rise", layout: "inspector" }));
    const dialog = screen.getByRole("dialog");
    const rise = played.find((p) => p.el === dialog)!;
    expect(rise.frames).toEqual([
      { transform: "translateY(100%)" },
      { transform: "none" },
    ]);
    expect(rise.options).toMatchObject({ duration: 200 });
    const tint = played.find((p) => p.el !== dialog)!;
    expect(tint.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it("comes in from the right edge, where the inspector stands on a desktop", () => {
    media({ wide: true });
    render(sheet({ motion: "rise", layout: "inspector" }));
    const rise = played.find((p) => p.el === screen.getByRole("dialog"))!;
    expect(rise.frames[0]).toEqual({ transform: "translateX(100%)" });
  });

  it("fades in 120ms under reduced motion, with nothing travelling", () => {
    media({ reduced: true });
    render(sheet({ motion: "rise", layout: "inspector" }));
    expect(played.every((p) => p.options.duration === 120)).toBe(true);
    expect(played.some((p) => p.frames.some((f) => "transform" in f))).toBe(
      false,
    );
  });

  it("draws nothing moving without `motion`, as before", () => {
    render(sheet());
    expect(played).toHaveLength(0);
  });
});

describe("a sheet that leaves", () => {
  it("is let go at once, goes back the way it came, then says it has gone", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const onLeft = vi.fn();
    const { rerender } = render(
      sheet({ motion: "rise", layout: "inspector", onLeft }),
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    played = [];

    rerender(
      sheet({ motion: "rise", layout: "inspector", onLeft, leaving: true }),
    );
    // Inert, focus back on what opened it, the page free to scroll.
    expect(dialog.parentElement).toHaveAttribute("inert");
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    const out = played.find((p) => p.el === dialog)!;
    expect(out.frames.at(-1)).toEqual({ transform: "translateY(100%)" });
    expect(out.options).toMatchObject({ duration: 150, fill: "forwards" });
    expect(onLeft).not.toHaveBeenCalled();

    ends.forEach((end) => end());
    await Promise.resolve();
    await Promise.resolve();
    expect(onLeft).toHaveBeenCalledTimes(1);
    opener.remove();
  });

  it("stops answering Escape the moment it starts to leave", () => {
    const onClose = vi.fn();
    const { rerender } = render(sheet({ motion: "rise", onClose }));
    rerender(sheet({ motion: "rise", onClose, leaving: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps giving focus back to what opened it, whatever its owner re-renders", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    // A new onClose on every render, as an inline arrow is.
    const { rerender, unmount } = render(sheet({ onClose: () => {} }));
    rerender(sheet({ onClose: () => {} }));
    expect(screen.getByRole("dialog")).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});

/*
  The stability audit, P2-6. Each sheet saved the page's overflow and put it
  back on close, so two open at once and closed first-opened-first left the
  page holding still for good.
*/
describe("two sheets at once", () => {
  it("give the page back however they close", () => {
    const first = render(sheet({ title: "First" }));
    const second = render(sheet({ title: "Second" }));
    expect(document.body.style.overflow).toBe("hidden");

    first.unmount();
    expect(document.body.style.overflow).toBe("hidden");
    second.unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
