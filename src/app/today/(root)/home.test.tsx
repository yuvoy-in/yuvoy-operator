import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Need } from "@/lib/home/needs";
import type { RunDay } from "@/lib/home/day";
import type { RequestView } from "@/lib/day/request-view";
import type { BookingThread } from "@/lib/messages/thread";

const refresh = vi.fn();
const acceptRequest = vi.fn();
const declineRequest = vi.fn();
const confirmSeats = vi.fn();
const reloadThread = vi.fn();
const markThreadRead = vi.fn();
const sendMessage = vi.fn();
const recordCashCollected = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/bookings/actions", () => ({
  acceptRequest: (prev: unknown, form: FormData) => acceptRequest(prev, form),
  declineRequest: (prev: unknown, form: FormData) => declineRequest(prev, form),
}));
vi.mock("@/app/calendar/actions", () => ({
  confirmSeats: (prev: unknown, form: FormData) => confirmSeats(prev, form),
}));
vi.mock("@/app/bookings/[id]/conversation-actions", () => ({
  reloadThread: (id: string) => reloadThread(id),
  markThreadRead: (id: string, upTo: string) => markThreadRead(id, upTo),
  sendMessage: (id: string, text: string) => sendMessage(id, text),
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

const VIEW: RequestView = {
  id: "req_1",
  name: "Reuben Mathai",
  firstName: "Reuben",
  guests: 3,
  title: "Reuben Mathai, 3 people",
  trip: "Snorkel trip · Sat 09:00",
  asked: "Asked 2 h ago · Answer by 07:20",
  clock: "1h 20m left",
  urgent: false,
  seats: "6 seats you can still give",
  short: false,
  preset: null,
  timezone: "Asia/Kolkata",
};

const REQUEST: Need = { kind: "request", key: "request-req_1", view: VIEW };

const SEATS: Need = {
  kind: "confirm-seats",
  key: "confirm-seats",
  text: "19 departures are off sale: seats not confirmed",
};

const MESSAGE: Need = {
  kind: "message",
  key: "message-bkg_card",
  bookingId: "bkg_card",
  reference: "YV-CARD6N7P",
  unread: "2 new",
  trip: "Try-dive at Nemo Reef · Today at 11:30",
};

const CASH: Need = {
  kind: "cash",
  key: "cash-slot_9",
  slotId: "slot_9",
  text: "Collect ₹4,500 on the 11:30",
  detail: "Try-dive at Nemo Reef · 1 party",
  timezone: "Asia/Kolkata",
  parties: [
    {
      bookingId: "bkg_kavya",
      name: "Kavya Iyer",
      reference: "YV-C4SH1A2B",
      guests: 1,
      state: "confirmed",
      cash: { collectPaise: 450_000, collected: false },
    },
  ],
};

const THREAD: BookingThread = {
  messages: [
    {
      id: "m1",
      from: "operator",
      senderName: "Priya Raut",
      text: "You are booked. Meet us at the counter.",
      sentAt: "2026-09-21T10:30:00Z",
    },
    {
      id: "m2",
      from: "traveller",
      senderName: "Sofia Alves",
      text: "I am running about ten minutes behind.",
      sentAt: "2026-09-22T00:50:00Z",
    },
  ],
  complete: true,
  unreadCount: 2,
  canWrite: true,
};

const props = {
  canAnswer: true,
  canAccept: true,
  nextUp: null as string | null,
};

/** Let five held seconds pass, and the answer that follows them land. */
async function pass(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/*
  yuvoy-operator#96 block 2, as operator experiment A finishes it: one ranked
  list, every row done where it stands, and what was just done kept after the
  row it came from has gone.
*/
describe("Needs you", () => {
  it("says nothing needs you, and what is next, when nothing is waiting", () => {
    render(
      <NeedsYou
        {...props}
        needs={[]}
        nextUp="Next: 11:30 Try-dive at Nemo Reef, 5 of 8 booked."
      />,
    );
    const list = screen.getByRole("region", { name: "Needs you" });
    expect(within(list).getByText("Nothing needs you now")).toBeInTheDocument();
    expect(
      within(list).getByText(
        "Next: 11:30 Try-dive at Nemo Reef, 5 of 8 booked.",
      ),
    ).toBeInTheDocument();
  });

  it("names each card, with the traveller first and its own action", () => {
    render(<NeedsYou {...props} needs={[REQUEST, SEATS, MESSAGE, CASH]} />);
    const list = screen.getByRole("region", { name: "Needs you" });
    const request = within(list).getByRole("listitem", {
      name: "Seat request from Reuben Mathai",
    });
    expect(request).toHaveTextContent("Reuben Mathai, 3 people");
    expect(request).toHaveTextContent("1h 20m left");
    expect(request).toHaveTextContent("Answer by 07:20");
    expect(
      within(request).getByRole("button", { name: "Accept" }),
    ).toBeEnabled();
    expect(
      within(list).getByRole("button", { name: "Confirm all" }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole("button", { name: "Read and reply" }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole("button", { name: "Take it party by party" }),
    ).toBeInTheDocument();
  });

  it("does not offer Accept on an account that is on hold, and still lets a traveller go", () => {
    render(<NeedsYou {...props} canAccept={false} needs={[REQUEST]} />);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
  });

  it("will not accept a party the departure has no room for, and says why first", () => {
    render(
      <NeedsYou
        {...props}
        needs={[
          {
            ...REQUEST,
            view: {
              ...VIEW,
              short: true,
              seats: "Only 2 seats left: not enough for this party",
              preset: "party_too_large",
            },
          } as Need,
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(
      screen.getByText("Only 2 seats left: not enough for this party"),
    ).toBeInTheDocument();
    // Declining opens on the reason the card already knew.
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(
      screen.getByRole("radio", { name: "Party too large" }),
    ).toBeChecked();
  });

  it("dials a phone number rather than routing to it", () => {
    render(
      <NeedsYou
        {...props}
        canAccept={false}
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
      />,
    );
    expect(
      screen.getByRole("link", { name: /Your account is on hold/ }),
    ).toHaveAttribute("href", "tel:+918121657657");
  });

  it("names a document about to run out, and where its replacement goes", () => {
    render(
      <NeedsYou
        {...props}
        needs={[
          {
            kind: "document",
            key: "document-0-Insurance",
            text: "Insurance expires 13 October 2026. Listings that need it come down that day.",
            chip: "21 days left",
            action: { href: "/profile#documents", label: "Replace it" },
          },
        ]}
      />,
    );
    const card = screen.getByRole("listitem", {
      name: "A document is running out",
    });
    expect(card).toHaveTextContent("21 days left");
    expect(
      within(card).getByRole("link", { name: "Replace it" }),
    ).toHaveAttribute("href", "/profile#documents");
  });
});

describe("an answer, held five seconds with an Undo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds an accept, sends it after five seconds, and keeps the receipt after the request has left", async () => {
    acceptRequest.mockResolvedValue({
      granted: true,
      receipt:
        "They are holding 3 seats and still have to pay. If they have not paid by 08:00 on Wed 23 Sep, the seats come back to you.",
    });
    const { rerender } = render(<NeedsYou {...props} needs={[REQUEST]} />);

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(
      screen.getByText("Accepting Reuben Mathai, 3 people"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
    await pass(4_000);
    expect(acceptRequest).not.toHaveBeenCalled();

    await pass(1_000);
    expect(acceptRequest).toHaveBeenCalledTimes(1);
    expect(acceptRequest.mock.calls[0][1].get("requestId")).toBe("req_1");
    expect(
      screen.getByText("Seats granted to Reuben Mathai"),
    ).toBeInTheDocument();
    // The list asks the server to catch up, and the receipt does not care.
    expect(refresh).toHaveBeenCalled();

    // What the refreshed page passes once the request has left the queue.
    rerender(<NeedsYou {...props} needs={[]} />);
    expect(
      screen.getByText("Seats granted to Reuben Mathai"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/They are holding 3 seats and still have to pay/),
    ).toBeInTheDocument();
  });

  it("takes an accept back on Undo, sends nothing, and puts focus back on Accept", async () => {
    render(<NeedsYou {...props} needs={[REQUEST]} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await pass(2_000);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.getByRole("button", { name: "Accept" })).toHaveFocus();
    await pass(10_000);
    expect(acceptRequest).not.toHaveBeenCalled();
    expect(screen.getByText(/Undone\. Nothing was sent\./)).toBeInTheDocument();
  });

  it("sends a held answer at once when the page is hidden", async () => {
    acceptRequest.mockResolvedValue({ granted: true });
    render(<NeedsYou {...props} needs={[REQUEST]} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await pass(0);
    expect(acceptRequest).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it("sends a held answer, never drops it, when the list goes away", async () => {
    acceptRequest.mockResolvedValue({ granted: true });
    const { unmount } = render(<NeedsYou {...props} needs={[REQUEST]} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    unmount();
    await pass(0);
    expect(acceptRequest).toHaveBeenCalledTimes(1);
  });

  it("asks why before declining, shows the sentence the traveller reads, then holds it", async () => {
    declineRequest.mockResolvedValue({});
    render(<NeedsYou {...props} needs={[REQUEST]} />);

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.getByRole("group", { name: "Why?" })).toBeInTheDocument();
    // Nothing to send until a reason is chosen.
    expect(screen.getByRole("button", { name: "Decline" })).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "No seats left" }));
    expect(screen.getByText("Reuben reads")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The operator is full on that departure. Nothing was charged.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.getByText("Declining Reuben Mathai")).toBeInTheDocument();
    await pass(5_000);
    expect(declineRequest.mock.calls[0][1].get("reasonCode")).toBe(
      "no_capacity",
    );
    expect(screen.getByText("Declined Reuben Mathai")).toBeInTheDocument();
    expect(
      screen.getByText(
        "They read: The operator is full on that departure. Nothing was charged.",
      ),
    ).toBeInTheDocument();
  });

  it("says a refused answer on the card, and keeps the card to answer again", async () => {
    acceptRequest.mockResolvedValue({
      message: "Already answered, or out of time. Refresh to see the queue.",
    });
    render(<NeedsYou {...props} needs={[REQUEST]} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await pass(5_000);
    expect(screen.getByRole("alert")).toHaveTextContent("Already answered");
    expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
  });

  it("says an answer did not go, where the card was, once the request has left", async () => {
    acceptRequest.mockResolvedValue({
      message: "Already answered, or out of time. Refresh to see the queue.",
    });
    const { rerender } = render(<NeedsYou {...props} needs={[REQUEST]} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await pass(5_000);
    rerender(<NeedsYou {...props} needs={[]} />);
    expect(screen.getByText("Not sent to Reuben Mathai")).toBeInTheDocument();
  });

  it("keeps an answered card where it was when the server drops it", async () => {
    acceptRequest.mockResolvedValue({ granted: true });
    const { rerender } = render(
      <NeedsYou {...props} needs={[SEATS, REQUEST, MESSAGE]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await pass(5_000);
    rerender(<NeedsYou {...props} needs={[SEATS, MESSAGE]} />);
    const rows = within(
      screen.getByRole("region", { name: "Needs you" }),
    ).getAllByRole("listitem");
    expect(rows[1]).toHaveTextContent("Seats granted to Reuben Mathai");
  });
});

describe("a guest, answered on Home", () => {
  it("opens the conversation in place, names the guest, and marks it read", async () => {
    reloadThread.mockResolvedValue(THREAD);
    render(<NeedsYou {...props} needs={[MESSAGE]} />);
    const card = screen.getByRole("listitem", { name: "Message from a guest" });
    expect(card).toHaveTextContent("A guest wrote");
    expect(card).toHaveTextContent("2 new");

    fireEvent.click(
      within(card).getByRole("button", { name: "Read and reply" }),
    );
    expect(
      await screen.findByRole("listitem", { name: "Message from Sofia Alves" }),
    ).toHaveTextContent("Sofia Alves wrote");
    expect(
      screen.getByText("I am running about ten minutes behind."),
    ).toBeInTheDocument();
    expect(reloadThread).toHaveBeenCalledWith("bkg_card");
    expect(markThreadRead).toHaveBeenCalledWith("bkg_card", "m2");
    expect(
      screen.getByRole("link", {
        name: "The whole conversation and the booking",
      }),
    ).toHaveAttribute("href", "/bookings/bkg_card?from=%2Ftoday#conversation");
  });

  it("fills the box from a quick reply, sends only on Send, and says so", async () => {
    reloadThread.mockResolvedValue(THREAD);
    sendMessage.mockResolvedValue({
      ok: true,
      message: {
        id: "m3",
        from: "operator",
        senderName: "Priya Raut",
        text: "No problem.",
        sentAt: "2026-09-22T01:00:00Z",
      },
    });
    render(<NeedsYou {...props} needs={[MESSAGE]} />);
    fireEvent.click(screen.getByRole("button", { name: "Read and reply" }));
    fireEvent.click(await screen.findByRole("button", { name: "No problem." }));
    expect(screen.getByLabelText("Reply to Sofia")).toHaveValue("No problem.");
    expect(sendMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Sent to Sofia Alves.")).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith("bkg_card", "No problem.");
    expect(screen.getByLabelText("Reply to Sofia")).toHaveValue("");
  });

  it("keeps the words when a message is refused, and says why", async () => {
    reloadThread.mockResolvedValue(THREAD);
    sendMessage.mockResolvedValue({
      ok: false,
      message: "Phone numbers cannot be sent here.",
    });
    render(<NeedsYou {...props} needs={[MESSAGE]} />);
    fireEvent.click(screen.getByRole("button", { name: "Read and reply" }));
    const box = await screen.findByLabelText("Reply to Sofia");
    fireEvent.change(box, { target: { value: "Call me on 98765 43210" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Phone numbers cannot be sent here.",
    );
    expect(box).toHaveValue("Call me on 98765 43210");
  });

  it("says a conversation that did not open, and marks nothing read", async () => {
    reloadThread.mockResolvedValue(null);
    render(<NeedsYou {...props} needs={[MESSAGE]} />);
    fireEvent.click(screen.getByRole("button", { name: "Read and reply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That conversation did not open. Nothing was marked read.",
    );
    expect(markThreadRead).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("keeps an opened conversation after the server stops listing it as unread", async () => {
    reloadThread.mockResolvedValue(THREAD);
    const { rerender } = render(<NeedsYou {...props} needs={[MESSAGE]} />);
    fireEvent.click(screen.getByRole("button", { name: "Read and reply" }));
    await screen.findByText("Sofia Alves wrote");
    rerender(<NeedsYou {...props} needs={[]} />);
    expect(screen.getByText("Sofia Alves wrote")).toBeInTheDocument();
    expect(screen.queryByText("Nothing needs you now")).toBeNull();
  });
});

describe("cash, taken party by party on Home", () => {
  it("takes each party's cash where it stands, and keeps the line after the list drops it", async () => {
    recordCashCollected.mockResolvedValue({
      recorded: {
        collectedPaise: 450_000,
        shortfallPaise: 0,
        collectedAt: "2026-09-22T05:40:00Z",
        alreadyRecorded: false,
      },
    });
    const { rerender } = render(<NeedsYou {...props} needs={[CASH]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Take it party by party" }),
    );
    expect(screen.getByText("Kavya Iyer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Take ₹4,500" }));
    expect(await screen.findByRole("status")).toHaveTextContent("₹4,500 taken");
    expect(recordCashCollected.mock.calls[0][1].get("bookingId")).toBe(
      "bkg_kavya",
    );

    // The re-read Home no longer lists this departure's cash.
    rerender(<NeedsYou {...props} needs={[]} />);
    expect(screen.getByText("Kavya Iyer")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("₹4,500 taken");
  });

  it("never offers a stale Take for a party paid on another phone", () => {
    const { rerender } = render(<NeedsYou {...props} needs={[CASH]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Take it party by party" }),
    );
    rerender(<NeedsYou {...props} needs={[]} />);
    expect(screen.queryByRole("button", { name: "Take ₹4,500" })).toBeNull();
    expect(
      screen.getByText("Nothing left to take on this departure."),
    ).toBeInTheDocument();
  });
});

describe("confirming seats", () => {
  it("confirms every listing's seats in one tap, and keeps saying so after the row is gone", async () => {
    confirmSeats.mockResolvedValue({ confirmed: 19 });
    const { rerender } = render(<NeedsYou {...props} needs={[SEATS]} />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm all" }));
    expect(
      await screen.findByText("Seats confirmed on 19 departures"),
    ).toBeInTheDocument();
    // Home sends no listing: every listing's departures are confirmed.
    expect(confirmSeats.mock.calls[0][1].get("experienceId")).toBeNull();

    // The revalidated page no longer has anything off sale.
    rerender(<NeedsYou {...props} needs={[]} />);
    expect(
      screen.getByText("Seats confirmed on 19 departures"),
    ).toBeInTheDocument();
  });

  it("says a refused confirm on the row", async () => {
    confirmSeats.mockResolvedValue({
      message: "No signal. Nothing was confirmed. Try again.",
    });
    render(<NeedsYou {...props} needs={[SEATS]} />);
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
    render(<NeedsYou {...props} needs={[SEATS]} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm all" }));
    expect(
      await screen.findByText("Nothing needed confirming"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Back on sale/)).toBeNull();
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

/*
  O01 A (approved 4 Oct 2026): Today re-reads itself under the operator's
  thumb, and what a re-read changed is marked and said, never moved. The two
  sentences are the owner's words, with the live values.
*/
describe("Needs you, when a re-read changes it", () => {
  const KAVYA: Need = {
    kind: "request",
    key: "request-req_kavya",
    view: {
      ...VIEW,
      id: "req_kavya",
      name: "Kavya Iyer",
      firstName: "Kavya",
      title: "Kavya Iyer, 2 people",
      clock: "18 min left",
      urgent: true,
    },
  };
  const DANIEL: Need = {
    kind: "request",
    key: "request-req_daniel",
    view: {
      ...VIEW,
      id: "req_daniel",
      name: "Daniel Okafor",
      firstName: "Daniel",
      title: "Daniel Okafor, 1 person",
      clock: "3h left",
    },
  };
  const said = () =>
    screen
      .getAllByText(/./, { selector: "[aria-live=polite] > span" })
      .map((el) => el.textContent);

  it("marks nothing and says nothing on the first paint", () => {
    const { container } = render(
      <NeedsYou {...props} needs={[DANIEL, REQUEST]} />,
    );
    expect(container.querySelector(".motion-mark")).toBeNull();
    expect(
      screen.queryAllByText(/./, { selector: "[aria-live=polite] > span" }),
    ).toHaveLength(0);
  });

  it("marks a request that arrives where it lands, and says so once", () => {
    const { rerender } = render(
      <NeedsYou {...props} needs={[DANIEL, REQUEST]} />,
    );
    rerender(<NeedsYou {...props} needs={[KAVYA, DANIEL, REQUEST]} />);
    const kavya = screen.getByRole("listitem", {
      name: "Seat request from Kavya Iyer",
    });
    const tint = kavya.querySelector(":scope > .motion-mark");
    expect(tint).not.toBeNull();
    expect(tint).toHaveAttribute("aria-hidden", "true");
    // Nobody else is marked.
    expect(
      screen
        .getByRole("listitem", { name: "Seat request from Daniel Okafor" })
        .querySelector(".motion-mark"),
    ).toBeNull();
    expect(said()).toEqual(["Seat request from Kavya Iyer, 18 min left."]);
  });

  it("fades out a request answered elsewhere where it stands, then closes up", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <NeedsYou {...props} needs={[DANIEL, REQUEST]} />,
      );
      rerender(<NeedsYou {...props} needs={[REQUEST]} />);
      expect(said()).toEqual(["Daniel Okafor's request is no longer waiting."]);
      // Still drawn while it fades, in its place, and nothing on it answers.
      const daniel = screen.getByText("Daniel Okafor, 1 person").closest("li")!;
      expect(daniel.inert).toBe(true);
      const list = daniel.parentElement!;
      expect(list.firstElementChild).toBe(daniel);

      act(() => vi.advanceTimersByTime(100));
      expect(screen.queryByText("Daniel Okafor, 1 person")).toBeNull();
      expect(
        screen.getByRole("listitem", {
          name: "Seat request from Reuben Mathai",
        }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a guest's message that arrives, and says nothing a request would", () => {
    const { rerender, container } = render(
      <NeedsYou {...props} needs={[REQUEST]} />,
    );
    rerender(<NeedsYou {...props} needs={[REQUEST, MESSAGE]} />);
    expect(container.querySelectorAll(".motion-mark")).toHaveLength(1);
    expect(
      screen.queryAllByText(/./, { selector: "[aria-live=polite] > span" }),
    ).toHaveLength(0);
  });
});
