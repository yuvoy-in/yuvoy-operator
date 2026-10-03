import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

    // The booking's own reference, filled by the form: nothing was typed.
    const sent = cancelBooking.mock.calls[0][1] as FormData;
    expect(sent.get("bookingId")).toBe("bkg_1");
    expect(sent.get("confirmReference")).toBe("YV-TEST0001");
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

  /*
    Named, not typed (owner ruling, 3 Oct 2026). The reference used to be
    typed back; the question says whose booking it is now, and that it
    cannot be undone, over the one loud button.
  */
  it("names whose booking it is and the money, before the loud button", () => {
    render(
      <CancelBooking
        bookingId="bkg_1"
        reference="YV-TEST0001"
        who="Asha Menon"
        isCash={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel this booking" }),
    );

    expect(
      screen.getByText("Cancel Asha Menon's booking, YV-TEST0001?"),
    ).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    expect(
      screen.getByText(/Everything they paid online is refunded in full/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel the booking" }),
    ).toHaveClass("border-2", "border-terra-deep");
    // Nothing to type: the only field to write in is the note.
    expect(screen.getAllByRole("textbox")).toEqual([
      screen.getByLabelText(/A note/),
    ]);
  });

  it("names the reference alone when there is no name to give", () => {
    render(<CancelBooking bookingId="bkg_1" reference="YV-TEST0001" isCash />);
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel this booking" }),
    );
    expect(screen.getByText("Cancel YV-TEST0001?")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is refunded online/)).toBeInTheDocument();
  });
});

/*
  The audit before release, O1: the trigger took itself away when the confirm
  opened, and Keep took itself away on the way out, so a keyboard or
  screen-reader user's focus fell to the page each time.
*/
describe("focus in the cancel confirm", () => {
  it("lands on the question, and Keep it puts it back on the trigger", async () => {
    const user = userEvent.setup();
    render(<CancelBooking bookingId="bkg_1" reference="YV-TEST0001" isCash />);
    await user.click(
      screen.getByRole("button", { name: "Cancel this booking" }),
    );
    expect(screen.getByText("Cancel YV-TEST0001?")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(
      screen.getByRole("button", { name: "Cancel this booking" }),
    ).toHaveFocus();
  });

  it("gives two open on one manifest their own fields", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <CancelBooking bookingId="bkg_1" reference="YV-ONE" isCash />
        <CancelBooking bookingId="bkg_2" reference="YV-TWO" isCash />
      </>,
    );
    for (const trigger of screen.getAllByRole("button", {
      name: "Cancel this booking",
    })) {
      await user.click(trigger);
    }
    // Each label names its own field: two `id="cancel-note"` gave two labels one.
    const notes = screen.getAllByLabelText(/A note/);
    expect(notes).toHaveLength(2);
    expect(notes[0].id).not.toBe(notes[1].id);
    // And each confirms its own booking, not the other's.
    expect(
      [
        ...container.querySelectorAll<HTMLInputElement>(
          "[name=confirmReference]",
        ),
      ].map((input) => input.value),
    ).toEqual(["YV-ONE", "YV-TWO"]);
  });
});
