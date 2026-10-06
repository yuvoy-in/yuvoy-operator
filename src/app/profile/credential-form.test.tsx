import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/*
  A refused document keeps what was typed (the stability audit, P1-1).

  React resets a form when its action resolves, refusals included. The kind of
  document is a select held in state, so a reset in place drew "Choose one"
  over the hint for the kind still chosen, and the issuer, the number, both
  dates and the notes went with it.
*/

const fileCredential = vi.fn();
vi.mock("./actions", () => ({
  fileCredential: (prev: unknown, form: FormData) => fileCredential(prev, form),
}));

const { CredentialForm } = await import("./credential-form");

afterEach(() => fileCredential.mockReset());

async function fillAndSend() {
  render(<CredentialForm suggested={null} pendingTypes={[]} />);
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  type("Which document", "instructor_cert");
  type("Who issued it", "PADI");
  type("Its number", "PADI-2291");
  type("Issued on", "2025-04-01");
  type("Expires on", "2024-04-01");
  type("Anything we should know", "Renewed every two years.");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send it to us" }));
  });
}

describe("a refused document", () => {
  it("keeps the kind chosen and everything typed", async () => {
    fileCredential.mockResolvedValue({
      field: "expiresOn",
      message: "It has already expired.",
    });
    await fillAndSend();

    expect(
      await screen.findByText("It has already expired."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Which document")).toHaveValue(
      "instructor_cert",
    );
    expect(screen.getByLabelText("Who issued it")).toHaveValue("PADI");
    expect(screen.getByLabelText("Its number")).toHaveValue("PADI-2291");
    expect(screen.getByLabelText("Issued on")).toHaveValue("2025-04-01");
    expect(screen.getByLabelText("Expires on")).toHaveValue("2024-04-01");
    expect(screen.getByLabelText("Anything we should know")).toHaveValue(
      "Renewed every two years.",
    );
  });

  it("says no signal on the form when the request never came back", async () => {
    fileCredential.mockRejectedValue(new TypeError("Failed to fetch"));
    await fillAndSend();

    expect(
      await screen.findByText(
        "No signal. Nothing was sent. We have not got it yet.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Its number")).toHaveValue("PADI-2291");
  });
});
