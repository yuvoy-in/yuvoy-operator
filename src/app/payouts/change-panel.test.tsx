import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/*
  The brake on a bank change in flight (yuvoy-operator#81).

  Stopping cannot be undone: an owner who did ask for the change raises it
  again, with a new code and both clocks from the start. So it is the
  warning-coloured words on the panel, and a confirm that says what happens,
  whose button carries the danger pill. Still no code and no waiting.
*/

const cancelChange = vi.fn();

vi.mock("./actions", () => ({
  cancelChange: (prev: unknown, form: FormData) => cancelChange(prev, form),
}));

const { ChangePanel } = await import("./change-panel");

afterEach(() => cancelChange.mockReset());

function panel(canStop = true) {
  return render(
    <ChangePanel
      id="chg_bank_1"
      state="cooling"
      summary="HDFC Bank ••••4417 · HDFC0001234"
      objectionUntil={null}
      coolingUntil="2026-09-23T03:30:00Z"
      requestedAt="2026-09-21T03:30:00Z"
      canStop={canStop}
    />,
  );
}

describe("stopping a bank change", () => {
  it("is a quiet action that asks first, and says what stopping does", () => {
    panel();
    const brake = screen.getByRole("button", {
      name: "This wasn't me. Stop it",
    });
    // Demoted: words in the warning colour, not a pill (op#81).
    expect(brake.className).toContain("underline");
    expect(brake.className).not.toContain("border-2");

    fireEvent.click(brake);
    expect(screen.getByText("Stop this change?")).toBeInTheDocument();
    expect(
      screen.getByText(/Payouts keep going to the account you have/),
    ).toBeInTheDocument();
    // The confirming button is the danger pill.
    expect(
      screen.getByRole("button", { name: "Stop the change" }).className,
    ).toContain("border-2");
    expect(cancelChange).not.toHaveBeenCalled();
  });

  it("goes back without stopping anything", () => {
    panel();
    fireEvent.click(
      screen.getByRole("button", { name: "This wasn't me. Stop it" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("button", { name: "This wasn't me. Stop it" }),
    ).toBeInTheDocument();
    expect(cancelChange).not.toHaveBeenCalled();
  });

  it("stops it on the second tap, and says so on the panel", async () => {
    cancelChange.mockResolvedValue({ stopped: true });
    panel();
    fireEvent.click(
      screen.getByRole("button", { name: "This wasn't me. Stop it" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop the change" }));

    expect(
      await screen.findByText("Stopped. Nothing was changed."),
    ).toBeInTheDocument();
    expect(cancelChange).toHaveBeenCalledTimes(1);
    expect((cancelChange.mock.calls[0][1] as FormData).get("id")).toBe(
      "chg_bank_1",
    );
  });

  it("offers no brake to a role that cannot use it, and says who can", () => {
    panel(false);
    expect(
      screen.queryByRole("button", { name: "This wasn't me. Stop it" }),
    ).toBeNull();
    expect(
      screen.getByText(/an owner or an admin can stop it/),
    ).toBeInTheDocument();
  });
});
