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
  mode: "Boarding",
  time: "07:00",
  where: "Beach 3 dive hut",
  experience: "Try-dive at Nemo Reef",
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

  it("says no signal before a tap, and offers no check-in with nobody to keep it as", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<BoardingScreen {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent("No signal");
    expect(
      screen.getByRole("button", { name: "Aboard: check in Asha Menon" }),
    ).toBeDisabled();
  });

  /*
    With no signal, signed in (operator experiment D; owner go-ahead and
    storage ruling, 4 Oct 2026): Aboard still works, the check-in is kept on
    the phone after its five seconds, and the strip says what is kept.
  */
  it("keeps a check-in on the phone with no signal, and says so", async () => {
    const { ChromeProvider } =
      await import("@/components/chrome/chrome-context");
    const { offlineWrites } = await import("@/lib/site/offline-writes");
    offlineWrites.forget();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(
      <ChromeProvider
        identity={{ businessName: null, canManage: true, userId: "usr_owner" }}
      >
        <BoardingScreen {...props} />
      </ChromeProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Aboard: check in Asha Menon" }),
    );
    await pass(5_000);

    expect(markAttendance).not.toHaveBeenCalled();
    expect(offlineWrites.list()).toMatchObject([
      { kind: "arrived", bookingId: "asha", slotId: "slot_dawn" },
    ]);
    const aboard = screen.getByRole("region", { name: "Aboard · 2" });
    expect(aboard).toHaveTextContent("Asha Menon");
    expect(aboard).toHaveTextContent("Saved on this phone");
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
      "1 check-in is saved on this phone. They send when the signal is back.",
    );
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

  /*
    The stability audit, P3-5. A party checked in from its own sheet with no
    signal moves to Aboard while the sheet is still open, so the row that
    opened it is gone by the time it closes. Focus went nowhere, and the next
    Tab started again from the top of the page.
  */
  it("gives focus back to the party where it is now, once its sheet closes", async () => {
    const { ChromeProvider } =
      await import("@/components/chrome/chrome-context");
    const { offlineWrites } = await import("@/lib/site/offline-writes");
    offlineWrites.forget();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(
      <ChromeProvider
        identity={{ businessName: null, canManage: true, userId: "usr_owner" }}
      >
        <BoardingScreen {...props} />
      </ChromeProvider>,
    );

    const opener = screen.getByRole("button", {
      name: /^Asha Menon, 2 guests/,
    });
    opener.focus();
    fireEvent.click(opener);
    const sheet = screen.getByRole("dialog", { name: "Asha Menon" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Check in" }));
    await pass(0);
    expect(opener).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    const aboard = screen.getByRole("region", { name: "Aboard · 2" });
    expect(document.activeElement).toBe(
      within(aboard).getByRole("button", { name: /^Asha Menon/ }),
    );
    offlineWrites.forget();
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

/*
  O07 A (approved 4 Oct 2026): where the party went. A tap on Aboard moves the
  row, and the eye can follow it; the headcount rolls; Undo's five seconds
  are a hairline. What the server moves lands as it always has.
*/
describe("boarding, showing where a party went", () => {
  type Played = {
    el: Element;
    frames: Keyframe[];
    options: KeyframeAnimationOptions;
  };
  let played: Played[] = [];
  const saved: Record<string, PropertyDescriptor | undefined> = {};

  beforeEach(() => {
    played = [];
    for (const key of ["getBoundingClientRect", "getClientRects", "animate"]) {
      saved[key] = Object.getOwnPropertyDescriptor(Element.prototype, key);
    }
    Object.defineProperties(Element.prototype, {
      getBoundingClientRect: {
        configurable: true,
        value: () =>
          ({ top: 300, left: 16, width: 360, height: 72 }) as DOMRect,
      },
      getClientRects: { configurable: true, value: () => [{}] },
      animate: {
        configurable: true,
        value(
          this: Element,
          frames: Keyframe[],
          options: KeyframeAnimationOptions,
        ) {
          played.push({ el: this, frames, options });
          return {
            finished: new Promise(() => {}),
            cancel() {},
          } as unknown as Animation;
        },
      },
    });
    vi.stubGlobal("innerHeight", 800);
  });
  afterEach(() => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(Element.prototype, key, descriptor);
      else
        delete (Element.prototype as unknown as Record<string, unknown>)[key];
    }
    vi.unstubAllGlobals();
    document.body
      .querySelectorAll(':scope > [aria-hidden="true"][data-motion]')
      .forEach((layer) => layer.remove());
  });

  const layer = () =>
    document.body.querySelector(
      ':scope > [aria-hidden="true"][data-motion]',
    ) as HTMLElement | null;

  it("fades the row out of To come where it was, and into Aboard a breath later", () => {
    render(<BoardingScreen {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Aboard: check in Asha Menon" }),
    );
    // A picture of the row it left, fading where it stood: 100ms, exit.
    const copy = layer()?.firstElementChild as HTMLElement;
    expect(copy).toHaveTextContent("Asha Menon");
    expect(copy.inert).toBe(true);
    const out = played.find((p) => p.el === copy)!;
    expect(out.options).toMatchObject({ duration: 100, fill: "forwards" });
    // The real row, in Aboard at once, fading in after the copy has gone.
    const aboard = screen.getByRole("region", { name: "Aboard · 2" });
    const arrived = within(aboard).getByText("Asha Menon").closest("li")!;
    const into = played.find((p) => p.el === arrived)!;
    expect(into.frames[0]).toEqual({ opacity: 0 });
    expect(into.options).toMatchObject({ duration: 150, delay: 100 });
  });

  it("rolls the headcount up, and keeps its text the one number", () => {
    render(<BoardingScreen {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Aboard: check in Asha Menon" }),
    );
    const count = screen.getByText("aboard").closest("p")!;
    expect(count).toHaveTextContent("3 of 5 aboard");
    const old = count.querySelector("[data-was]");
    expect(old).toHaveAttribute("data-was", "1");
    expect(old).toHaveAttribute("aria-hidden", "true");
  });

  it("draws Undo's five seconds as a hairline under the word", () => {
    render(<BoardingScreen {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Aboard: check in Asha Menon" }),
    );
    const undo = screen.getByRole("button", { name: "Undo" });
    const hairline = undo.querySelector(".motion-drain") as HTMLElement;
    expect(hairline).toHaveAttribute("aria-hidden", "true");
    expect(hairline).toHaveClass("h-0.5");
    expect(hairline.style.getPropertyValue("--window")).toBe("5000ms");
  });

  it("plays Undo the same way back", () => {
    render(<BoardingScreen {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Aboard: check in Asha Menon" }),
    );
    document.body
      .querySelectorAll(':scope > [aria-hidden="true"][data-motion]')
      .forEach((l) => l.remove());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(layer()?.firstElementChild).toHaveTextContent("Asha Menon");
    expect(
      screen.getByRole("region", { name: "To come · 2" }),
    ).toHaveTextContent("Asha Menon");
  });

  it("moves nothing it did not move: a party checked in elsewhere just lands", () => {
    const { rerender } = render(<BoardingScreen {...props} />);
    rerender(
      <BoardingScreen
        {...props}
        rows={ROWS.map((r) =>
          r.party.bookingId === "priya"
            ? { ...r, party: { ...r.party, arrived: true } }
            : r,
        )}
      />,
    );
    expect(layer()).toBeNull();
    // No row slid, faded or rolled: the server's change simply lands.
    expect(played.filter((p) => p.el.tagName === "LI")).toHaveLength(0);
  });
});
