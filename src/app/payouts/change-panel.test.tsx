import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ChangeState } from "@/lib/account/bank";

/*
  The brake on a bank change in flight.

  Stopping cannot be undone: an owner who did ask for the change raises it
  again, with a new code and both clocks from the start. So it asks once and
  says what happens. But it is the SAFETY action, kept off step-up so the
  brake is never further away than the accelerator, so the control that opens
  the question is a visible danger pill, not the quiet text an action being
  demoted gets (#81). Still no code and no waiting.
*/

const cancelChange = vi.fn();

vi.mock("./actions", () => ({
  cancelChange: (prev: unknown, form: FormData) => cancelChange(prev, form),
}));

const { ChangePanel } = await import("./change-panel");

afterEach(() => cancelChange.mockReset());

function panel({
  canStop = true,
  isOwner = true,
  hasAccountOnFile = true,
  state = "cooling",
}: {
  canStop?: boolean;
  isOwner?: boolean;
  hasAccountOnFile?: boolean;
  state?: ChangeState;
} = {}) {
  return render(
    <ChangePanel
      id="chg_bank_1"
      state={state}
      summary="HDFC Bank ····4417 (HDFC0001234)"
      objectionUntil={null}
      coolingUntil="2026-09-23T03:30:00Z"
      requestedAt="2026-09-21T03:30:00Z"
      canStop={canStop}
      isOwner={isOwner}
      hasAccountOnFile={hasAccountOnFile}
    />,
  );
}

describe("stopping a bank change", () => {
  it("is a visible danger pill that asks first, and says what stopping does", () => {
    panel();
    const brake = screen.getByRole("button", {
      name: "This wasn't me. Stop it",
    });
    // The emergency brake is seen, not demoted to text.
    expect(brake.className).toContain("border-2");

    fireEvent.click(brake);
    expect(screen.getByText("Stop this change?")).toBeInTheDocument();
    expect(
      screen.getByText(/Payouts keep going to the account on file/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /If you did ask for it, you will need to raise it again/,
      ),
    ).toBeInTheDocument();
    // The confirming button is the danger pill.
    expect(
      screen.getByRole("button", { name: "Stop the change" }).className,
    ).toContain("border-2");
    expect(cancelChange).not.toHaveBeenCalled();
  });

  it("promises no account when none is on file, and tells an admin who raises it", () => {
    panel({ isOwner: false, hasAccountOnFile: false });
    fireEvent.click(
      screen.getByRole("button", { name: "This wasn't me. Stop it" }),
    );
    expect(screen.queryByText(/the account on file/)).toBeNull();
    expect(
      screen.getByText(/Nothing about where the money goes is changed/),
    ).toBeInTheDocument();
    // An admin may stop a change and may not raise one.
    expect(
      screen.getByText(
        /If an owner did ask for it, they will need to raise it again/,
      ),
    ).toBeInTheDocument();
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
    // Never "change your sign-in": a sign-in is a code sent each time.
    expect(screen.queryByText(/change your sign-in/)).toBeNull();
    expect(screen.getByText(/call us/)).toBeInTheDocument();
    expect(cancelChange).toHaveBeenCalledTimes(1);
    expect((cancelChange.mock.calls[0][1] as FormData).get("id")).toBe(
      "chg_bank_1",
    );
  });

  it("offers no brake to a role that cannot use it, and says who can", () => {
    panel({ canStop: false });
    expect(
      screen.queryByRole("button", { name: "This wasn't me. Stop it" }),
    ).toBeNull();
    expect(
      screen.getByText(/an owner or an admin can stop it/),
    ).toBeInTheDocument();
  });
});

/*
  yuvoy-operator#143. The form said raising a change "changes nothing today",
  and the API holds the business's payouts from the moment one is raised until
  it settles. This panel is what a raise leaves on screen, so it says so in
  every state the API holds them, and not once the change is stopped.
*/
describe("the hold on payouts", () => {
  it.each<ChangeState>(["objection_window", "pending", "cooling", "approved"])(
    "is said while the change is %s",
    (state) => {
      panel({ state });
      expect(
        screen.getByText(/^Payouts are on hold until it settles\./),
      ).toBeInTheDocument();
    },
  );

  it.each<ChangeState>(["applied", "rejected", "withdrawn"])(
    "is not said for a change that is %s",
    (state) => {
      panel({ state });
      expect(screen.queryByText(/on hold/)).toBeNull();
    },
  );

  it("is not said once the change is stopped", async () => {
    cancelChange.mockResolvedValue({ stopped: true });
    panel({ state: "objection_window" });
    expect(screen.getByText(/on hold/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "This wasn't me. Stop it" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop the change" }));

    expect(
      await screen.findByText("Stopped. Nothing was changed."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/on hold/)).toBeNull();
  });
});
