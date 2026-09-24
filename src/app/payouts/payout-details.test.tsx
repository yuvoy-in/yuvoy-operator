import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/*
  Payout details: what is on file as text, with one Change button
  (yuvoy-operator#87 s14).

  "The form arrives half filled: IFSC shows HDFC0001234, the account number is
  empty, and the explanation says 'a person confirms the rest with you out of
  band'." Nothing was filled: the IFSC's placeholder was an example IFSC, and
  on a phone in the sun it read as a saved one.
*/

vi.mock("./actions", () => ({
  changeBank: vi.fn(async () => ({})),
  requestStepUp: vi.fn(async () => ({ sent: true })),
}));

const { PayoutDetails } = await import("./payout-details");

const ON_FILE = {
  id: "chg_bank_0",
  line: "HDFC0001234 · account ending 4412",
  bankName: "HDFC Bank",
};

describe("an account on file", () => {
  it("is text with one Change button, and no form until Change", () => {
    render(<PayoutDetails onFile={ON_FILE} refusal={null} />);

    expect(
      screen.getByText("HDFC0001234 · account ending 4412"),
    ).toBeInTheDocument();
    expect(screen.getByText("HDFC Bank")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Change" })).toHaveLength(1);
    expect(screen.queryByLabelText("Account number")).toBeNull();
    expect(screen.queryByLabelText("IFSC")).toBeNull();
  });

  it("opens an empty form, with nothing in it that looks saved", () => {
    render(<PayoutDetails onFile={ON_FILE} refusal={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    for (const field of ["Name on the account", "Account number", "IFSC"]) {
      const input = screen.getByLabelText(field);
      expect(input, field).toHaveValue("");
      // A placeholder is a value on a phone in the sun (op#87 s14).
      expect(input, field).not.toHaveAttribute("placeholder");
    }
    // The shape is said beside the field instead.
    expect(
      screen.getByText("11 characters. The fifth is always a zero."),
    ).toBeInTheDocument();
    // And the words a person outside software uses.
    expect(
      screen.getByText(/We will call you to confirm the account number\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/out of band/)).toBeNull();
    // The one button is the form's now.
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(screen.getByLabelText("Name on the account")).toHaveFocus();
  });

  it("puts the form away with Keep this account, back on Change", () => {
    render(<PayoutDetails onFile={ON_FILE} refusal={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep this account" }));

    expect(screen.queryByLabelText("Account number")).toBeNull();
    expect(screen.getByRole("button", { name: "Change" })).toHaveFocus();
  });

  it("says why it cannot be changed instead of offering a Change that fails", () => {
    render(
      <PayoutDetails
        onFile={ON_FILE}
        refusal="Only the owner can change where the money goes."
      />,
    );
    expect(
      screen.getByText("Only the owner can change where the money goes."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(screen.queryByLabelText("Account number")).toBeNull();
  });
});

describe("nothing on file", () => {
  it("shows the form straight away, with no way to keep an account", () => {
    render(<PayoutDetails onFile={null} refusal={null} />);
    expect(screen.getByLabelText("Account number")).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: "Keep this account" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    // Nothing was asked for, so nothing takes focus or opens a keyboard.
    expect(screen.getByLabelText("Name on the account")).not.toHaveFocus();
  });

  it("says the refusal, and draws no form, for somebody who may not raise one", () => {
    render(
      <PayoutDetails
        onFile={null}
        refusal="Only the owner can change where the money goes."
      />,
    );
    expect(
      screen.getByText("Only the owner can change where the money goes."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Name on the account")).toBeNull();
  });
});
