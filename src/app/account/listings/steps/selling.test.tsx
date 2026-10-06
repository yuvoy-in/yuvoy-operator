import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/*
  The Selling step's "You receive" line (yuvoy-operator#144). It read the box
  the way the save did, by deleting everything but digits and dots, so
  "Rs. 1500" drew a line for 15 paise. It reads a price the way the save now
  does, and draws nothing for one the save would refuse.
*/

vi.mock("../builder-actions", () => ({
  saveSelling: vi.fn(async () => ({})),
}));

const { SellingStep } = await import("./selling");

function priceBox(unitPricePaise?: number) {
  render(
    <SellingStep
      id="exp_1"
      listing={{ unitPricePaise }}
      commissionRateBps={1500}
      back="/account/listings/exp_1/edit?step=basics"
    />,
  );
  return screen.getByLabelText(/^Price/);
}

describe("the price box and what the business receives", () => {
  it.each(["1500", "Rs. 1500", "₹1,500.00"])("reads %s as ₹1,500", (typed) => {
    fireEvent.change(priceBox(), { target: { value: typed } });
    expect(
      screen.getByText("You receive ₹1,275. Yuvoy keeps ₹225, which is 15%."),
    ).toBeInTheDocument();
  });

  it.each(["1500-2000", "1.005", "Rs."])(
    "draws no line for %s, which the save refuses",
    (typed) => {
      fireEvent.change(priceBox(), { target: { value: typed } });
      expect(screen.queryByText(/You receive/)).toBeNull();
    },
  );

  it("starts at the exact price, so saving it untouched keeps it", () => {
    expect(priceBox(150_050)).toHaveValue("1500.50");
  });
});
