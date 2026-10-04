import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { PillPanel, PillRow, PillSwap, type Pill } from "./pill-row";
import { NothingBooked } from "./nothing-booked";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        (props.onClick as ((e: unknown) => void) | undefined)?.(event);
        // A client navigation, which the test drives by re-rendering.
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));

/*
  The pill row scrolls sideways and never wraps (yuvoy-operator#83 s4), so on a
  phone the last pills start off screen. Opening on Cancelled must scroll the
  row to it, or the one lit pill is the one nobody can see.

  jsdom has no layout, so the measurements the row reads are given on the
  prototype for this file only: each pill's position comes from a data
  attribute set by its name, the row is 360px wide and 800px long.
*/
const scrolled = new WeakMap<Element, number>();
const saved: Record<string, PropertyDescriptor | undefined> = {};
const MEASURED = [
  "offsetLeft",
  "offsetWidth",
  "clientWidth",
  "scrollWidth",
  "scrollLeft",
] as const;
const LEFT: Record<string, number> = {
  requests: 24,
  upcoming: 176,
  past: 328,
  cancelled: 480,
};

beforeEach(() => {
  for (const key of MEASURED) {
    saved[key] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
  }
  Object.defineProperties(HTMLElement.prototype, {
    offsetLeft: {
      configurable: true,
      get(this: HTMLElement) {
        return LEFT[this.dataset.pill ?? ""] ?? 0;
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.pill ? 140 : 0;
      },
    },
    clientWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return this.tagName === "NAV" ? 360 : 0;
      },
    },
    scrollWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return this.tagName === "NAV" ? 800 : 0;
      },
    },
    scrollLeft: {
      configurable: true,
      get(this: HTMLElement) {
        return scrolled.get(this) ?? 0;
      },
      set(this: HTMLElement, value: number) {
        scrolled.set(this, value);
      },
    },
  });
});

