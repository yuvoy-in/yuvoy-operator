import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  The two reads the chrome gained for yuvoy-operator#80 t1 and #96: whose
  business this is, and how many guests are waiting on a reply.
*/

const listThreads = vi.fn();
const get = vi.fn();

vi.mock("@/lib/messages/fetch", () => ({
  listThreads: (...args: unknown[]) => listThreads(...args),
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ GET: get }),
}));

const { readInbox } = await import("./inbox");
const { readBusinessName } = await import("./business-name");

const row = (unreadCount: number) => ({
  bookingId: "b",
  reference: "YV-1",
  experience: "Dive",
  timezone: "Asia/Kolkata",
  unreadCount,
});

beforeEach(() => {
  listThreads.mockReset();
  get.mockReset();
});

describe("the inbox count", () => {
  it("counts conversations with something unread, and the messages in them", async () => {
    listThreads.mockResolvedValue({
      rows: [row(2), row(0), row(1)],
      complete: true,
    });
    expect(await readInbox("tok-a")).toEqual({
      messages: 3,
      conversations: 2,
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
    expect(await readInbox("tok-b")).toEqual({
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
    expect(await readInbox("tok-d")).toEqual({
      messages: 10,
      conversations: 10,
    });
    expect(listThreads).toHaveBeenCalledTimes(10);
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
