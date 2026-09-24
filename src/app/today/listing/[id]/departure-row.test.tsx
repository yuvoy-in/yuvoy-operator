import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OperatorSlot } from "@/lib/day/types";

const moveDeparture = vi.fn();
const callOffDeparture = vi.fn();
const closeDeparture = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  moveDeparture: (prev: unknown, form: FormData) => moveDeparture(prev, form),
}));
vi.mock("@/app/today/[slotId]/actions", () => ({
  callOffDeparture: (prev: unknown, form: FormData) =>
    callOffDeparture(prev, form),
}));
vi.mock("@/app/calendar/actions", () => ({
  setCapacity: vi.fn(async () => ({})),
  recordOfflineSale: vi.fn(async () => ({})),
  closeDeparture: (prev: unknown, form: FormData) => closeDeparture(prev, form),
}));

const { DepartureRow } = await import("./departure-row");

beforeEach(() => {
  /*
    A Server Action that answers nothing leaves `useActionState` holding
    `undefined`, which is not a state any of these forms can render. The
    default here is the empty answer, and a test that cares sets its own.
  */
  moveDeparture.mockReset().mockResolvedValue({});
  callOffDeparture.mockReset().mockResolvedValue({});
  closeDeparture.mockReset().mockResolvedValue({});
});

function slot(over: Partial<OperatorSlot> = {}): OperatorSlot {
  return {
    id: "slot_1",
    title: "Snorkel trip at Coral Bay",
    startsAt: "2026-09-24T03:30:00Z", // 09:00 in the market
    timezone: "Asia/Kolkata",
    seats: 8,
    sold: 2,
    remaining: 6,
    bookingMode: "allotment",
    status: "open",
    onSale: true,
    ...over,
  };
}

function row(
  over: Partial<OperatorSlot> = {},
  about: { canManage?: boolean; suspended?: boolean } = {},
) {
  return render(
    <DepartureRow
      slot={slot(over)}
      day="2026-09-24"
      canManage={about.canManage ?? true}
      suspended={about.suspended ?? false}
    />,
  );
}

