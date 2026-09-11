import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CashCollect } from "./cash-collect";

/**
 * yuvoy-operator#40 §1 — the tap that records the notes in an operator's hand.
 */
const record = vi.fn<(prev: unknown, form: FormData) => Promise<object>>(
  async () => ({}),
);
vi.mock("@/app/bookings/cash-actions", () => ({
  recordCashCollected: (prev: unknown, form: FormData) => record(prev, form),
}));

const owed = { collectPaise: 1_350_000, collected: false };

function row(over: Partial<Parameters<typeof CashCollect>[0]> = {}) {
  return render(
    <CashCollect
      bookingId="bkg_1"
      slotId="slot_1"
      state="paid_pending_ops"
      cash={owed}
      timezone="Asia/Kolkata"
      {...over}
    />,
  );
}

beforeEach(() => {
  record.mockReset();
  record.mockImplementation(async () => ({}));
});

describe("CashCollect — owed", () => {
  it("names the fare and offers the whole of it in one tap", async () => {
    const user = userEvent.setup();
    row();
    expect(screen.getByText("₹13,500 to take in cash")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cash taken" }));
    expect(record).toHaveBeenCalledTimes(1);
    const form = record.mock.calls[0][1];
    expect(form.get("mode")).toBe("fare");
    expect(form.get("bookingId")).toBe("bkg_1");
    expect(form.get("slotId")).toBe("slot_1");
  });

  it("says the gap while the box is open, and refuses more than the fare", async () => {
    const user = userEvent.setup();
    row();
    await user.click(screen.getByRole("button", { name: "Took less" }));

    const box = screen.getByLabelText("What you took, in rupees");
    await user.type(box, "14000");
    expect(
      screen.getByText(/more than the fare of ₹13,500/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Record/ })).toBeDisabled();

    await user.clear(box);
    await user.type(box, "3000");
    expect(
      screen.getByText("That is ₹10,500 less than the fare of ₹13,500."),
    ).toBeInTheDocument();
    // The number is repeated on the button — the last look before it is a fact.
    await user.click(screen.getByRole("button", { name: "Record ₹3,000" }));

    const form = record.mock.calls[0][1];
    expect(form.get("mode")).toBe("less");
    expect(form.get("amount")).toBe("3000");
  });

  it("says a recorded amount cannot be changed, before it is recorded", async () => {
    const user = userEvent.setup();
    row();
    await user.click(screen.getByRole("button", { name: "Took less" }));
    expect(
      screen.getByText(/cannot be changed afterwards/),
    ).toBeInTheDocument();
  });
});

describe("CashCollect — the answer", () => {
  it("says a shortfall once, quietly, beside the recorded fact", async () => {
    record.mockImplementation(async () => ({
      recorded: {
        collectedPaise: 300_000,
        shortfallPaise: 1_050_000,
        collectedAt: "2026-09-14T03:34:00Z",
        alreadyRecorded: false,
      },
    }));
    const user = userEvent.setup();
    row();
    await user.click(screen.getByRole("button", { name: "Took less" }));
    await user.type(screen.getByLabelText("What you took, in rupees"), "3000");
    await user.click(screen.getByRole("button", { name: "Record ₹3,000" }));

    expect(
      await screen.findByText("₹3,000 taken of ₹13,500 · 09:04"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Recorded ₹3,000. That is ₹10,500 short of the fare."),
    ).toBeInTheDocument();
    // And never as an error.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("answers a retry with the first report, not a second confirmation", async () => {
    /*
      "A phone loses signal mid-request and the operator taps again. That is
      the correct instinct and must not be punished."
    */
    record.mockImplementation(async () => ({
      recorded: {
        collectedPaise: 1_350_000,
        shortfallPaise: 0,
        collectedAt: "2026-09-14T03:34:00Z",
        alreadyRecorded: true,
      },
    }));
    const user = userEvent.setup();
    row();
    await user.click(screen.getByRole("button", { name: "Cash taken" }));

    expect(
      await screen.findByText("₹13,500 taken · 09:04"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/^Recorded/)).toBeNull();
  });

  it("keeps the typed amount when nothing was recorded", async () => {
    record.mockImplementation(async () => ({
      message: "No signal — nothing was recorded yet.",
      typed: "3000",
      attempt: 1,
    }));
    const user = userEvent.setup();
    row();
    await user.click(screen.getByRole("button", { name: "Took less" }));
    await user.type(screen.getByLabelText("What you took, in rupees"), "3000");
    await user.click(screen.getByRole("button", { name: "Record ₹3,000" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/No signal/);
    expect(screen.getByLabelText("What you took, in rupees")).toHaveValue(
      "3000",
    );
  });
});

describe("CashCollect — nothing to take", () => {
  it("offers nothing on a collection already recorded", () => {
    row({
      state: "confirmed",
      cash: {
        collectPaise: 900_000,
        collected: true,
        collectedAt: "2026-09-14T02:40:00Z",
        collectedPaise: 900_000,
      },
    });
    expect(screen.getByText("₹9,000 taken · 08:10")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("asks for nothing on a booking that is over", () => {
    const { container } = row({ state: "cancelled" });
    expect(container).toBeEmptyDOMElement();
    const noShow = row({ state: "no_show" });
    expect(noShow.container).toBeEmptyDOMElement();
  });

  it("says a trip completed before the cash was recorded, with no button to be refused", () => {
    row({ state: "completed" });
    expect(
      screen.getByText(/can no longer be recorded here/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("never says 'paid' — they were paid, we were not", async () => {
    const user = userEvent.setup();
    const { container } = row();
    await user.click(screen.getByRole("button", { name: "Took less" }));
    await user.type(screen.getByLabelText("What you took, in rupees"), "3000");
    expect(container.textContent?.toLowerCase()).not.toContain("paid");
  });
});
