import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/*
  A refused bank change keeps what was typed (the stability audit, P1-1).

  React resets a form when its action resolves, refusals included, so a wrong
  code emptied the name on the account, the IFSC and the bank with it, and the
  owner typed all three again to try a second code.
*/

const changeBank = vi.fn();
const requestStepUp = vi.fn();
vi.mock("./actions", () => ({ changeBank, requestStepUp }));

const { BankForm } = await import("./bank-form");

beforeEach(() => {
  changeBank.mockReset();
  requestStepUp.mockReset();
  requestStepUp.mockResolvedValue({ sent: true });
});

async function fillAndRaise() {
  render(<BankForm />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send the code" }));
  });
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  type("Name on the account", "Ravi Kumar");
  type("Account number", "50100123454412");
  type("IFSC", "HDFC0001234");
  type("Bank (optional)", "HDFC Bank");
  type("The code", "482913");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Raise the change" }));
  });
}

describe("a refused bank change", () => {
  it("keeps the account typed, and clears only the code", async () => {
    changeBank.mockResolvedValue({
      field: "code",
      message: "That code did not work. Ask for a new one.",
    });
    await fillAndRaise();

    expect(
      await screen.findByText("That code did not work. Ask for a new one."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name on the account")).toHaveValue(
      "Ravi Kumar",
    );
    expect(screen.getByLabelText("Account number")).toHaveValue(
      "50100123454412",
    );
    expect(screen.getByLabelText("IFSC")).toHaveValue("HDFC0001234");
    expect(screen.getByLabelText("Bank (optional)")).toHaveValue("HDFC Bank");
    // A one-time code is typed again, as it is at sign-in.
    expect(screen.getByLabelText("The code")).toHaveValue("");
  });

  it("says no signal where it was when the request never came back", async () => {
    changeBank.mockRejectedValue(new TypeError("Failed to fetch"));
    await fillAndRaise();

    expect(
      await screen.findByText("No signal. Nothing was changed."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("IFSC")).toHaveValue("HDFC0001234");
  });
});

describe("Send the code", () => {
  it("comes back from a send that never arrived, so it can be tapped again", async () => {
    requestStepUp.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<BankForm />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send the code" }));
    });

    expect(
      await screen.findByText("No signal. No code was sent."),
    ).toBeInTheDocument();
    const again = screen.getByRole("button", { name: "Send the code" });
    expect(again).not.toHaveAttribute("aria-busy");
  });
});
