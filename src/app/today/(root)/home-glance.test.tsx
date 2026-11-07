import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { RunDay } from "@/lib/home/day";

const refresh = vi.fn();
const acceptRequest = vi.fn();
const declineRequest = vi.fn();
const confirmSeats = vi.fn();
const reloadThread = vi.fn();
const markThreadRead = vi.fn();
const sendMessage = vi.fn();
const recordCashCollected = vi.fn();

vi.mock("next/navigation", async (original) => ({
  // The real control flow helpers, which a dropped request goes through.
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh }),
}));
vi.mock("@/app/bookings/actions", () => ({
  acceptRequest: (prev: unknown, form: FormData) => acceptRequest(prev, form),
  declineRequest: (prev: unknown, form: FormData) => declineRequest(prev, form),
}));
vi.mock("@/app/calendar/departure-actions", () => ({
  confirmSeats: (prev: unknown, form: FormData) => confirmSeats(prev, form),
}));
vi.mock("@/app/bookings/[id]/conversation-actions", () => ({
  reloadThread: (id: string) => reloadThread(id),
  markThreadRead: (id: string, upTo: string) => markThreadRead(id, upTo),
  sendMessage: (id: string, text: string, key?: string) =>
    sendMessage(id, text, key),
  loadEarlier: vi.fn(),
}));
vi.mock("@/app/bookings/cash-actions", () => ({
  recordCashCollected: (prev: unknown, form: FormData) =>
    recordCashCollected(prev, form),
}));

const { NeedsYou } = await import("./needs-you");
const { StatusLine } = await import("./status-line");
const { DaySheet } = await import("./day-sheet");
const { StartSelling } = await import("./start-selling");
const { Glance, MoneyGlance } = await import("./glance");

afterEach(() => {
  for (const mock of [
    refresh,
    acceptRequest,
    declineRequest,
    confirmSeats,
    reloadThread,
    markThreadRead,
    sendMessage,
    recordCashCollected,
  ]) {
    mock.mockReset();
  }
});

describe("the selling line", () => {
  it("is plain words with nothing to open when all is well", () => {
    render(
      <StatusLine
        status={{
          tone: "selling",
          line: "Selling · 3 listings live",
          reasons: [],
        }}
      />,
    );
    expect(screen.getByText("Selling · 3 listings live")).toBeInTheDocument();
    expect(screen.queryByRole("group")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
  });

  it("opens onto the reasons, each with its way forward", () => {
    render(
      <StatusLine
        status={{
          tone: "blocked",
          line: "Not selling: 2 documents needed",
          reasons: [
            {
              text: "We still need your insurance certificate",
              href: "/profile#documents",
              action: "Send us the document",
            },
            { text: "A person at Yuvoy is checking it." },
          ],
        }}
      />,
    );
    const details = document.querySelector("details")!;
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Not selling: 2 documents needed"));
    expect(
      screen.getByRole("link", { name: "Send us the document" }),
    ).toHaveAttribute("href", "/profile#documents");
    expect(
      screen.getByText("A person at Yuvoy is checking it."),
    ).toBeInTheDocument();
  });
});

const TODAY: RunDay = {
  heading: "Today · 1 departure · 5 guests",
  summary: "1 departure · 5 guests",
  rows: [
    {
      id: "slot_dawn",
      time: "06:45",
      title: "Try-dive at Nemo Reef",
      state: "Departed",
      tone: "quiet",
      sold: 5,
      seats: 8,
      checkedIn: "1 of 5 checked in",
      collect: "₹9,000 to collect",
    },
  ],
};
const EMPTY_TOMORROW: RunDay = {
  heading: "Tomorrow · 0 departures · 0 guests",
  summary: "0 departures · 0 guests",
  rows: [],
};

describe("the day's sheet", () => {
  it("names each day's section by its whole heading, and draws the counts", () => {
    render(
      <DaySheet
        today={TODAY}
        tomorrow={EMPTY_TOMORROW}
        emptyToday="Nothing running today."
      />,
    );
    const today = screen.getByRole("region", {
      name: "Today · 1 departure · 5 guests",
    });
    const row = within(today).getByRole("link");
    expect(row).toHaveAttribute("href", "/today/slot_dawn");
    expect(row).toHaveTextContent("06:45");
    expect(row).toHaveTextContent("Departed · 1 of 5 checked in");
    expect(row).toHaveTextContent("₹9,000 to collect");
    expect(row).toHaveTextContent("5 of 8 seats sold");
    // The switch is two real radios, today chosen.
    expect(screen.getByRole("radio", { name: "Today" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Tomorrow" })).not.toBeChecked();
  });

  it("says an empty day in one line, with the next boat when the read says so", () => {
    render(
      <DaySheet
        today={{
          ...EMPTY_TOMORROW,
          heading: "Today · 0 departures · 0 guests",
        }}
        tomorrow={EMPTY_TOMORROW}
        emptyToday="Nothing running today. Next: Thu 09:00."
      />,
    );
    expect(
      screen.getByText("Nothing running today. Next: Thu 09:00."),
    ).toBeInTheDocument();
  });

  it("says the departures did not load, with a way to try again", () => {
    render(
      <DaySheet
        today={null}
        tomorrow={null}
        emptyToday="Nothing running today."
      />,
    );
    expect(screen.getAllByText("Departures did not load.")).toHaveLength(2);
    expect(
      screen.getAllByRole("link", { name: "Try again" })[0],
    ).toHaveAttribute("href", "/today");
  });
});

describe("start selling", () => {
  it("counts what is done, ticks it, and opens only what is left and allowed", () => {
    render(
      <StartSelling
        steps={[
          {
            key: "details",
            label: "Tell us about your business",
            done: true,
            href: "/profile",
          },
          {
            key: "documents",
            label: "Send your documents",
            done: false,
            href: "/account/verification",
          },
          { key: "listing", label: "Write your first listing", done: false },
        ]}
      />,
    );
    expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Send your documents" }),
    ).toHaveAttribute("href", "/account/verification");
    expect(screen.getByText("Done:")).toBeInTheDocument();
  });
});

describe("money today", () => {
  it("says the money did not load rather than drawing nothing or zero", () => {
    render(<MoneyGlance line={null} />);
    expect(
      screen.getByRole("link", { name: "Money did not load. Open Money" }),
    ).toHaveAttribute("href", "/earnings");
  });

  it("marks a week that pays less than nothing, and leaves an ordinary one plain", () => {
    /*
      A correction larger than the week earned. It is the one money line an
      operator must read twice, so it is not drawn as the quiet fact the rest
      of them are.
    */
    const { rerender } = render(
      <MoneyGlance
        line={{
          text: "This week -₹2,400 · payout due",
          owedBack: true,
          missing: false,
        }}
      />,
    );
    expect(screen.getByText("This week -₹2,400 · payout due")).toHaveClass(
      "text-terra-deep",
    );

    rerender(
      <MoneyGlance
        line={{
          text: "This week ₹40,150 · payout due",
          owedBack: false,
          missing: false,
        }}
      />,
    );
    expect(screen.getByText("This week ₹40,150 · payout due")).not.toHaveClass(
      "text-terra-deep",
    );
  });
});

describe("the listings at a glance", () => {
  it("says the listings did not load, and opens Business all the same", () => {
    render(
      <Glance
        id="home-listings"
        heading="Listings"
        href="/account"
        text="Listings did not load"
        tone="alert"
      />,
    );
    expect(
      screen.getByRole("link", { name: "Listings did not load" }),
    ).toHaveAttribute("href", "/account");
    expect(
      screen.getByRole("region", { name: "Listings" }),
    ).toBeInTheDocument();
  });
});
