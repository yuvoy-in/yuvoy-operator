import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

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

/*
  The stability audit, P1-1. React resets a form when its action resolves,
  refusals included. What is being said is a choice held in state, so a reset
  in place ticked the first one again beside the detail field for the one
  still chosen, and the next send said something nobody picked.
*/
describe("a refused message", () => {
  async function sendIt() {
    render(<RelayPanel slotId="slot_dawn" who="everyone booked" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Message everyone booked" }),
    );
    fireEvent.click(screen.getByLabelText("The meeting point has changed"));
    fireEvent.change(screen.getByLabelText("New meeting point"), {
      target: { value: "Jetty 4" },
    });
    fireEvent.change(screen.getByLabelText("Anything else (optional)"), {
      target: { value: "Past the fuel pump" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send it" }));
    });
  }

  it("keeps what is being said, the detail and the note", async () => {
    sendRelay.mockResolvedValue({
      message:
        "That is the most updates you can send in an hour. This one was not sent. Try again later.",
    });
    await sendIt();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This one was not sent",
    );
    expect(
      screen.getByLabelText("The meeting point has changed"),
    ).toBeChecked();
    expect(screen.getByLabelText("The time has changed")).not.toBeChecked();
    expect(screen.getByLabelText("New meeting point")).toHaveValue("Jetty 4");
    expect(screen.getByLabelText("Anything else (optional)")).toHaveValue(
      "Past the fuel pump",
    );
  });

  it("says no signal in place when the request never came back", async () => {
    sendRelay.mockRejectedValue(new TypeError("Failed to fetch"));
    await sendIt();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No signal. Nothing was sent.",
    );
    expect(screen.getByLabelText("New meeting point")).toHaveValue("Jetty 4");
  });
});
