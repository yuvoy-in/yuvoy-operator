import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
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
  The stability audit, P3-5. The sheet says `aria-modal` and is a `div`, so
  Tab past its last control walked into the page behind; and closing it gave
  focus back to what opened it even when that had gone from the screen, so
  focus went nowhere.
*/
describe("the page behind an open sheet", () => {
  function page(props: Partial<Parameters<typeof Sheet>[0]> = {}) {
    return (
      <main>
        <header>
          <a href="/messages">Messages</a>
        </header>
        <section>
          <button type="button">Aboard</button>
          {sheet(props)}
        </section>
      </main>
    );
  }

  it("cannot be reached while the sheet is open, and is given back after", () => {
    const { unmount } = render(page());
    const outside = [
      screen.getByRole("link", { name: "Messages", hidden: true }),
      screen.getByRole("button", { name: "Aboard", hidden: true }),
    ];
    for (const el of outside) expect(el.closest("[inert]")).not.toBeNull();
    // The sheet itself, and the backdrop that closes it, stay live.
    expect(screen.getByRole("dialog").closest("[inert]")).toBeNull();

    unmount();
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("keeps what the page draws behind it while it is open out of reach too", async () => {
    const { container, unmount } = render(page());
    // The page puts up a section behind the sheet after it opened.
    const later = document.createElement("section");
    later.innerHTML = '<button type="button">Aboard · 1</button>';
    container.querySelector("main")!.append(later);
    await act(async () => {});
    expect(later).toHaveAttribute("inert");

    unmount();
    expect(later).not.toHaveAttribute("inert");
  });

  it("is given back the moment the sheet starts to leave", () => {
    const { rerender } = render(page({ motion: "rise" }));
    rerender(page({ motion: "rise", leaving: true }));
    const aboard = screen.getByRole("button", { name: "Aboard", hidden: true });
    expect(aboard.closest("[inert]")).toBeNull();
  });

  it("leaves alone what was inert before the sheet opened", () => {
    const { rerender } = render(
      <main>
        <section inert>
          <button type="button">Aboard</button>
        </section>
        {sheet()}
      </main>,
    );
    rerender(
      <main>
        <section inert>
          <button type="button">Aboard</button>
        </section>
      </main>,
    );
    expect(
      screen
        .getByRole("button", { name: "Aboard", hidden: true })
        .closest("[inert]"),
    ).not.toBeNull();
  });

  it("gives focus to what stands in for an opener that has gone", () => {
    const opener = document.createElement("button");
    const row = document.createElement("button");
    document.body.append(opener, row);
    opener.focus();
    const { unmount } = render(sheet({ returnTo: () => row }));
    // The row that opened it moves while the sheet is open.
    opener.remove();
    unmount();
    expect(row).toHaveFocus();
    row.remove();
  });

  it("still gives focus back to its opener when that is on the screen", () => {
    const opener = document.createElement("button");
    const row = document.createElement("button");
    document.body.append(opener, row);
    opener.focus();
    const { unmount } = render(sheet({ returnTo: () => row }));
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
    row.remove();
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

/*
  The stability audit, P3-7. A `vh` is measured with a phone's toolbars put
  away, so on iOS a sheet held to 88vh could stand taller than the screen
  with them showing, its title and Close off the top. palette.test.ts keeps
  every other `vh` out of the portal.
*/
describe("a sheet's height", () => {
  it("is held to the screen as it is, toolbars and all", () => {
    render(sheet());
    expect(screen.getByRole("dialog")).toHaveClass("max-h-[88dvh]");
  });
});
