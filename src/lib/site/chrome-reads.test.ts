import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  The two reads the chrome gained for yuvoy-operator#80 t1 and #96: whose
  business this is, and how many guests are waiting on a reply.
*/

const listThreads = vi.fn();
const get = vi.fn();
const readMe = vi.fn();

vi.mock("@/lib/messages/fetch", () => ({
  listThreads: (...args: unknown[]) => listThreads(...args),
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ GET: get }),
}));
vi.mock("@/lib/auth/session", () => ({
  readMe: (token: string) => readMe(token),
}));

const { readInbox, readInboxTotals, readUnreadByBooking } =
  await import("./inbox");
const { readBusinessName } = await import("./business-name");

const row = (unreadCount: number, bookingId = "b") => ({
  bookingId,
  reference: "YV-1",
  experience: "Dive",
  timezone: "Asia/Kolkata",
  unreadCount,
});

beforeEach(() => {
  listThreads.mockReset();
  get.mockReset();
  // An API from before yuvoy-api#282 item 6: `/me` counts nothing.
  readMe.mockReset().mockResolvedValue({ canManage: true });
});

describe("the inbox count, walked on an API that does not count it", () => {
  it("counts conversations with something unread, and the messages in them", async () => {
    listThreads.mockResolvedValue({
      rows: [row(2, "b1"), row(0, "b2"), row(1, "b3")],
      complete: true,
    });
    expect(await readInbox("tok-a")).toEqual({
      messages: 3,
      conversations: 2,
      // The unread ones, in the API's order, for Home to answer in place.
      unread: [row(2, "b1"), row(1, "b3")],
      // And by booking, for the manifest's rows.
      unreadByBooking: { b1: 2, b3: 1 },
    });
  });

  it("walks every page, at the API's largest page", async () => {
    listThreads
      .mockResolvedValueOnce({
        rows: [row(1)],
        complete: false,
        nextCursor: "c2",
      })
      .mockResolvedValueOnce({ rows: [row(4)], complete: true });
    expect(await readInbox("tok-b")).toMatchObject({
      messages: 5,
      conversations: 2,
    });
    expect(listThreads.mock.calls[0]).toEqual(["tok-b", undefined, 200]);
    expect(listThreads.mock.calls[1]).toEqual(["tok-b", "c2", 200]);
  });

  it("says it could not read rather than saying nothing is unread", async () => {
    listThreads.mockRejectedValue(new Error("no signal"));
    expect(await readInbox("tok-c")).toBeNull();
  });

  it("stops at its ceiling rather than following a cursor forever", async () => {
    listThreads.mockResolvedValue({
      rows: [row(1)],
      complete: false,
      nextCursor: "again",
    });
    expect(await readInbox("tok-d")).toMatchObject({
      messages: 10,
      conversations: 10,
    });
    expect(listThreads).toHaveBeenCalledTimes(10);
  });

  it("keeps rows for at most twenty unread conversations, and counts them all", async () => {
    listThreads.mockResolvedValue({
      rows: Array.from({ length: 25 }, (_, i) => row(1, `b${i}`)),
      complete: true,
    });
    const inbox = await readInbox("tok-e");
    expect(inbox?.conversations).toBe(25);
    expect(inbox?.unread).toHaveLength(20);
    expect(inbox?.unread[0].bookingId).toBe("b0");
    // The count by booking is not capped: a manifest's party may be the 25th.
    expect(Object.keys(inbox?.unreadByBooking ?? {})).toHaveLength(25);
  });

  it("walks for the stage's count too, and for a departure's rows", async () => {
    listThreads.mockResolvedValue({
      rows: [row(2, "b1"), row(1, "b3")],
      complete: true,
    });
    expect(await readInboxTotals("tok-f")).toEqual({
      messages: 3,
      conversations: 2,
    });
    expect(await readUnreadByBooking("tok-g")).toEqual({ b1: 2, b3: 1 });
  });

  it("walks when /me sends one count and not the other", async () => {
    // A messages total cannot fill a badge that counts guests.
    readMe.mockResolvedValue({ unreadCount: 3 });
    listThreads.mockResolvedValue({ rows: [row(3, "b1")], complete: true });
    expect(await readInboxTotals("tok-h")).toEqual({
      messages: 3,
      conversations: 1,
    });
    expect(listThreads).toHaveBeenCalledWith("tok-h", undefined, 200);
  });

  it("walks when /me did not answer, rather than saying none", async () => {
    readMe.mockRejectedValue(new Error("no signal"));
    listThreads.mockResolvedValue({ rows: [row(1, "b1")], complete: true });
    expect(await readInboxTotals("tok-i")).toEqual({
      messages: 1,
      conversations: 1,
    });
  });

  it("says a departure's counts could not be read rather than zero", async () => {
    listThreads.mockRejectedValue(new Error("no signal"));
    expect(await readUnreadByBooking("tok-j")).toBeNull();
  });
});

