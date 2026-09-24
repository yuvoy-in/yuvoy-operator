import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Need } from "@/lib/home/needs";
import type { RunDay } from "@/lib/home/day";

const refresh = vi.fn();
const acceptRequest = vi.fn();
const declineRequest = vi.fn();
const confirmSeats = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/bookings/actions", () => ({
  acceptRequest: (prev: unknown, form: FormData) => acceptRequest(prev, form),
  declineRequest: (prev: unknown, form: FormData) => declineRequest(prev, form),
}));
vi.mock("@/app/calendar/actions", () => ({
  confirmSeats: (prev: unknown, form: FormData) => confirmSeats(prev, form),
}));

const { NeedsYou } = await import("./needs-you");
const { StatusLine } = await import("./status-line");
const { DaySheet } = await import("./day-sheet");
const { StartSelling } = await import("./start-selling");
const { Glance, MoneyGlance } = await import("./glance");

afterEach(() => {
  refresh.mockReset();
  acceptRequest.mockReset();
  declineRequest.mockReset();
  confirmSeats.mockReset();
});

const REQUEST: Need = {
  kind: "request",
  key: "request-req_1",
  id: "req_1",
  title: "Snorkel trip",
  detail: "3 people · Sat 09:00 · answer within 1h 20m",
  urgent: false,
  contactName: "Reuben Mathai",
  guests: 3,
  timezone: "Asia/Kolkata",
};

const SEATS: Need = {
  kind: "confirm-seats",
  key: "confirm-seats",
  text: "19 departures are off sale: seats not confirmed",
};

const MESSAGES: Need = {
  kind: "link",
  key: "messages",
  text: "2 guests wrote to you",
  action: "Reply",
  href: "/messages",
  tone: "plain",
};

/*
  yuvoy-operator#96 block 2: one list, one action a row, and the receipts of
  what was just done kept after the rows they came from have gone.
*/
describe("Needs you", () => {
  it("draws nothing at all when nothing is waiting", () => {
    const { container } = render(<NeedsYou needs={[]} canAccept />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names each row and its one action", () => {
    render(<NeedsYou needs={[REQUEST, SEATS, MESSAGES]} canAccept />);
    const list = screen.getByRole("region", { name: "Needs you" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(list).getByText("3 people · Sat 09:00 · answer within 1h 20m"),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole("button", { name: "Confirm all" }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole("link", { name: /2 guests wrote to you/ }),
    ).toHaveAttribute("href", "/messages");
  });

  it("keeps an accept's receipt after the request has left the list", async () => {
    acceptRequest.mockResolvedValue({
      granted: true,
      receipt:
        "They are holding 3 seats and still have to pay. If they have not paid by 08:00 on Wed 23 Sep, the seats come back to you.",
    });
    const { rerender } = render(<NeedsYou needs={[REQUEST]} canAccept />);

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    /*
      The row draws the receipt for its last frame and the list takes it
      over, so wait for the hand-over (the list asks the server to catch up
      as it does) rather than holding on to the row's copy.
    */
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(
      screen.getByText("Seats granted to Reuben Mathai"),
    ).toBeInTheDocument();

    // What the refreshed page passes once the request has left the queue.
    rerender(<NeedsYou needs={[]} canAccept />);
    expect(
      screen.getByText("Seats granted to Reuben Mathai"),
    ).toBeInTheDocument();
    expect(screen.getByText(/still have to pay/)).toBeInTheDocument();
  });

  it("does not offer Accept on an account that is on hold, and still lets a traveller go", () => {
    render(<NeedsYou needs={[REQUEST]} canAccept={false} />);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
  });

  it("asks why before declining, says what happens, and takes the row away", async () => {
    declineRequest.mockResolvedValue({});
    render(<NeedsYou needs={[REQUEST, MESSAGES]} canAccept />);

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.getByRole("group", { name: "Why?" })).toBeInTheDocument();
    // The consequence, before the tap that does it.
    expect(
      screen.getByText("Reuben Mathai is told no, and nothing was charged."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Weather" }));
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));

    await vi.waitFor(() =>
      expect(screen.queryByText("Snorkel trip")).toBeNull(),
    );
    expect(declineRequest.mock.calls[0][1].get("reasonCode")).toBe("weather");
    expect(refresh).toHaveBeenCalled();
    // The rest of the list stands.
    expect(screen.getByText("2 guests wrote to you")).toBeInTheDocument();
  });

  it("says a refused answer on the row, and keeps the row", async () => {
    acceptRequest.mockResolvedValue({
      message: "Already answered, or out of time. Refresh to see the queue.",
    });
    render(<NeedsYou needs={[REQUEST]} canAccept />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Already answered",
    );
    expect(screen.getByText("Snorkel trip")).toBeInTheDocument();
  });

  it("will not accept a party the departure has no room for", () => {
    render(
      <NeedsYou
        needs={[
          {
            ...REQUEST,
            short: "Only 2 seats left, not enough for this party",
          } as Need,
        ]}
        canAccept
      />,
    );
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(
      screen.getByText("Only 2 seats left, not enough for this party"),
    ).toBeInTheDocument();
  });

  it("confirms every listing's seats in one tap, and keeps saying so after the row is gone", async () => {
    confirmSeats.mockResolvedValue({ confirmed: 19 });
    const { rerender } = render(<NeedsYou needs={[SEATS]} canAccept />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm all" }));
    expect(
      await screen.findByText("Seats confirmed on 19 departures"),
    ).toBeInTheDocument();
    // Home sends no listing: every listing's departures are confirmed.
    expect(confirmSeats.mock.calls[0][1].get("experienceId")).toBeNull();

    // The revalidated page no longer has anything off sale.
    rerender(<NeedsYou needs={[]} canAccept />);
    expect(
      screen.getByText("Seats confirmed on 19 departures"),
    ).toBeInTheDocument();
  });

  it("says a refused confirm on the row", async () => {
    confirmSeats.mockResolvedValue({
      message: "No signal. Nothing was confirmed. Try again.",
    });
    render(<NeedsYou needs={[SEATS]} canAccept />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm all" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nothing was confirmed",
    );
  });

  it("says nothing needed confirming rather than confirming nothing", async () => {
    /*
      Zero is a real answer: another device, or the daily email's link, got
      there first. It must not read as "Seats confirmed on 0 departures", and
      it must not promise seats came back on sale.
    */
    confirmSeats.mockResolvedValue({ confirmed: 0 });
    render(<NeedsYou needs={[SEATS]} canAccept />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm all" }));
    expect(
      await screen.findByText("Nothing needed confirming"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Back on sale/)).toBeNull();
  });

  it("dials a phone number rather than routing to it", () => {
    render(
      <NeedsYou
        needs={[
          {
            kind: "link",
            key: "suspended",
            text: "Your account is on hold",
            action: "Call Yuvoy",
            href: "tel:+918121657657",
            tone: "alert",
          },
        ]}
        canAccept={false}
      />,
    );
    expect(
      screen.getByRole("link", { name: /Your account is on hold/ }),
    ).toHaveAttribute("href", "tel:+918121657657");
  });
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
    render(<DaySheet today={TODAY} tomorrow={EMPTY_TOMORROW} next={null} />);
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
        next="tomorrow 09:00"
      />,
    );
    expect(
      screen.getByText("Nothing running today. Next: tomorrow 09:00."),
    ).toBeInTheDocument();
  });

  it("says the departures did not load, with a way to try again", () => {
    render(<DaySheet today={null} tomorrow={null} next={null} />);
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
