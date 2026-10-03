import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { BoardingParty } from "@/lib/day/boarding";

const refresh = vi.fn();
const markAttendance = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/today/slot_dawn/boarding",
}));
vi.mock("../actions", () => ({
  markAttendance: (prev: unknown, form: FormData) => markAttendance(prev, form),
  sendRelay: vi.fn(async () => ({})),
}));
vi.mock("@/app/bookings/cash-actions", () => ({
  recordCashCollected: vi.fn(async () => ({})),
}));
vi.mock("@/app/bookings/cancel-actions", () => ({
  cancelBooking: vi.fn(async () => ({})),
}));

const { BoardingScreen } = await import("./boarding-screen");

function row(over: Partial<BoardingParty>) {
  const party: BoardingParty = {
    bookingId: "b1",
    name: "Asha Menon",
    reference: "YV-4K2M9P7Q",
    guests: 2,
    arrived: false,
    state: "confirmed",
    cash: null,
    signal: null,
    unread: 0,
    ...over,
  };
  return {
    party,
    client: {
      bookingId: party.bookingId,
      reference: party.reference,
      name: party.name,
      guests: party.guests,
      state: party.state,
      arrived: party.arrived,
    },
    bookingHref: `/bookings/${party.bookingId}?from=%2Ftoday%2Fslot_dawn%2Fboarding`,
  };
}

const ROWS = [
  row({
    bookingId: "asha",
    cash: { collectPaise: 900_000, collected: false },
    signal: "flagged",
    unread: 2,
  }),
  row({
    bookingId: "daniel",
    name: "Daniel Okafor",
    reference: "YV-7T1N4X8B",
    guests: 1,
    arrived: true,
  }),
  row({ bookingId: "priya", name: "Priya Raghavan", reference: "YV-9Q5R2W6C" }),
];

const props = {
  slotId: "slot_dawn",
  kicker: "Boarding · 07:00 · Beach 3 dive hut",
  title: "07:00 Try-dive at Nemo Reef",
  departed: false,
  calledOff: false,
  seats: "5 of 8 seats sold",
  rows: ROWS,
  timezone: "Asia/Kolkata",
  canManage: true,
  doneHref: "/today/slot_dawn",
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  refresh.mockReset();
  markAttendance.mockReset();
  vi.restoreAllMocks();
});

