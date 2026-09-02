import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PartyRow } from "./party-row";

/**
 * The second tap. A no-show is permanent — the API refuses to overwrite a
 * settled booking — so it is armed by one tap and sent by another, and the
 * screen says so in between.
 */
const markAttendance = vi.fn<
  (prev: unknown, form: FormData) => Promise<object>
>(async () => ({}));
vi.mock("./actions", () => ({
  markAttendance: (prev: unknown, form: FormData) => markAttendance(prev, form),
  sendRelay: vi.fn(async () => ({})),
}));

const party = {
  bookingId: "bk_1",
  reference: "YV-4K2M9P7Q",
  name: "Asha Menon",
  guests: 2,
  state: "confirmed",
  arrived: false,
};

describe("PartyRow — terminal outcomes", () => {
  it("asks before recording a no-show, and records it on the second tap", async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <PartyRow party={party} slotId="slot_dawn" departed />
      </ul>,
    );

    await user.click(screen.getByRole("button", { name: "No-show" }));
    expect(markAttendance).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Mark Asha Menon as a no-show\? This cannot be changed/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm no-show" }));
    expect(markAttendance).toHaveBeenCalledTimes(1);
    const form = markAttendance.mock.calls[0][1];
    expect(form.get("outcome")).toBe("no_show");
    expect(form.get("bookingId")).toBe("bk_1");
  });

  it("can be disarmed", async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <PartyRow party={party} slotId="slot_dawn" departed />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: "Completed" }));
    await user.click(screen.getByRole("button", { name: "Not that" }));
    expect(screen.getByRole("button", { name: "No-show" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
  });

  it("keeps arriving to one tap", async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <PartyRow party={party} slotId="slot_dawn" departed />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: "Here" }));
    expect(markAttendance).toHaveBeenCalled();
  });
});
