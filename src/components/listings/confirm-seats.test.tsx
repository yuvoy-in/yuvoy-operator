import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const confirmSeats = vi.fn();

vi.mock("@/app/calendar/actions", () => ({
  confirmSeats: (prev: unknown, form: FormData) => confirmSeats(prev, form),
}));

const { ConfirmSeats } = await import("./confirm-seats");

afterEach(() => confirmSeats.mockReset());

/*
  Departures off sale because nobody confirmed their seats, and one tap to
  confirm them (yuvoy-operator#94).
*/
describe("confirming seats from a listing", () => {
  it("says how many are off sale and how many are about to be", () => {
    render(
      <ConfirmSeats experienceId="exp_1" notOnSale={19} goingOffSoon={1} />,
    );
    expect(
      screen.getByText("19 departures are not on sale"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 more goes off sale within a day/),
    ).toBeInTheDocument();
  });

  it("warns before anything goes off sale", () => {
    render(
      <ConfirmSeats experienceId="exp_1" notOnSale={0} goingOffSoon={2} />,
    );
    expect(
      screen.getByText("2 departures go off sale within a day"),
    ).toBeInTheDocument();
  });

  it("draws nothing when there is nothing to confirm", () => {
    const { container } = render(
      <ConfirmSeats experienceId="exp_1" notOnSale={0} goingOffSoon={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says how many it confirmed, and keeps saying it once the counts are 0", async () => {
    confirmSeats.mockResolvedValue({ confirmed: 3 });
    const { rerender } = render(
      <ConfirmSeats experienceId="exp_1" notOnSale={3} goingOffSoon={0} />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirm seats for the next 12 months",
      }),
    );
    expect(
      await screen.findByText("Seats confirmed on 3 departures"),
    ).toBeInTheDocument();

    // What the re-read page passes once they are back on sale.
    rerender(
      <ConfirmSeats experienceId="exp_1" notOnSale={0} goingOffSoon={0} />,
    );
    expect(
      screen.getByText("Seats confirmed on 3 departures"),
    ).toBeInTheDocument();
  });
});
