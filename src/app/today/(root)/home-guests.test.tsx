import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { BookingThread } from "@/lib/messages/thread";
import { SEATS, MESSAGE, CASH, props } from "./home-kit";

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
vi.mock("@/app/calendar/actions", () => ({
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
    expect(sendMessage).toHaveBeenCalledWith(
      "bkg_card",
      "No problem.",
      expect.stringMatching(/^msg_/),
    );
    expect(screen.getByLabelText("Reply to Sofia")).toHaveValue("");
  });

  it("sends the same words again with the same key, so they arrive once", async () => {
    // yuvoy-api#282 item 4: a send whose answer was lost can be sent again.
    reloadThread.mockResolvedValue(THREAD);
    sendMessage.mockResolvedValue({
      ok: false,
      message: "No signal. Nothing was sent. Try again.",
    });
    render(<NeedsYou {...props} needs={[MESSAGE]} />);
    fireEvent.click(screen.getByRole("button", { name: "Read and reply" }));
    const box = await screen.findByLabelText("Reply to Sofia");
    fireEvent.change(box, { target: { value: "On our way" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("alert");
    // Back to Send once the first has finished sending.
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    fireEvent.change(box, { target: { value: "On our way now" } });
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));

    const keys = sendMessage.mock.calls.map((call) => call[2]);
    expect(keys[1]).toBe(keys[0]);
    // Other words are another message, with a key of their own.
    expect(keys[2]).not.toBe(keys[0]);
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

  /*
    The stability audit, P2-2 and P2-3: a request that never came back left
    "Opening" busy for good, and a reply that never came back took Home to the
    error screen, the words with it.
  */
  it("comes back from a conversation that never arrived, ready to try again", async () => {
    reloadThread.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<NeedsYou {...props} needs={[MESSAGE]} />);
    fireEvent.click(screen.getByRole("button", { name: "Read and reply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That conversation did not open. Nothing was marked read.",
    );
    expect(markThreadRead).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).not.toHaveAttribute("aria-busy");
  });

  it("says a reply that never arrived was not sent, and keeps the words", async () => {
    reloadThread.mockResolvedValue(THREAD);
    sendMessage.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<NeedsYou {...props} needs={[MESSAGE]} />);
    fireEvent.click(screen.getByRole("button", { name: "Read and reply" }));
    const box = await screen.findByLabelText("Reply to Sofia");
    fireEvent.change(box, { target: { value: "See you at the jetty" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No signal. Nothing was sent. Try again.",
    );
    expect(box).toHaveValue("See you at the jetty");
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
