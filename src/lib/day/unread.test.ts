import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  Who wrote, by booking, for a departure's rows: off the manifest since
  yuvoy-api#260, the inbox walk on an API from before it.
*/

const readUnreadByBooking = vi.fn();

vi.mock("@/lib/site/inbox", () => ({
  readUnreadByBooking: (token: string) => readUnreadByBooking(token),
}));

const { unreadByParty } = await import("./unread");

beforeEach(() => {
  readUnreadByBooking.mockReset().mockResolvedValue({ b1: 4 });
});

describe("unread messages on a departure", () => {
  it("reads each party's count off the manifest, and walks nothing", async () => {
    const counts = await unreadByParty("tok", {
      totals: { seats: 8, seatsSold: 3 },
      parties: [
        { bookingId: "b1", unreadCount: 2 },
        { bookingId: "b2", unreadCount: 0 },
        // A hold has no conversation, so it carries no count.
        { state: "holding" },
      ],
    });
    expect(counts).toEqual({ b1: 2, b2: 0 });
    expect(readUnreadByBooking).not.toHaveBeenCalled();
  });

  it("takes a count that is not a count as none", async () => {
    const counts = await unreadByParty("tok", {
      parties: [
        { bookingId: "b1", unreadCount: 2 },
        { bookingId: "b2", unreadCount: -1 },
        { bookingId: "b3", unreadCount: 1.5 },
      ],
    });
    expect(counts).toEqual({ b1: 2 });
  });

  it("walks the inbox on a manifest from before the counts", async () => {
    const counts = await unreadByParty("tok-old", {
      totals: { seatsSold: 3 },
      parties: [{ bookingId: "b1" }, { bookingId: "b2" }],
    });
    expect(counts).toEqual({ b1: 4 });
    expect(readUnreadByBooking).toHaveBeenCalledWith("tok-old");
  });

  it("says the walk could not be read rather than zero", async () => {
    readUnreadByBooking.mockResolvedValue(null);
    expect(
      await unreadByParty("tok", { parties: [{ bookingId: "b1" }] }),
    ).toBeNull();
  });

  it("asks nothing for a departure nobody has booked", async () => {
    expect(
      await unreadByParty("tok", { parties: [{ state: "holding" }] }),
    ).toEqual({});
    expect(await unreadByParty("tok", {})).toEqual({});
    expect(readUnreadByBooking).not.toHaveBeenCalled();
  });
});
