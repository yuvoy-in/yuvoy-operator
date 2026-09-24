import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useConfirmFocus } from "./use-confirm-focus";

/*
  The audit before release, O1: every quiet destructive control took itself
  away when its confirm opened, and "Keep it" took itself away on the way out,
  so a keyboard or screen-reader user's focus fell to the page each time.
*/

/** The common shape: a quiet trigger that becomes its own confirm. */
function Confirm() {
  const [open, setOpen] = useState(false);
  const { trigger, question } = useConfirmFocus(open);
  if (!open) {
    return (
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>
        Cancel this booking
      </button>
    );
  }
  return (
    <div>
      <p ref={question} tabIndex={-1}>
        Cancel YV-1?
      </p>
      <button type="button">Cancel the booking</button>
      <button type="button" onClick={() => setOpen(false)}>
        Keep it
      </button>
    </div>
  );
}

/** A confirm opened already asked, by a control that stays on screen. */
function OpenedAsked({ onKeep }: { onKeep: () => void }) {
  const { question } = useConfirmFocus(true);
  return (
    <div>
      <p ref={question} tabIndex={-1}>
        Call off 09:00?
      </p>
      <button type="button" onClick={onKeep}>
        Keep it
      </button>
    </div>
  );
}

/** The listing hub's Manage row: one act open at a time, the acts stay. */
function ManageRow() {
  const [open, setOpen] = useState<"off" | "seats" | null>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen("off")}>
        Call off
      </button>
      <button type="button" onClick={() => setOpen("seats")}>
        Seats
      </button>
      {open === "off" ? <OpenedAsked onKeep={() => setOpen(null)} /> : null}
      {open === "seats" ? <p>Seats form</p> : null}
    </>
  );
}

describe("focus in a confirm", () => {
  it("moves to the question when it opens, and the next Tab reaches its controls", async () => {
    const user = userEvent.setup();
    render(<Confirm />);
    await user.click(
      screen.getByRole("button", { name: "Cancel this booking" }),
    );
    expect(screen.getByText("Cancel YV-1?")).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Cancel the booking" }),
    ).toHaveFocus();
  });

  it("goes back to the trigger when somebody keeps it", async () => {
    const user = userEvent.setup();
    render(<Confirm />);
    await user.click(
      screen.getByRole("button", { name: "Cancel this booking" }),
    );
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(
      screen.getByRole("button", { name: "Cancel this booking" }),
    ).toHaveFocus();
  });

  it("goes back to the control that opened it, when the screen takes the confirm away", async () => {
    const user = userEvent.setup();
    render(<ManageRow />);
    await user.click(screen.getByRole("button", { name: "Call off" }));
    expect(screen.getByText("Call off 09:00?")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Call off" })).toHaveFocus();
  });

  it("never takes focus from something somebody chose instead", async () => {
    const user = userEvent.setup();
    render(<ManageRow />);
    await user.click(screen.getByRole("button", { name: "Call off" }));
    // Choosing another act takes the confirm away; focus stays on the choice.
    await user.click(screen.getByRole("button", { name: "Seats" }));
    expect(screen.queryByText("Call off 09:00?")).toBeNull();
    expect(screen.getByText("Seats form")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seats" })).toHaveFocus();
  });
});
