import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OperatorSlot } from "@/lib/day/types";

const refresh = vi.fn();
const setCapacity = vi.fn();
const closeDeparture = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./actions", () => ({
  setCapacity: (prev: unknown, form: FormData) => setCapacity(prev, form),
  recordOfflineSale: vi.fn(async () => ({})),
  takeBackOfflineSale: vi.fn(async () => ({})),
  closeDeparture: (prev: unknown, form: FormData) => closeDeparture(prev, form),
}));

const { DepartureControls } = await import("./departure-controls");

afterEach(() => {
  refresh.mockReset();
  setCapacity.mockReset();
  closeDeparture.mockReset();
});

function slot(over: Partial<OperatorSlot> = {}): OperatorSlot {
  return {
    id: "slot_1",
    title: "Sky diving at key west",
    startsAt: "2026-09-24T03:30:00Z",
    timezone: "Asia/Kolkata",
    seats: 6,
    sold: 2,
    remaining: 4,
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

/*
  Inside an opened departure on the calendar (yuvoy-operator#84 s7): the seat,
  close, counter-sale and confirm controls, which used to be an open form on
  every departure of the fortnight.
*/
describe("an opened departure", () => {
  it("says what is sold and how it sells, and the way in is 'Who is booked'", () => {
    render(<DepartureControls slot={slot()} canManage canSellAtCounter />);
    expect(
      screen.getByText(/2 of 6 sold · 4 left · Instant booking/),
    ).toBeInTheDocument();
    // yuvoy-operator#96 item 6: a label that scans.
    expect(screen.getByRole("link", { name: "Who is booked" })).toHaveAttribute(
      "href",
      "/today/slot_1",
    );
    expect(screen.queryByText(/calling it off/)).toBeNull();
  });

  it("says nothing about how it sells when the API does not", () => {
    const { bookingMode: _mode, ...unknown } = slot();
    void _mode;
    render(<DepartureControls slot={unknown} canManage canSellAtCounter />);
    expect(screen.getByText(/2 of 6 sold · 4 left$/)).toBeInTheDocument();
  });

  it("offers the seat count, a counter sale, and stopping it, in that order", () => {
    const { container } = render(
      <DepartureControls slot={slot()} canManage canSellAtCounter />,
    );
    const text = container.textContent ?? "";
    const seats = text.indexOf("Seats offered");
    const counter = text.indexOf("I sold seats at my counter");
    const stop = text.indexOf("Stop selling");
    expect(seats).toBeGreaterThanOrEqual(0);
    expect(counter).toBeGreaterThan(seats);
    expect(stop).toBeGreaterThan(counter);
    expect(screen.queryByRole("button", { name: /^Confirm/ })).toBeNull();
  });

  it("offers a staff login the facts, the way in and a counter sale, and nothing else", () => {
    /*
      A counter sale is open to everybody signed in, as it is in the API
      (yuvoy-api#226; owner ruling, 23 Sep 2026): the person at the counter is
      often staff. The seat count and stopping a sale stay with managers.
    */
    render(
      <DepartureControls slot={slot()} canManage={false} canSellAtCounter />,
    );
    expect(
      screen.getByRole("link", { name: "Who is booked" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "I sold seats at my counter",
    ]);
    expect(screen.queryByLabelText("Seats offered")).toBeNull();
  });

  it("offers a suspended business nothing to change, not even a counter sale", () => {
    render(
      <DepartureControls
        slot={slot()}
        canManage={false}
        canSellAtCounter={false}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names the seats sold at the counter, which are already off the count", () => {
    /*
      yuvoy-api#226: a six-seat departure with two walk-ups reads "0 of 4 sold
      · 4 left", and without this nothing says why six became four.
    */
    render(
      <DepartureControls
        slot={slot({ seats: 4, sold: 0, remaining: 4, soldOffline: 2 })}
        canManage
        canSellAtCounter
      />,
    );
    expect(
      screen.getByText(
        /^0 of 4 sold · 4 left · 2 sold at your counter · Instant booking$/,
      ),
    ).toBeInTheDocument();
  });

  it("offers nothing to change on a departure that was called off, and says why it is not selling", () => {
    render(
      <DepartureControls
        slot={slot({
          status: "cancelled",
          onSale: false,
          notOnSaleReason: "departure_called_off",
          notOnSaleDetail: "This departure was called off.",
        })}
        canManage
        canSellAtCounter
      />,
    );
    expect(
      screen.getByText("This departure was called off."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("seats nobody confirmed", () => {
  it("is the one primary button, naming the count it keeps, with the reason and a way to learn more", () => {
    render(
      <DepartureControls slot={slot(UNCONFIRMED)} canManage canSellAtCounter />,
    );
    expect(
      screen.getByText(/Nobody has confirmed the seats on this departure/),
    ).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Confirm 6 seats" });
    expect(confirm).toHaveClass("bg-forest");
    expect(
      screen.getByRole("link", { name: "Why seats need confirming" }),
    ).toHaveAttribute(
      "href",
      "/account/help?from=%2Fcalendar#confirming-seats",
    );
  });

  it("sends the count as it is, and keeps its receipt once the departure is back on sale", async () => {
    setCapacity.mockResolvedValue({ slotId: "slot_1", seats: 6 });
    const { rerender } = render(
      <DepartureControls slot={slot(UNCONFIRMED)} canManage canSellAtCounter />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm 6 seats" }));

    await waitFor(() => expect(setCapacity).toHaveBeenCalledTimes(1));
    const form = setCapacity.mock.calls[0][1] as FormData;
    expect(form.get("seats")).toBe("6");
    expect(form.get("slotId")).toBe("slot_1");

    expect(
      await screen.findByText("6 seats confirmed as they were."),
    ).toBeInTheDocument();
    // What the re-read passes: it is selling again.
    rerender(<DepartureControls slot={slot()} canManage canSellAtCounter />);
    expect(
      screen.getByText("6 seats confirmed as they were."),
    ).toBeInTheDocument();
  });
});

describe("stopping one departure", () => {
  it("is quiet text, and its confirm names the departure over the loud button", () => {
    render(<DepartureControls slot={slot()} canManage canSellAtCounter />);
    const trigger = screen.getByRole("button", { name: "Stop selling" });
    expect(trigger).toHaveClass("text-terra-deep");
    expect(trigger).not.toHaveClass("border-2");

    fireEvent.click(trigger);
    expect(
      screen.getByText(/^Stop selling \d\d:\d\d Sky diving at key west\?$/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Anybody already on it stays booked/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop selling it" })).toHaveClass(
      "border-2",
      "border-terra-deep",
    );
  });

  it("keeps its receipt in place once the re-read marks it closed", async () => {
    closeDeparture.mockResolvedValue({
      done: true,
      note: "The bookings already on this departure still stand.",
    });
    const { rerender } = render(
      <DepartureControls slot={slot()} canManage canSellAtCounter />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop selling" }));
    fireEvent.click(screen.getByRole("radio", { name: "Weather" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop selling it" }));

    expect(
      await screen.findByText(/is closed to new bookings$/),
    ).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    rerender(
      <DepartureControls
        slot={slot({
          status: "closed",
          onSale: false,
          notOnSaleReason: "departure_closed",
        })}
        canManage
        canSellAtCounter
      />,
    );
    expect(
      screen.getByText("The bookings already on this departure still stand."),
    ).toBeInTheDocument();
  });
});

/*
  The audit before release, O1: focus lands on the question when the confirm
  opens, and goes back to the control that opened it when it is kept.
*/
describe("focus in the stop-selling confirm", () => {
  it("lands on the question, and Keep selling puts it back on Stop selling", async () => {
    const user = userEvent.setup();
    render(<DepartureControls slot={slot()} canManage canSellAtCounter />);
    await user.click(screen.getByRole("button", { name: "Stop selling" }));
    expect(
      screen.getByText(/^Stop selling \d\d:\d\d Sky diving at key west\?$/),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep selling" }));
    expect(screen.getByRole("button", { name: "Stop selling" })).toHaveFocus();
  });
});
