import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ThreadRow } from "@/lib/messages/thread";

vi.mock("./actions", () => ({ loadMoreThreads: vi.fn() }));

const { ThreadList } = await import("./thread-list");

/*
  A conversation row, read the way a person recognises it (yuvoy-operator#83
  s6). It led with the booking reference in monospace, which is what a support
  agent reads out and not how anybody finds a conversation.
*/
const NOW = Date.parse("2026-09-22T06:00:00Z");

function row(over: Partial<ThreadRow> = {}): ThreadRow {
  return {
    bookingId: "bkg_card",
    reference: "YV-CARD6N7P",
    experience: "Reef dive",
    startsAt: "2026-09-23T04:30:00Z",
    timezone: "Asia/Kolkata",
    lastMessageAt: "2026-09-22T05:48:00Z",
    lastFrom: "traveller",
    unreadCount: 0,
    ...over,
  };
}

function list(rows: ThreadRow[]) {
  return render(<ThreadList initial={{ rows, complete: true }} now={NOW} />);
}

describe("a conversation row", () => {
  it("leads with the trip, then its time, then the last message, and ends with the reference", () => {
    list([row()]);
    const link = screen.getByRole("link");
    const text = link.textContent ?? "";

    const order = [
      "Reef dive",
      "Wed 23 Sep, 10:00",
      "They wrote 12 min ago",
      "YV-CARD6N7P",
    ].map((part) => text.indexOf(part));
    for (const at of order) expect(at).toBeGreaterThanOrEqual(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("marks unread with a dot and says the count to a screen reader", () => {
    list([row({ unreadCount: 2 })]);
    expect(
      screen.getByRole("link", { name: /2 unread messages/ }),
    ).toBeInTheDocument();
    // No number drawn on the row itself: the dot carries it at a glance.
    const link = screen.getByRole("link");
    expect(
      link.querySelector('[aria-hidden="true"].rounded-full'),
    ).not.toBeNull();
  });

  it("says nothing about unread on a conversation that has none", () => {
    list([row({ unreadCount: 0 })]);
    expect(screen.getByRole("link").textContent).not.toMatch(/unread/);
  });

  it("says who wrote last, because that decides whether it needs anybody", () => {
    list([row({ lastFrom: "operator" })]);
    expect(
      within(screen.getByRole("link")).getByText(/^You wrote/),
    ).toBeInTheDocument();
  });

  it("opens the conversation on its booking", () => {
    list([row()]);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/bookings/bkg_card#conversation",
    );
  });

  it("leads with the reference, once, when the trip has no name", () => {
    list([row({ experience: "" })]);
    const text = screen.getByRole("link").textContent ?? "";
    expect(text.match(/YV-CARD6N7P/g)).toHaveLength(1);
  });
});
