import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { OperatorSlot } from "@/lib/day/types";
import type { Closure } from "@/lib/day/closures";
import { boardDeparture } from "@/lib/day/board";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  setCapacity: vi.fn(async () => ({})),
  recordOfflineSale: vi.fn(async () => ({})),
  takeBackOfflineSale: vi.fn(async () => ({})),
  closeDeparture: vi.fn(async () => ({})),
  reopenClosure: vi.fn(async () => ({})),
  addBlackout: vi.fn(async () => ({})),
}));

const { DaySection } = await import("./day-section");

const DAY = "2026-09-24";
const NOW = Date.parse("2026-09-23T00:30:00Z");

function slot(over: Partial<OperatorSlot> = {}): OperatorSlot {
  return {
    id: "slot_1",
    title: "Sky diving at key west",
    experienceId: "exp_sky",
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
} as const;

function day(
  departures: OperatorSlot[],
  over: {
    closures?: Closure[];
    canManage?: boolean;
    waiting?: Map<string, number>;
  } = {},
) {
  const closures = over.closures ?? [];
  return render(
    <DaySection
      week="2026-09-21"
      day={DAY}
      today="2026-09-23"
      label="Thursday 24 September"
      departures={departures}
      cells={departures.map((s) =>
        boardDeparture(s, closures, DAY, over.waiting ?? new Map(), NOW),
      )}
      guests={2}
      closures={closures}
      canManage={over.canManage ?? true}
    />,
  );
}

/*
  The day open on the board (operator experiment B): what is on it, whether
  it is closed and why, its own actions, and on a phone its departures.
*/
describe("the day open on the board", () => {
  it("is a region named by the day, saying what is on it", () => {
    day([slot(), slot({ id: "b", startsAt: "2026-09-24T05:30:00Z" })]);
    const region = screen.getByRole("region", {
      name: "Thursday 24 September",
    });
    expect(region).toHaveTextContent("2 start times · 4 sold");
  });

  it("marks the day when something on it is not selling that should be", () => {
    day([
      slot({ id: "a", ...UNCONFIRMED }),
      slot({ id: "b", onSale: false, notOnSaleReason: "credential_expired" }),
      // Full, and one the operator stopped: not lost money, not marked.
      slot({ id: "c", onSale: false, notOnSaleReason: "departure_full" }),
      slot({
        id: "d",
        status: "closed",
        onSale: false,
        notOnSaleReason: "departure_closed",
      }),
    ]);
    expect(screen.getByText("2 not on sale")).toBeInTheDocument();
  });

  it("carries no mark on a day that is selling", () => {
    day([slot()]);
    expect(screen.queryByText(/not on sale/)).toBeNull();
  });

  it("says Closed, and why, when a closure shuts the whole day", () => {
    day([], {
      closures: [
        {
          id: "blk_1",
          from: DAY,
          to: DAY,
          reasonCode: "MAINTENANCE",
          departureIds: [],
        },
      ],
    });
    const region = screen.getByRole("region", {
      name: "Thursday 24 September",
    });
    expect(within(region).getByText("Closed")).toBeInTheDocument();
    expect(region).toHaveTextContent("No departures scheduled");
    expect(within(region).getAllByText(/Maintenance/).length).toBeGreaterThan(
      0,
    );
  });

  it("offers a staff login nothing to change on the day", () => {
    day([], { canManage: false });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("region")).toHaveTextContent(
      "No departures scheduled",
    );
  });

  it("lists each departure as a link to it, chipped only when it is not simply selling", () => {
    day(
      [
        slot({ id: "a", title: "Morning dive" }),
        slot({
          id: "b",
          title: "Night dive",
          startsAt: "2026-09-24T13:30:00Z",
          ...UNCONFIRMED,
        }),
      ],
      { waiting: new Map([["a", 2]]) },
    );
    const morning = screen.getByRole("link", {
      name: "09:00 Morning dive, 2 of 8 sold, 2 requests waiting",
    });
    // This week, so the address names only the day and the departure.
    expect(morning).toHaveAttribute("href", "/calendar?day=2026-09-24&dep=a");
    expect(within(morning).getByText("2 requests")).toBeInTheDocument();
    const night = screen.getByRole("link", {
      name: "19:00 Night dive, 2 of 8 sold, Not on sale",
    });
    expect(within(night).getByText("Not on sale")).toHaveClass(
      "text-terra-deep",
    );
    expect(within(morning).queryByText("Not on sale")).toBeNull();
  });
});
