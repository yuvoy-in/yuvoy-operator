import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/*
  What happens on screen after a cancel (yuvoy-operator#89 f16).

  The write worked and the screen kept showing the booking as it was: "Collect
  ₹15,000" and a Cash taken button under "This booking is cancelled", until
  somebody pressed "Show the booking". On its own page the booking now
  re-reads underneath the receipt at once; on a manifest row the row puts its
  other controls away and offers to update the list.
*/

const refresh = vi.fn();
const cancelBooking = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/bookings/cancel-actions", () => ({
  cancelBooking: (prev: unknown, form: FormData) => cancelBooking(prev, form),
}));

const { CancelBooking } = await import("./cancel-booking");

afterEach(() => {
  refresh.mockReset();
  cancelBooking.mockReset();
});

async function cancelIt() {
  fireEvent.click(screen.getByRole("button", { name: "Cancel this booking" }));
  fireEvent.click(screen.getByRole("radio", { name: "Weather" }));
  fireEvent.change(screen.getByLabelText(/^Type/), {
    target: { value: "YV-TEST0001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel the booking" }));
  await screen.findByText("This booking is cancelled");
}

describe("after a cancel", () => {
  it("re-reads the booking page underneath the receipt, with no tap", async () => {
    cancelBooking.mockResolvedValue({
      done: { refundedPaise: 0, seatsReleased: 2 },
    });
    render(<CancelBooking bookingId="bkg_1" reference="YV-TEST0001" isCash />);

    await cancelIt();

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // Nothing left to press: the page behind is already current.
    expect(
      screen.queryByRole("button", { name: "Show the booking" }),
    ).toBeNull();
  });

  it("keeps the receipt once the booking can no longer be cancelled", async () => {
    cancelBooking.mockResolvedValue({
      done: { refundedPaise: 0, seatsReleased: 2 },
    });
    const { rerender } = render(
      <CancelBooking bookingId="bkg_1" reference="YV-TEST0001" isCash />,
    );
    await cancelIt();

    // What the refreshed page passes: the booking is cancelled now.
    rerender(
      <CancelBooking
        bookingId="bkg_1"
        reference="YV-TEST0001"
        isCash
        available={false}
      />,
    );

    expect(screen.getByText("This booking is cancelled")).toBeInTheDocument();
  });

  it("draws nothing for a booking that cannot be cancelled", () => {
    const { container } = render(
      <CancelBooking
        bookingId="bkg_1"
        reference="YV-TEST0001"
        isCash={false}
        available={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("on a manifest row, tells the row and waits for the operator", async () => {
    cancelBooking.mockResolvedValue({ alreadyCancelled: true });
    const onDone = vi.fn();
    render(
      <CancelBooking
        bookingId="bkg_1"
        reference="YV-TEST0001"
        isCash={false}
        context="manifest"
        onDone={onDone}
      />,
    );

    await cancelIt();

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Update the list" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("before a cancel", () => {
  /*
    yuvoy-operator#81: cancelling a booking was a full-width button in the same
    weight as the safe actions beside it. It is quiet text now, and the confirm
    it opens names what happens and carries the loud button.
  */
  it("is a quiet text control, not a pill, until it is asked for", () => {
    render(<CancelBooking bookingId="bkg_1" reference="YV-TEST0001" isCash />);
    const trigger = screen.getByRole("button", { name: "Cancel this booking" });
    expect(trigger).toHaveClass("text-terra-deep");
    expect(trigger).not.toHaveClass("border-2");
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("names the booking and the money before the loud button", () => {
    render(
      <CancelBooking
        bookingId="bkg_1"
        reference="YV-TEST0001"
        isCash={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel this booking" }),
    );

    expect(screen.getByText("Cancel YV-TEST0001?")).toBeInTheDocument();
    expect(
      screen.getByText(/Everything they paid online is refunded in full/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel the booking" }),
    ).toHaveClass("border-2", "border-terra-deep");
  });
});
