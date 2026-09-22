import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Closure } from "@/lib/day/closures";

/*
  Reopening a closure from the day's panel (yuvoy-operator#89 f16).

  The day went on saying Closed until somebody tapped "Show the day", because
  re-reading the calendar drops the reopened closure's row and took the API's
  note with it. The note now lives on the day's panel, which survives the
  re-read, and the calendar re-reads at once.
*/

const refresh = vi.fn();
const reopenClosure = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./actions", () => ({
  reopenClosure: (prev: unknown, form: FormData) => reopenClosure(prev, form),
  closeDeparture: vi.fn(async () => ({})),
  addBlackout: vi.fn(async () => ({})),
}));

const { DayManage } = await import("./day-manage");

const CLOSURE: Closure = {
  id: "blk_1",
  from: "2026-09-27",
  to: "2026-09-27",
  reasonCode: "WEATHER",
  departureIds: [],
};

function panel(closures: Closure[]) {
  return (
    <DayManage
      day="2026-09-27"
      label="Sunday 27 September"
      guests={0}
      closed={closures.length > 0}
      closures={closures}
      departures={[]}
    />
  );
}

afterEach(() => {
  refresh.mockReset();
  reopenClosure.mockReset();
});

describe("reopening from the day's panel", () => {
  it("re-reads the day at once and keeps the API's note through it", async () => {
    reopenClosure.mockResolvedValue({
      done: true,
      note: "2 departures are back on sale. 1 stays closed.",
    });
    const { rerender } = render(panel([CLOSURE]));

    fireEvent.click(screen.getByRole("button", { name: /^Manage/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    // What the refreshed calendar passes: the closure is no longer in force.
    rerender(panel([]));

    expect(
      screen.getByText("2 departures are back on sale. 1 stays closed."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show the day" })).toBeNull();
  });

  it("says the screen was out of date when the API had no sentence", async () => {
    reopenClosure.mockResolvedValue({ done: true });
    const { rerender } = render(panel([CLOSURE]));

    fireEvent.click(screen.getByRole("button", { name: /^Manage/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    rerender(panel([]));

    expect(
      screen.getByText("Reopened. What you were reading was out of date."),
    ).toBeInTheDocument();
  });
});
