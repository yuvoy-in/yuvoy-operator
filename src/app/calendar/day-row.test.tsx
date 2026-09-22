import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { OperatorSlot } from "@/lib/day/types";
import type { Closure } from "@/lib/day/closures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  setCapacity: vi.fn(async () => ({})),
  recordOfflineSale: vi.fn(async () => ({})),
  closeDeparture: vi.fn(async () => ({})),
  reopenClosure: vi.fn(async () => ({})),
  addBlackout: vi.fn(async () => ({})),
}));

const { DayRow } = await import("./day-row");

/*
  A day is one row until it is opened (yuvoy-operator#84 s7). Every departure
  used to be an open form, and fourteen days were about thirty phone screens.
*/

function slot(over: Partial<OperatorSlot> = {}): OperatorSlot {
  return {
    id: "slot_1",
    title: "Sky diving at key west",
    startsAt: "2026-09-24T03:30:00Z",
    timezone: "Asia/Kolkata",
    seats: 8,
    sold: 2,
    remaining: 6,
    bookingMode: "allotment",
    status: "open",
    onSale: true,
    ...over,
  };
}

const UNCONFIRMED = {
  onSale: false,
  notOnSaleReason: "departure_seats_unconfirmed",
  notOnSaleDetail:
    "Nobody has confirmed the seats on this departure for two days, so it is not on sale. Confirm them to put it back.",
} as const;

function row(
  departures: OperatorSlot[],
  over: { closures?: Closure[]; canManage?: boolean } = {},
) {
  return (
    <DayRow
      day="2026-09-24"
      label="Thursday 24 September"
      departures={departures}
      guests={2}
      closures={over.closures ?? []}
      canManage={over.canManage ?? true}
    />
  );
}

describe("a day on the calendar", () => {
  it("is one row, closed, saying how many start times and what is sold", () => {
    const { container } = render(
      row([
        slot({ id: "a", startsAt: "2026-09-24T03:30:00Z", sold: 2 }),
        slot({ id: "b", startsAt: "2026-09-24T03:30:00Z", sold: 3 }),
        slot({ id: "c", startsAt: "2026-09-24T08:30:00Z", sold: 1 }),
      ]),
    );
    const day = container.querySelector("details");
    expect(day).not.toBeNull();
    expect(day!.open).toBe(false);
    const summary = container.querySelector("summary")!;
    expect(summary).toHaveTextContent("Thursday 24 September");
    expect(summary).toHaveTextContent("2 start times · 6 sold");
    expect(
      screen.getByRole("heading", { name: "Thursday 24 September" }),
    ).toBeInTheDocument();
  });

  it("marks the day when something on it is not selling that should be", () => {
    const { container } = render(
      row([
        slot({ id: "a", ...UNCONFIRMED }),
        slot({
          id: "b",
          onSale: false,
          notOnSaleReason: "credential_expired",
        }),
        // Full, and one the operator stopped: not lost money, not marked.
        slot({ id: "c", onSale: false, notOnSaleReason: "departure_full" }),
        slot({
          id: "d",
          status: "closed",
          onSale: false,
          notOnSaleReason: "departure_closed",
        }),
      ]),
    );
    expect(container.querySelector("summary")).toHaveTextContent(
      "2 not on sale",
    );
  });

  it("carries no mark on a day that is selling", () => {
    const { container } = render(row([slot()]));
    expect(container.querySelector("summary")).not.toHaveTextContent(
      "not on sale",
    );
  });

  it("says Closed, and why, when a closure shuts the whole day", () => {
    const { container } = render(
      row([], {
        closures: [
          {
            id: "blk_1",
            from: "2026-09-24",
            to: "2026-09-24",
            reasonCode: "MAINTENANCE",
            departureIds: [],
          },
        ],
      }),
    );
    const summary = container.querySelector("summary")!;
    expect(within(summary).getByText("Closed")).toBeInTheDocument();
    expect(summary).toHaveTextContent("No departures scheduled");
    // The reason is inside the day, where "back on the 14th" lives.
    expect(
      within(container.querySelector("details")!).getAllByText("Maintenance")
        .length,
    ).toBeGreaterThan(0);
  });

  it("is a plain row, with nothing to open, for a staff login on an empty day", () => {
    const { container } = render(row([], { canManage: false }));
    expect(container.querySelector("details")).toBeNull();
    expect(container).toHaveTextContent("No departures scheduled");
  });

  it("lists each departure as its own closed row, chipped only when it is not simply selling", () => {
    const { container } = render(
      row([
        slot({ id: "a", title: "Morning dive" }),
        slot({ id: "b", title: "Night dive", ...UNCONFIRMED }),
      ]),
    );
    const departures = container.querySelectorAll("li > details");
    expect(departures).toHaveLength(2);
    for (const d of departures)
      expect((d as HTMLDetailsElement).open).toBe(false);
    const night = screen.getByText("Night dive").closest("summary")!;
    expect(within(night).getByText("Not on sale")).toHaveClass(
      "text-terra-deep",
    );
    const morning = screen.getByText("Morning dive").closest("summary")!;
    expect(within(morning).queryByText("Not on sale")).toBeNull();
  });

  it("stays open, day and departure, when a write re-reads the calendar underneath", () => {
    /*
      The rule every write on this screen depends on: a receipt after a seat
      change, a counter sale or a closure is read inside the day it was made
      in. React never sets `open`, so what the operator opened stays open while
      the re-read changes what is inside.
    */
    const { container, rerender } = render(
      row([slot({ id: "a", title: "Morning dive", sold: 2 })]),
    );
    const day = container.querySelector(
      "section > details",
    ) as HTMLDetailsElement;
    const departure = container.querySelector(
      "li > details",
    ) as HTMLDetailsElement;
    day.open = true;
    departure.open = true;

    // What the revalidated page passes: the same departure, now with more sold.
    rerender(row([slot({ id: "a", title: "Morning dive", sold: 5 })]));

    expect(container.querySelector("section > details")).toBe(day);
    expect(day.open).toBe(true);
    expect(departure.open).toBe(true);
    expect(container.querySelector("summary")).toHaveTextContent("5 sold");
  });
});
