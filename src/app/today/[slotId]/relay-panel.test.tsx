import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const sendRelay = vi.fn();

vi.mock("./actions", () => ({
  sendRelay: (prev: unknown, form: FormData) => sendRelay(prev, form),
}));

const { RelayPanel } = await import("./relay-panel");

afterEach(() => sendRelay.mockReset());

/*
  yuvoy-operator#88 s3: a "Tell everybody" heading over a button saying "Tell
  everybody on this departure" was the same words twice, where the guest list
  should be. The button carries it now, and says what it does.
*/
describe("messaging a departure", () => {
  it("says what it does and to whom, on the button", () => {
    render(<RelayPanel slotId="slot_dawn" who="everyone booked" />);
    expect(
      screen.getByRole("button", { name: "Message everyone booked" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("offers another message once one has gone", async () => {
    sendRelay.mockResolvedValue({
      intent: "time_change",
      recipients: 3,
      byChannel: { email: 3 },
    });
    render(<RelayPanel slotId="slot_dawn" who="everyone booked" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Message everyone booked" }),
    );
    fireEvent.change(screen.getByLabelText("New time"), {
      target: { value: "09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send it" }));

    expect(
      await screen.findByRole("button", {
        name: "Message everyone booked again",
      }),
    ).toBeInTheDocument();
  });
});