afterEach(() => {
  for (const key of MEASURED) {
    const descriptor = saved[key];
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, key, descriptor);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
    }
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const PILLS: Pill[] = [
  {
    key: "requests",
    label: "Requests",
    href: "/bookings?view=requests",
    count: 2,
  },
  {
    key: "upcoming",
    label: "Upcoming",
    href: "/bookings?view=upcoming",
    count: 4,
  },
  { key: "past", label: "Past", href: "/bookings?view=past", count: 12 },
  {
    key: "cancelled",
    label: "Cancelled",
    href: "/bookings?view=cancelled",
    count: null,
  },
];

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

function row(selected: string) {
  return render(
    <PillRow label="Which bookings" selected={selected} pills={PILLS} />,
  );
}

describe("the pill row", () => {
  it("scrolls a lit pill that starts off screen into the middle of the row", () => {
    row("cancelled");
    const nav = screen.getByRole("navigation", { name: "Which bookings" });
    // 480 - (360 - 140) / 2, and the row ends at 440, so 370 is in range.
    expect(nav.scrollLeft).toBe(370);
  });

  it("leaves the row where it starts when the lit pill is already in view", () => {
    row("requests");
    const nav = screen.getByRole("navigation", { name: "Which bookings" });
    expect(nav.scrollLeft).toBe(0);
  });

  it("follows the lit pill when the address changes, in one frame under reduced motion", () => {
    reduce(true);
    const { rerender } = row("requests");
    const nav = screen.getByRole("navigation", { name: "Which bookings" });
    rerender(
      <PillRow label="Which bookings" selected="cancelled" pills={PILLS} />,
    );
    expect(nav.scrollLeft).toBe(370);
  });

  it("draws each pill's count, and none from a read that failed", () => {
    row("upcoming");
    expect(screen.getByRole("link", { name: /^Past/ })).toHaveTextContent(
      "Past12",
    );
    expect(screen.getByRole("link", { name: /^Cancelled/ })).toHaveTextContent(
      /^Cancelled$/,
    );
  });
});

/*
  O05 B (approved 4 Oct 2026): a pill's tap is answered at once. It used to
  answer nothing until the server did, which on one bar of signal is a tap
  that seems not to have landed, for seconds.
*/
describe("tapping a pill", () => {
  it("fills it in the frame it is tapped, before the address has answered", () => {
    reduce(true);
    row("upcoming");
    const past = screen.getByRole("link", { name: /^Past/ });
    fireEvent.click(past);
    expect(past).toHaveAttribute("aria-current", "page");
    expect(past.className).toMatch(/\bbg-forest\b/);
    expect(screen.getByRole("link", { name: /^Upcoming/ })).not.toHaveAttribute(
      "aria-current",
    );
    // No colour fade on a pill: its fill is the answer to the finger.
    expect(past.className).toMatch(/\bmotion-press\b/);
    expect(past.className).not.toMatch(/\bmotion-control\b/);
  });

  it("keeps the tapped pill until the address agrees, and then follows the address", () => {
    reduce(true);
    const { rerender } = row("upcoming");
    fireEvent.click(screen.getByRole("link", { name: /^Past/ }));
    rerender(<PillRow label="Which bookings" selected="past" pills={PILLS} />);
    expect(screen.getByRole("link", { name: /^Past/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Back to another pill by the history: the address is the truth.
    rerender(
      <PillRow label="Which bookings" selected="requests" pills={PILLS} />,
    );
    expect(screen.getByRole("link", { name: /^Requests/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /^Past/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("lets the history decide when back is pressed while a tap waits", () => {
    reduce(true);
    row("upcoming");
    fireEvent.click(screen.getByRole("link", { name: /^Past/ }));
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("link", { name: /^Upcoming/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("leaves a tap that opens a new tab to the browser", () => {
    row("upcoming");
    const past = screen.getByRole("link", { name: /^Past/ });
    fireEvent.click(past, { metaKey: true });
    expect(past).not.toHaveAttribute("aria-current");
  });

  it("scrolls the row smoothly to centre the tapped pill, over 200ms", () => {
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    reduce(false);
    row("upcoming");
    const nav = screen.getByRole("navigation", { name: "Which bookings" });
    // Upcoming opens centred: 176 - 110 = 66.
    expect(nav.scrollLeft).toBe(66);
    fireEvent.click(screen.getByRole("link", { name: /^Cancelled/ }));
    const run = (ms: number) => {
      now += ms;
      frames.splice(0).forEach((cb) => cb(now));
    };
    run(0);
    run(100);
    // Part way, on the A-to-B curve: well past half the distance at half time.
    expect(nav.scrollLeft).toBeGreaterThan(66 + (370 - 66) / 2);
    expect(nav.scrollLeft).toBeLessThan(370);
    run(100);
    expect(nav.scrollLeft).toBe(370);
  });

  it("stops scrolling itself the moment a finger is on the row", () => {
    const frames: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => cancelled.push(id));
    reduce(false);
    row("upcoming");
    const nav = screen.getByRole("navigation", { name: "Which bookings" });
    fireEvent.click(screen.getByRole("link", { name: /^Cancelled/ }));
    fireEvent.pointerDown(nav);
    expect(cancelled.length).toBeGreaterThan(0);
  });
});

/*
  The rows under a waiting pill (O05 B): dimmed once the answer has kept the
  operator waiting 300ms, and said to be busy; cross-faded when they come.
*/
describe("the rows a pill chooses", () => {
  function Bookings() {
    const [view, setView] = useState("upcoming");
    return (
      <PillSwap>
        <PillRow label="Which bookings" selected={view} pills={PILLS} />
        <button type="button" onClick={() => setView("past")}>
          The server answers
        </button>
        <PillPanel view={view}>
          <p>Rows for {view}</p>
        </PillPanel>
      </PillSwap>
    );
  }

  it("says the old rows are on their way once the answer is slow, and stops when it comes", () => {
    vi.useFakeTimers();
    reduce(true);
    render(<Bookings />);
    const rows = screen.getByText("Rows for upcoming").parentElement!;
    fireEvent.click(screen.getByRole("link", { name: /^Past/ }));
    act(() => vi.advanceTimersByTime(299));
    expect(rows).not.toHaveAttribute("aria-busy");
    act(() => vi.advanceTimersByTime(1));
    expect(rows).toHaveAttribute("aria-busy", "true");

    fireEvent.click(screen.getByRole("button", { name: "The server answers" }));
    expect(screen.getByText("Rows for past")).toBeInTheDocument();
    expect(rows).not.toHaveAttribute("aria-busy");
  });

  it("cross-fades the rows: a held copy of the old ones fades out over the new", () => {
    const played: { el: Element; frames: Keyframe[] }[] = [];
    const animate = vi.fn(function (this: Element, frames: Keyframe[]) {
      played.push({ el: this, frames });
      return {
        finished: new Promise(() => {}),
        cancel() {},
      } as unknown as Animation;
    });
    Element.prototype.animate =
      animate as unknown as typeof Element.prototype.animate;
    vi.stubGlobal("innerHeight", 800);
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () =>
      ({ top: 300, left: 0, width: 360, height: 200 }) as DOMRect;
    try {
      reduce(false);
      render(<Bookings />);
      fireEvent.click(screen.getByRole("link", { name: /^Past/ }));
      fireEvent.click(
        screen.getByRole("button", { name: "The server answers" }),
      );
      // The old rows, as a picture: hidden from a screen reader, then gone.
      const layer = document.body.querySelector(
        ':scope > [aria-hidden="true"][data-motion]',
      ) as HTMLElement;
      const copy = layer.firstElementChild as HTMLElement;
      expect(copy).toHaveTextContent("Rows for upcoming");
      // A picture of the rows, never a second set of them: inert.
      expect(copy.inert && layer.inert).toBe(true);
      expect(
        played.some((p) => p.el === copy && p.frames.at(-1)?.opacity === 0),
      ).toBe(true);
      // The new rows fade in where they stand.
      const rows = screen.getByText("Rows for past").parentElement!;
      expect(
        played.some((p) => p.el === rows && p.frames[0].opacity === 0),
      ).toBe(true);
    } finally {
      Element.prototype.getBoundingClientRect = rect;
      delete (Element.prototype as unknown as Record<string, unknown>).animate;
    }
  });
});

describe("a business with nothing booked", () => {
  it("says so, and the way on is Calendar", () => {
    /*
      "No upcoming bookings" and half a screen of white was a dead end. The
      second sentence is the link, and the whole sentence is the target.
    */
    render(<NothingBooked canManage suspended={false} />);
    expect(screen.getByText("Nothing booked yet.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Calendar to put seats on sale." }),
    ).toHaveAttribute("href", "/calendar");
  });

  /*
    The audit before release, O7: the way on was a dead end for the two logins
    Calendar offers nothing to put on sale.
  */
  it("tells a staff login who puts seats on sale, instead of sending them", () => {
    render(<NothingBooked canManage={false} suspended={false} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByText(
        "An owner, an admin or a manager puts seats on sale in Calendar.",
      ),
    ).toBeInTheDocument();
  });

  it("tells a business on hold why, and the one way forward", () => {
    render(<NothingBooked canManage suspended />);
    expect(
      screen.getByText(
        "Your account is on hold, so nothing new can go on sale.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Call Yuvoy" })).toHaveAttribute(
      "href",
      "tel:+918121657657",
    );
    expect(screen.queryByRole("link", { name: /Calendar/ })).toBeNull();
  });
});