/*
  One departure on the listing hub (yuvoy-operator#85 s8). The row offered
  five choices of equal weight, one of which cancelled a trip. It shows the
  facts and one tap now, with the rest behind Manage.
*/
describe("a departure on the listing hub", () => {
  it("shows the time, what is sold, and one visible tap", () => {
    row();

    // Ignoring the copy Manage carries for a screen reader, below.
    expect(
      screen.getByText("09:00", { ignore: "script, style, .sr-only" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2/8 sold")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Who is coming" })).toHaveAttribute(
      "href",
      "/today/slot_1",
    );
  });

  it("keeps every other act out of reach until Manage is asked for", () => {
    row();

    for (const name of ["Change time", "Seats", "Stop selling", "Call off"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }

    const manage = screen.getByRole("button", { name: /^Manage/ });
    expect(manage).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(manage);
    expect(manage).toHaveAttribute("aria-expanded", "true");

    for (const name of ["Change time", "Seats", "Stop selling", "Call off"]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }
  });

  /*
    The control that names the panel has to name WHICH departure: a day with
    twenty of them is twenty buttons reading "Manage" to a screen reader.
  */
  it("names the departure it manages, and the panel it opens", () => {
    row();

    const manage = screen.getByRole("button", { name: "Manage 09:00" });
    const panel = document.getElementById(
      manage.getAttribute("aria-controls") ?? "",
    );
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("hidden");
    fireEvent.click(manage);
    expect(panel).not.toHaveAttribute("hidden");
  });

  /*
    "Stop selling" and "Call off" stay two controls with those words: they are
    the two acts an operator confuses. Both are demoted below the row's one
    primary tap (#81), and neither says anything about money on the row.
  */
  it("demotes the two acts that end things, and says no money on the row", () => {
    const { container } = row();
    fireEvent.click(screen.getByRole("button", { name: /^Manage/ }));

    for (const name of ["Stop selling", "Call off"]) {
      const control = screen.getByRole("button", { name });
      expect(control).toHaveClass("text-terra-deep");
      expect(control).not.toHaveClass("border-2");
    }
    expect(container.textContent).not.toMatch(/refund/i);
  });

  it("opens stopping on its own question, with the loud button under it", () => {
    row();
    fireEvent.click(screen.getByRole("button", { name: /^Manage/ }));
    fireEvent.click(screen.getByRole("button", { name: "Stop selling" }));

    expect(
      screen.getByText("Stop selling 09:00 Snorkel trip at Coral Bay?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Anybody already on it stays booked/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop selling it" })).toHaveClass(
      "border-2",
      "border-terra-deep",
    );

    // And "Keep selling" puts the row back, rather than leaving a dead panel.
    fireEvent.click(screen.getByRole("button", { name: "Keep selling" }));
    expect(screen.queryByText(/Anybody already on it stays booked/)).toBeNull();
  });

  it("opens calling off on its own question, naming the time and the money", () => {
    row();
    fireEvent.click(screen.getByRole("button", { name: /^Manage/ }));
    fireEvent.click(screen.getByRole("button", { name: "Call off" }));

    expect(
      screen.getByRole("heading", { name: "Call off 09:00?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Everyone booked is cancelled/)).toHaveTextContent(
      "everything paid online is refunded in full",
    );
    expect(screen.getByRole("button", { name: "Call it off" })).toHaveClass(
      "border-2",
      "border-terra-deep",
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByText(/Everyone booked is cancelled/)).toBeNull();
  });

  /*
    One act at a time. Two confirms open at once on one row is two questions
    with one pair of hands, and the second one is read as the answer to the
    first.
  */
  it("holds one act open at a time", () => {
    row();
    fireEvent.click(screen.getByRole("button", { name: /^Manage/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change time" }));
    expect(screen.getByLabelText("New time")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Call off" }));
    expect(screen.queryByLabelText("New time")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Call off 09:00?" }),
    ).toBeInTheDocument();
  });

  it("sends the departure's own day with a new time", () => {
    row();
    fireEvent.click(screen.getByRole("button", { name: /^Manage/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change time" }));

    fireEvent.change(screen.getByLabelText("New time"), {
      target: { value: "10:30" },
    });
    expect(
      screen.getByText(/Move Snorkel trip at Coral Bay from 09:00 to 10:30\?/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move it" }));
    const form = moveDeparture.mock.calls[0][1] as FormData;
    expect(form.get("slotId")).toBe("slot_1");
    expect(form.get("day")).toBe("2026-09-24");
    expect(form.get("startTime")).toBe("10:30");
  });
});

describe("what a row offers in each state", () => {
  it("gives a staff login the manifest and nothing to manage", () => {
    row({}, { canManage: false });

    expect(
      screen.getByRole("link", { name: "Who is coming" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  /*
    A suspended business can always stop a trip it has already sold, and can
    never take a new one on (#50). So the selling acts go and the one that
    ends things stays.
  */
  it("keeps calling off on a suspended business, and withholds the rest", () => {
    row({}, { suspended: true });
    fireEvent.click(screen.getByRole("button", { name: /^Manage/ }));

    expect(screen.getByRole("button", { name: "Call off" })).toBeVisible();
    for (const name of ["Change time", "Seats", "Stop selling"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("offers nothing to manage on a departure already called off", () => {
    row({ status: "cancelled", onSale: false });

    expect(screen.getByText("Called off")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Manage/ })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Who is coming" }),
    ).toBeInTheDocument();
  });

  it("withholds stopping a departure that is already closed", () => {
    row({ status: "closed", onSale: false });
    fireEvent.click(screen.getByRole("button", { name: /^Manage/ }));

    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop selling" })).toBeNull();
    // The time can still move, and the seats can still be set.
    expect(screen.getByRole("button", { name: "Change time" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Seats" })).toBeVisible();
  });

  /*
    The receipt has to outlive the re-read that follows the write. The panel
    stays mounted by which act is open, not by whether the act is still on
    offer, so a row that has just gone Closed still says what stopping it did.
  */
  it("keeps a receipt in place once the re-read marks the row closed", async () => {
    closeDeparture.mockResolvedValue({
      done: true,
      note: "The bookings already on this departure still stand.",
    });
    const { rerender } = row();
    fireEvent.click(screen.getByRole("button", { name: /^Manage/ }));
    fireEvent.click(screen.getByRole("button", { name: "Stop selling" }));
    fireEvent.click(screen.getByRole("radio", { name: "Weather" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop selling it" }));

    expect(
      await screen.findByText(/is closed to new bookings$/),
    ).toBeInTheDocument();

    rerender(
      <DepartureRow
        slot={slot({ status: "closed", onSale: false })}
        day="2026-09-24"
        canManage
        suspended={false}
      />,
    );
    expect(
      screen.getByText("The bookings already on this departure still stand."),
    ).toBeInTheDocument();
  });
});

/*
  The audit before release: O1, focus in a confirm opened already asked; O8,
  a call-off or a stop taken away while it runs loses its receipt.
*/
describe("an act opened from Manage", () => {
  it("puts focus on its question, and Keep it gives it back to the act", async () => {
    const user = userEvent.setup();
    row();
    await user.click(screen.getByRole("button", { name: "Manage 09:00" }));
    await user.click(screen.getByRole("button", { name: "Call off" }));
    expect(
      screen.getByRole("heading", { name: "Call off 09:00?" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Call off" })).toHaveFocus();
  });

  it("holds a running call-off until its receipt is in", async () => {
    let finish: (value: unknown) => void = () => {};
    callOffDeparture.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const user = userEvent.setup();
    row();
    await user.click(screen.getByRole("button", { name: "Manage 09:00" }));
    await user.click(screen.getByRole("button", { name: "Call off" }));
    await user.click(screen.getAllByRole("radio")[0]);
    await user.type(
      screen.getByLabelText("Type the departure id to confirm"),
      "slot_1",
    );
    await user.click(screen.getByRole("button", { name: "Call it off" }));

    // Nothing on the row can take the panel away while it runs.
    for (const name of ["Seats", "Stop selling", "Call off", "Keep it"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: "Manage 09:00" })).toBeDisabled();

    finish({
      result: {
        bookingsCancelled: 1,
        guestsAffected: 2,
        refundedPaise: 400_000,
        holdsReleased: 0,
      },
    });
    expect(await screen.findByText("What that did")).toBeInTheDocument();
    // And the row is usable again once it has.
    expect(screen.getByRole("button", { name: "Seats" })).toBeEnabled();
  });
});