describe("the inbox count, on an API that counts it (yuvoy-api#282 item 6)", () => {
  it("takes both counts from /me and reads no conversations for the stage", async () => {
    readMe.mockResolvedValue({ unreadCount: 5, unreadConversations: 2 });
    expect(await readInboxTotals("tok-k")).toEqual({
      messages: 5,
      conversations: 2,
    });
    expect(listThreads).not.toHaveBeenCalled();
  });

  it("reads Home's rows from one page of the unread conversations only", async () => {
    readMe.mockResolvedValue({ unreadCount: 5, unreadConversations: 2 });
    listThreads.mockResolvedValue({
      rows: [row(3, "b1"), row(2, "b2")],
      complete: true,
    });
    expect(await readInbox("tok-l")).toEqual({
      messages: 5,
      conversations: 2,
      unread: [row(3, "b1"), row(2, "b2")],
    });
    expect(listThreads).toHaveBeenCalledTimes(1);
    expect(listThreads).toHaveBeenCalledWith("tok-l", undefined, 20, {
      unread: true,
    });
  });

  it("asks for no rows when nothing is unread", async () => {
    readMe.mockResolvedValue({ unreadCount: 0, unreadConversations: 0 });
    expect(await readInbox("tok-m")).toEqual({
      messages: 0,
      conversations: 0,
      unread: [],
    });
    expect(listThreads).not.toHaveBeenCalled();
  });

  it("keeps the API's count when the page comes back short", async () => {
    // One was read between the two answers: Home says how many more wrote.
    readMe.mockResolvedValue({ unreadCount: 4, unreadConversations: 3 });
    listThreads.mockResolvedValue({
      rows: [row(2, "b1"), row(0, "b2")],
      complete: true,
    });
    expect(await readInbox("tok-n")).toEqual({
      messages: 4,
      conversations: 3,
      unread: [row(2, "b1")],
    });
  });

  it("says Home's rows could not be read rather than drawing none", async () => {
    readMe.mockResolvedValue({ unreadCount: 1, unreadConversations: 1 });
    listThreads.mockRejectedValue(new Error("no signal"));
    expect(await readInbox("tok-o")).toBeNull();
  });
});

describe("the business's name", () => {
  it("is what travellers see", async () => {
    get.mockResolvedValue({
      data: { displayName: " Reef Divers Havelock ", legalName: "RD LLP" },
      error: undefined,
    });
    expect(await readBusinessName("tok-1")).toBe("Reef Divers Havelock");
  });

  it("falls back to the registered name when there is no display name", async () => {
    get.mockResolvedValue({
      data: { displayName: "  ", legalName: "Nemo Reef Watersports" },
      error: undefined,
    });
    expect(await readBusinessName("tok-2")).toBe("Nemo Reef Watersports");
  });

  it("is unknown rather than a stand-in when there is neither", async () => {
    get.mockResolvedValue({ data: {}, error: undefined });
    expect(await readBusinessName("tok-3")).toBeNull();
  });

  it("is unknown when the read is refused or fails", async () => {
    get.mockResolvedValue({
      data: undefined,
      error: new OperatorApiError({
        code: "unauthorized",
        message: "no",
        status: 401,
      }),
    });
    expect(await readBusinessName("tok-4")).toBeNull();

    get.mockRejectedValue(new Error("no signal"));
    expect(await readBusinessName("tok-5")).toBeNull();
  });

  it("never reads a change still in review as the current name", async () => {
    get.mockResolvedValue({
      data: { state: "in_review", next: "We are checking it." },
      error: undefined,
    });
    expect(await readBusinessName("tok-6")).toBeNull();
  });
});
