import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/*
  A refused attestation keeps what was answered (the stability audit, P1-1).

  React resets a form when its action resolves, refusals included. Where the
  footage came from is a choice held in state, so a reset in place drew "We
  filmed it" beside the licence field for the choice still made, and the
  consent question came back unanswered: the one answer this form exists to
  have given on purpose.
*/

const attestRights = vi.fn();
vi.mock("./actions", () => ({
  attestRights: (prev: unknown, form: FormData) => attestRights(prev, form),
}));

const { RightsForm } = await import("./rights-form");

afterEach(() => attestRights.mockReset());

async function answerAndSubmit() {
  render(<RightsForm mediaAssetId="med_1" />);
  const submit = screen.getByRole("button", {
    name: "I confirm this, and submit for review",
  });
  // The statement's hash is worked out in the browser before it can be sent.
  await vi.waitFor(() => expect(submit).toBeEnabled());

  fireEvent.click(screen.getByLabelText(/We paid for it/));
  fireEvent.change(screen.getByLabelText("Which licence?"), {
    target: { value: "INV-2291" },
  });
  fireEvent.click(screen.getByLabelText("Yes, they knew and agreed"));
  fireEvent.change(screen.getByLabelText("Where? (optional)"), {
    target: { value: "Elephant Beach" },
  });
  await act(async () => {
    fireEvent.click(submit);
  });
}

describe("a refused attestation", () => {
  it("keeps where it came from, the licence and the consent answer", async () => {
    attestRights.mockResolvedValue({
      field: "filmedOn",
      message: "Something in the form was not right. Check it and try again.",
    });
    await answerAndSubmit();

    expect(
      await screen.findByText(
        "Something in the form was not right. Check it and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/We paid for it/)).toBeChecked();
    expect(screen.getByLabelText(/We filmed it/)).not.toBeChecked();
    expect(screen.getByLabelText("Which licence?")).toHaveValue("INV-2291");
    expect(screen.getByLabelText("Yes, they knew and agreed")).toBeChecked();
    expect(screen.getByLabelText("Where? (optional)")).toHaveValue(
      "Elephant Beach",
    );
  });

  it("says no signal on the form when the request never came back", async () => {
    attestRights.mockRejectedValue(new TypeError("Failed to fetch"));
    await answerAndSubmit();

    expect(
      await screen.findByText("No signal. Nothing was recorded. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Which licence?")).toHaveValue("INV-2291");
    expect(screen.getByLabelText("Yes, they knew and agreed")).toBeChecked();
  });
});
