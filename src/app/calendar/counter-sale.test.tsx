import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OperatorSlot } from "@/lib/day/types";

/*
  "That was a mistake" on a counter sale's receipt (yuvoy-api#226, op#89 f12).

  A mistyped 20 instead of 2 takes the whole boat and refuses every accept on
  the departure, and the contract sent operators to a correction that did not
  exist. The receipt is the one screen that knows a wrong count was just
  recorded, so the undo is on it.
*/

const recordOfflineSale = vi.fn();
const takeBackOfflineSale = vi.fn();

vi.mock("./actions", () => ({
  recordOfflineSale: (prev: unknown, form: FormData) =>
    recordOfflineSale(prev, form),
  takeBackOfflineSale: (prev: unknown, form: FormData) =>
    takeBackOfflineSale(prev, form),
}));

const { CounterSale } = await import("./counter-sale");

afterEach(() => {
  recordOfflineSale.mockReset();
  takeBackOfflineSale.mockReset();
});

const SLOT: OperatorSlot = {
  id: "slot_1",
  title: "Reef dive",
  startsAt: "2026-09-24T03:30:00Z",
  timezone: "Asia/Kolkata",
  seats: 6,
  sold: 0,
  remaining: 6,
  status: "open",
};

async function recordTwo() {
  render(<CounterSale slot={SLOT} initiallyOpen onAgain={() => {}} />);
  fireEvent.change(screen.getByLabelText("Seats you sold at your counter"), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Record it" }));
  await screen.findByText("2 recorded at your counter");
}

describe("a counter sale's receipt", () => {
  it("offers the undo as quiet text when the API named the entry", async () => {
    recordOfflineSale.mockResolvedValue({
      result: {
        id: "adj_1",
        seatsRecorded: 2,
        seatsRemaining: 4,
        totalSoldOffline: 2,
      },
    });
    await recordTwo();

    const undo = screen.getByRole("button", { name: "That was a mistake" });
    expect(undo).toHaveClass("text-terra-deep");
    expect(undo).not.toHaveClass("border-2");
    expect(takeBackOfflineSale).not.toHaveBeenCalled();
  });

  it("offers no undo against an API that returned no entry id", async () => {
    recordOfflineSale.mockResolvedValue({
      result: { seatsRecorded: 2, seatsRemaining: 4, totalSoldOffline: 2 },
    });
    await recordTwo();
    expect(
      screen.queryByRole("button", { name: "That was a mistake" }),
    ).toBeNull();
  });
});

describe("taking it back", () => {
  function recorded() {
    recordOfflineSale.mockResolvedValue({
      result: {
        id: "adj_1",
        seatsRecorded: 2,
        seatsRemaining: 4,
        totalSoldOffline: 2,
      },
    });
  }

  it("asks first, naming what happens, with the loud button inside the question", async () => {
    recorded();
    await recordTwo();
    fireEvent.click(screen.getByRole("button", { name: "That was a mistake" }));

    expect(
      screen.getByText("Take back the 2 seats you just recorded?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/They go back on sale straight away/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take them back" })).toHaveClass(
      "border-2",
    );

    // Keeping them sends nothing and puts the quiet text back.
    fireEvent.click(screen.getByRole("button", { name: "Keep them" }));
    expect(takeBackOfflineSale).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "That was a mistake" }),
    ).toBeInTheDocument();
  });

  it("sends the entry, and the receipt then says the new state instead of the old", async () => {
    recorded();
    takeBackOfflineSale.mockResolvedValue({
      result: { seatsTakenBack: 2, seatsRemaining: 6, totalSoldOffline: 0 },
    });
    await recordTwo();
    fireEvent.click(screen.getByRole("button", { name: "That was a mistake" }));
    fireEvent.click(screen.getByRole("button", { name: "Take them back" }));

    await waitFor(() => expect(takeBackOfflineSale).toHaveBeenCalledTimes(1));
    const form = takeBackOfflineSale.mock.calls[0][1] as FormData;
    expect(form.get("slotId")).toBe("slot_1");
    expect(form.get("saleId")).toBe("adj_1");

    expect(
      await screen.findByText("2 seats taken back and on sale again"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /6 left for us to sell · 0 sold at the counter in total/,
      ),
    ).toBeInTheDocument();
    // The old receipt and its undo are gone; another sale is still one tap.
    expect(screen.queryByText("2 recorded at your counter")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "That was a mistake" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Record another sale" }),
    ).toBeInTheDocument();
  });

  it("reads a second take-back as done, because the seats are already back", async () => {
    recorded();
    takeBackOfflineSale.mockResolvedValue({ result: { already: true } });
    await recordTwo();
    fireEvent.click(screen.getByRole("button", { name: "That was a mistake" }));
    fireEvent.click(screen.getByRole("button", { name: "Take them back" }));

    expect(
      await screen.findByText(
        "Already taken back. Its seats are on sale again.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the question on screen with the refusal under it", async () => {
    recorded();
    takeBackOfflineSale.mockResolvedValue({
      message: "No signal. Nothing was taken back. Try again.",
    });
    await recordTwo();
    fireEvent.click(screen.getByRole("button", { name: "That was a mistake" }));
    fireEvent.click(screen.getByRole("button", { name: "Take them back" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No signal. Nothing was taken back. Try again.",
    );
    expect(
      screen.getByRole("button", { name: "Take them back" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 recorded at your counter")).toBeInTheDocument();
  });

  it("says an oversell's incident stays open, before and after", async () => {
    /*
      "An honour incident already raised is not withdrawn": taking the sale
      back gives the seats back, and somebody at Yuvoy closes the incident.
    */
    recordOfflineSale.mockResolvedValue({
      result: {
        id: "adj_20",
        seatsRecorded: 20,
        seatsRemaining: 0,
        totalSoldOffline: 20,
        oversold: {
          guests: 2,
          bookings: ["YV-AAAA1111"],
          message: "2 guests are now without a seat on this departure.",
          incidentId: "inc_9",
        },
      },
    });
    takeBackOfflineSale.mockResolvedValue({
      result: { seatsTakenBack: 20, seatsRemaining: 6, totalSoldOffline: 0 },
    });
    render(<CounterSale slot={SLOT} initiallyOpen onAgain={() => {}} />);
    fireEvent.change(screen.getByLabelText("Seats you sold at your counter"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record it" }));
    await screen.findByText("This oversold the departure");

    fireEvent.click(screen.getByRole("button", { name: "That was a mistake" }));
    expect(
      screen.getByText(/The incident stays open until we close it/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Take them back" }));

    expect(
      await screen.findByText("20 seats taken back and on sale again"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Incident inc_9 stays open until we close it."),
    ).toBeInTheDocument();
  });
});

/*
  The audit before release, O1: focus lands on the question when the confirm
  opens, and goes back to the control that opened it when it is kept.
*/
describe("focus in the take-back confirm", () => {
  it("lands on the question, and Keep them puts it back on the undo", async () => {
    recordOfflineSale.mockResolvedValue({
      result: {
        id: "adj_1",
        seatsRecorded: 2,
        seatsRemaining: 4,
        totalSoldOffline: 2,
      },
    });
    await recordTwo();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "That was a mistake" }),
    );
    expect(
      screen.getByText("Take back the 2 seats you just recorded?"),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep them" }));
    expect(
      screen.getByRole("button", { name: "That was a mistake" }),
    ).toHaveFocus();
  });
});
