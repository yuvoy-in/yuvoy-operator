import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Need } from "@/lib/home/needs";
import { VIEW, REQUEST, SEATS, MESSAGE, CASH, props } from "./home-kit";

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