async function pass(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/*
  Operator experiment D: the manifest built for the jetty at 06:00.
*/
describe("boarding", () => {
  it("reads at arm's length: guests aboard of guests booked, and what is left", () => {
    render(<BoardingScreen {...props} />);
    expect(screen.getByText("aboard").closest("p")).toHaveTextContent(
      "1 of 5 aboard",
    );
    expect(screen.getByText(/parties to come/).closest("p")).toHaveTextContent(
      "2 parties to come · ₹9,000 to take · 5 of 8 seats sold",
    );
  });

  it("lists who is still to come first, by name, with their flags in words", () => {
    render(<BoardingScreen {...props} />);
    const toCome = screen.getByRole("region", { name: "To come · 2" });
    const names = within(toCome)
      .getAllByRole("button", { name: /\. Open$/ })
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Asha Menon, 2 guests, reference YV-4K2M9P7Q, Cash ₹9,000, Medical: talk first, 2 messages. Open",
      "Priya Raghavan, 2 guests, reference YV-9Q5R2W6C. Open",
    ]);
    expect(
      screen.getByRole("region", { name: "Aboard · 1" }),
    ).toHaveTextContent("Daniel Okafor");
  });

  it("finds a party by the last four of the reference", () => {
    render(<BoardingScreen {...props} />);
    fireEvent.change(
      screen.getByLabelText(
        "Find a party by name or the last four of their reference",
      ),
      { target: { value: "w6c" } },
    );
    expect(screen.queryByText("Asha Menon")).toBeNull();
    expect(screen.getByText("Priya Raghavan")).toBeInTheDocument();
  });

  it("says when a search finds nobody", () => {
    render(<BoardingScreen {...props} />);
    fireEvent.change(
      screen.getByLabelText(
        "Find a party by name or the last four of their reference",
      ),
      { target: { value: "Zed" } },
    );
    expect(
      screen.getByText("Nobody on this departure by that name or reference."),
    ).toBeInTheDocument();
  });

  it("moves a party aboard at once, holds it five seconds with Undo, then sends it", async () => {
    markAttendance.mockResolvedValue({});
    render(<BoardingScreen {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Aboard: check in Asha Menon" }),
    );
    const aboard = screen.getByRole("region", { name: "Aboard · 2" });
    expect(aboard).toHaveTextContent("Asha Menon");
    expect(aboard).toHaveTextContent("Checking in");
    expect(screen.getByText("aboard").closest("p")).toHaveTextContent(
      "3 of 5 aboard",
    );
    await pass(4_000);
    expect(markAttendance).not.toHaveBeenCalled();
    await pass(1_000);
    const form = markAttendance.mock.calls[0][1] as FormData;
    expect(form.get("bookingId")).toBe("asha");
    expect(form.get("outcome")).toBe("arrived");
    expect(refresh).toHaveBeenCalled();
  });

  it("takes a check-in back on Undo, and sends nothing", async () => {
    render(<BoardingScreen {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Aboard: check in Asha Menon" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await pass(10_000);
    expect(markAttendance).not.toHaveBeenCalled();
    expect(
      screen.getByRole("region", { name: "To come · 2" }),
    ).toHaveTextContent("Asha Menon");
  });

  it("says no signal before a tap, and offers no check-in while it lasts", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<BoardingScreen {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent("No signal");
    expect(
      screen.getByRole("button", { name: "Aboard: check in Asha Menon" }),
    ).toBeDisabled();
  });

  it("puts the row back, saying why, when nothing was recorded", async () => {
    markAttendance.mockResolvedValue({
      message: "No signal. Nothing was recorded.",
    });
    render(<BoardingScreen {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Aboard: check in Asha Menon" }),
    );
    await pass(5_000);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Asha Menon: No signal. Nothing was recorded.",
    );
    expect(
      screen.getByRole("region", { name: "To come · 2" }),
    ).toHaveTextContent("Asha Menon");
  });

  it("is in sun mode until it is switched off, with no colour of its own", () => {
    const { container } = render(<BoardingScreen {...props} />);
    const sun = screen.getByRole("button", { name: "Sun mode" });
    expect(sun).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector("[data-sun]")).toHaveAttribute(
      "data-sun",
      "on",
    );
    fireEvent.click(sun);
    expect(container.querySelector("[data-sun]")).toHaveAttribute(
      "data-sun",
      "off",
    );
  });

  it("opens a party for everything else about them", () => {
    render(<BoardingScreen {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: /^Asha Menon, 2 guests/ }),
    );
    const sheet = screen.getByRole("dialog", { name: "Asha Menon" });
    expect(
      within(sheet).getByRole("link", { name: "Booking" }),
    ).toHaveAttribute(
      "href",
      "/bookings/asha?from=%2Ftoday%2Fslot_dawn%2Fboarding",
    );
    expect(
      within(sheet).getByRole("link", { name: "2 new messages" }),
    ).toBeInTheDocument();
  });

  it("closes out, rather than boards, once the boat has left", () => {
    render(<BoardingScreen {...props} departed />);
    expect(
      screen.queryByRole("button", { name: /^Aboard: check in/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Close out Asha Menon" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Done" })).toHaveAttribute(
      "href",
      "/today/slot_dawn",
    );
  });

  it("goes back to the departure from the foot, under the thumb", () => {
    render(<BoardingScreen {...props} />);
    expect(screen.getByRole("link", { name: "Done boarding" })).toHaveAttribute(
      "href",
      "/today/slot_dawn",
    );
  });
});
