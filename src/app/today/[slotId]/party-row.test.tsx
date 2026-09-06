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
        <PartyRow party={party} slotId="slot_dawn" departed screening={null} />
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
        <PartyRow party={party} slotId="slot_dawn" departed screening={null} />
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
        <PartyRow party={party} slotId="slot_dawn" departed screening={null} />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: "Here" }));
    expect(markAttendance).toHaveBeenCalled();
  });
});

describe("PartyRow — the medical screener", () => {
  const row = (screening: "flagged" | "outstanding" | null) =>
    render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_dawn"
          departed
          screening={screening}
        />
      </ul>,
    );

  it("says nothing at all when there is no signal", () => {
    /*
      `null` covers two different situations that must look identical: a
      departure that asks nothing (a snorkel trip, where "a false alarm on this
      signal teaches an instructor to skip the column"), and a party who
      answered with nothing flagged (where a tick would be one more thing to
      read past).
    */
    row(null);
    expect(screen.queryByText(/screening answer/i)).toBeNull();
    expect(screen.queryByText(/before boarding/i)).toBeNull();
  });

  it("renders the server's flag, and never says why", () => {
    row("flagged");
    expect(
      screen.getByText("Check with them before boarding."),
    ).toBeInTheDocument();
    // A manifest is read aloud on a jetty. Nothing here may describe a person.
    expect(
      screen.queryByText(/condition|medical history|declared/i),
    ).toBeNull();
  });

  it("marks a party with no answer on record as a statement about our records", () => {
    row("outstanding");
    expect(
      screen.getByText(/No screening answer recorded/),
    ).toBeInTheDocument();
    // Not "has not answered" — that is a claim about them, and an absent
    // record and a refused answer are not the same thing.
    expect(screen.queryByText(/refused|declined|has not answered/i)).toBeNull();
  });

  it("renders one line, never both", () => {
    /*
      "The interesting case is `needsAttention` on a party with
      `declared: false`" — flagged AND never asked. `screeningSignal` collapses
      that to "flagged" on the server; this pins that the row shows only the
      stronger line even so, because two would bury the one that says to stop
      somebody.
    */
    row("flagged");
    expect(screen.queryByText(/No screening answer recorded/)).toBeNull();
  });

  it("cannot be handed what anybody disclosed", () => {
    /*
      A type-level assertion, not a runtime one, and it is the load-bearing
      guard in this file. `PartyRow` is a client component, so anything it
      takes is serialised into the RSC payload in the page's HTML — `clear`
      shipped there for a while without being rendered anywhere.

      @ts-expect-error fails the BUILD if `screening` is ever allowed back onto
      the party prop, which is the only way that leak can return.
    */
    const withScreener = {
      ...party,
      screening: { declared: true, clear: false, needsAttention: false },
    };
    expect(() =>
      render(
        <ul>
          <PartyRow
            // @ts-expect-error `PartyForClient` omits the screener on purpose.
            party={withScreener}
            slotId="slot_dawn"
            departed
            screening={null}
          />
        </ul>,
      ),
    ).not.toThrow();
  });
});
