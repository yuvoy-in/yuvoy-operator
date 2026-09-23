import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PillRow } from "./pill-row";
import { NothingBooked } from "./nothing-booked";

/*
  The pill row scrolls sideways and never wraps (yuvoy-operator#83 s4), so on a
  phone the last pills start off screen. Opening on Cancelled must scroll the
  row to it, or the one lit pill is the one nobody can see.

  jsdom has no layout, so the measurements the row reads are given on the
  prototype for this file only: each pill's position comes from a data
  attribute, the row is 360px wide and 800px long. The pills are spans here,
  because only their position and `aria-current` are under test.
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

beforeEach(() => {
  for (const key of MEASURED) {
    saved[key] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
  }
  const measure = (key: string, fallback: number) =>
    function (this: HTMLElement) {
      return Number(this.dataset[key] ?? fallback);
    };
  Object.defineProperties(HTMLElement.prototype, {
    offsetLeft: { configurable: true, get: measure("left", 0) },
    offsetWidth: { configurable: true, get: measure("width", 0) },
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
});

function row(selected: string) {
  const pills = [
    { name: "Requests", left: 24 },
    { name: "Upcoming", left: 176 },
    { name: "Past", left: 328 },
    { name: "Cancelled", left: 480 },
  ];
  return render(
    <PillRow label="Which bookings" selected={selected}>
      {pills.map((pill) => (
        <span
          key={pill.name}
          data-left={pill.left}
          data-width={140}
          aria-current={pill.name === selected ? "page" : undefined}
        >
          {pill.name}
        </span>
      ))}
    </PillRow>,
  );
}

describe("the pill row", () => {
  it("scrolls a lit pill that starts off screen into the middle of the row", () => {
    row("Cancelled");
    const nav = screen.getByRole("navigation", { name: "Which bookings" });
    // 480 - (360 - 140) / 2, and the row ends at 440, so 370 is in range.
    expect(nav.scrollLeft).toBe(370);
  });

  it("leaves the row where it starts when the lit pill is already in view", () => {
    row("Requests");
    const nav = screen.getByRole("navigation", { name: "Which bookings" });
    expect(nav.scrollLeft).toBe(0);
  });

  it("follows the lit pill when it changes", () => {
    const { rerender } = row("Requests");
    const nav = screen.getByRole("navigation", { name: "Which bookings" });
    rerender(
      <PillRow label="Which bookings" selected="Cancelled">
        <span data-left={24} data-width={140}>
          Requests
        </span>
        <span data-left={480} data-width={140} aria-current="page">
          Cancelled
        </span>
      </PillRow>,
    );
    expect(nav.scrollLeft).toBe(370);
  });
});

describe("a business with nothing booked", () => {
  it("says so, and the way on is Calendar", () => {
    /*
      "No upcoming bookings" and half a screen of white was a dead end. The
      second sentence is the link, and the whole sentence is the target.
    */
    render(<NothingBooked />);
    expect(screen.getByText("Nothing booked yet.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Calendar to put seats on sale." }),
    ).toHaveAttribute("href", "/calendar");
  });
});
