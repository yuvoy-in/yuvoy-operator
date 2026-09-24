import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Closure } from "@/lib/day/closures";

/*
  What a manager can do to a whole day, at the foot of the opened day
  (yuvoy-operator#45, laid out by #84 s7).
*/

const refresh = vi.fn();
const reopenClosure = vi.fn();
const addBlackout = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./actions", () => ({
  reopenClosure: (prev: unknown, form: FormData) => reopenClosure(prev, form),
  closeDeparture: vi.fn(async () => ({})),
  addBlackout: (prev: unknown, form: FormData) => addBlackout(prev, form),
}));

const { DayPanel } = await import("./day-panel");

const CLOSURE: Closure = {
  id: "blk_1",
  from: "2026-09-27",
  to: "2026-09-27",
  reasonCode: "WEATHER",
  departureIds: [],
};

function panel(closures: Closure[], guests: number | null = 0) {
  return (
    <DayPanel
      day="2026-09-27"
      label="Sunday 27 September"
      guests={guests}
      closed={closures.length > 0}
      closures={closures}
    />
  );
}

afterEach(() => {
  refresh.mockReset();
  reopenClosure.mockReset();
  addBlackout.mockReset();
});

describe("reopening from the day", () => {
  it("re-reads the day at once and keeps the API's note through it", async () => {
    /*
      op#89 f16: the day went on saying Closed until somebody tapped "Show the
      day", because re-reading drops the reopened closure's row and took the
      API's note with it. The note lives on the day's panel, which survives.
    */
    reopenClosure.mockResolvedValue({
      done: true,
      note: "2 departures are back on sale. 1 stays closed.",
    });
    const { rerender } = render(panel([CLOSURE]));

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

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    rerender(panel([]));

    expect(
      screen.getByText("Reopened. What you were reading was out of date."),
    ).toBeInTheDocument();
  });
});

describe("closing the day", () => {
  it("is quiet text until asked for, and names the day to a screen reader", () => {
    render(panel([]));
    const trigger = screen.getByRole("button", {
      name: "Close this day (Sunday 27 September)",
    });
    expect(trigger).toHaveClass("text-terra-deep");
    expect(trigger).not.toHaveClass("border-2");
    // The consequence belongs to the tap, so it is not said before it.
    expect(screen.queryByText(/Closing stops new bookings/)).toBeNull();
  });

  it("says both sentences verbatim before the loud button, and can be backed out of", () => {
    render(panel([], 4));
    fireEvent.click(screen.getByRole("button", { name: /^Close this day/ }));

    expect(
      screen.getByText(
        "Closing stops new bookings straight away. Bookings you've already confirmed stay live. Resolve those one by one in Bookings.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "4 guests are already confirmed. Closing won't move them. Resolve each booking in Bookings.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close Sunday 27 September" }),
    ).toHaveClass("border-2", "border-terra-deep");

    fireEvent.click(screen.getByRole("button", { name: "Keep it open" }));
    expect(
      screen.getByRole("button", { name: /^Close this day/ }),
    ).toBeInTheDocument();
  });

  it("says the second sentence without a number when the bookings did not load", () => {
    render(panel([], null));
    fireEvent.click(screen.getByRole("button", { name: /^Close this day/ }));
    expect(
      screen.getByText(/Anybody already confirmed on this day stays booked/),
    ).toBeInTheDocument();
  });

  it("keeps the receipt once the re-read turns the day Closed", async () => {
    addBlackout.mockResolvedValue({
      result: { existingBookings: 1, note: "The booking still stands." },
    });
    const { rerender } = render(panel([]));
    fireEvent.click(screen.getByRole("button", { name: /^Close this day/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Weather" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Close Sunday 27 September" }),
    );
    expect(
      await screen.findByText("Sunday 27 September is closed to new bookings"),
    ).toBeInTheDocument();

    // What the revalidated calendar passes: the day is closed now.
    rerender(panel([CLOSURE]));
    expect(
      screen.getByText("Sunday 27 September is closed to new bookings"),
    ).toBeInTheDocument();
    expect(screen.getByText(/You still owe 1 booking/)).toBeInTheDocument();
  });

  it("drops a close receipt once the day is reopened, and offers to close it again", async () => {
    addBlackout.mockResolvedValue({ result: { existingBookings: 0 } });
    reopenClosure.mockResolvedValue({
      done: true,
      note: "0 departures are back on sale.",
    });
    const { rerender } = render(panel([]));
    fireEvent.click(screen.getByRole("button", { name: /^Close this day/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Weather" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Close Sunday 27 September" }),
    );
    await screen.findByText("Sunday 27 September is closed to new bookings");
    rerender(panel([CLOSURE]));

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    rerender(panel([]));

    expect(
      screen.queryByText("Sunday 27 September is closed to new bookings"),
    ).toBeNull();
    expect(
      screen.getByText("0 departures are back on sale."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Close this day/ }),
    ).toBeInTheDocument();
  });

  it("does not offer to close a day that is already closed", () => {
    render(panel([CLOSURE]));
    expect(
      screen.queryByRole("button", { name: /^Close this day/ }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeInTheDocument();
  });
});

/*
  The audit before release, O1: focus lands on the question when the confirm
  opens, and goes back to the control that opened it when it is kept.
*/
describe("focus in the close-a-day confirm", () => {
  it("lands on the question, and Keep it open puts it back on Close this day", async () => {
    const user = userEvent.setup();
    render(panel([]));
    await user.click(screen.getByRole("button", { name: /^Close this day/ }));
    expect(
      screen.getByText("Close Sunday 27 September to new bookings"),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep it open" }));
    expect(
      screen.getByRole("button", { name: /^Close this day/ }),
    ).toHaveFocus();
  });
});
