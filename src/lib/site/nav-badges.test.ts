import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  What the root layout hands the chrome: yuvoy-operator#42, #80 t1, #96.
*/

let token: string | null = "tok";
const readMe = vi.fn();
const listOpenRequests = vi.fn();
const readBusinessName = vi.fn();
const readInbox = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  readMe: (t: string) => readMe(t),
  readSessionToken: async () => token,
}));
vi.mock("@/lib/day/requests", () => ({
  listOpenRequests: (t: string) => listOpenRequests(t),
}));
vi.mock("./business-name", () => ({
  readBusinessName: (t: string) => readBusinessName(t),
}));
vi.mock("./inbox", () => ({ readInbox: (t: string) => readInbox(t) }));

const { chromeData } = await import("./nav-badges");

const LIVE = { state: "LIVE", bookable: true, blocking: [], credentials: [] };

beforeEach(() => {
  token = "tok";
  readMe.mockReset().mockResolvedValue({ canManage: true, account: LIVE });
  listOpenRequests.mockReset().mockResolvedValue([{}, {}]);
  readBusinessName.mockReset().mockResolvedValue("Reef Divers Havelock");
  readInbox.mockReset().mockResolvedValue({ messages: 5, conversations: 2 });
});

describe("the chrome's reads", () => {
  it("names the business, counts the inbox by conversation, and draws Money for a manager", async () => {
    const chrome = await chromeData();
    expect(chrome.businessName).toBe("Reef Divers Havelock");
    // Two guests waiting on a reply, not five messages.
    expect(chrome.unread).toBe(2);
    expect(chrome.canManage).toBe(true);
    expect(chrome.badges).toEqual({ bookings: 2, business: 0 });
  });

  it("leaves the inbox count out when it could not be read, rather than saying zero", async () => {
    readInbox.mockResolvedValue(null);
    const chrome = await chromeData();
    expect(chrome).not.toHaveProperty("unread");
    // And a count that failed costs nothing else.
    expect(chrome.businessName).toBe("Reef Divers Havelock");
  });

  it("keeps a real zero, which the inbox then draws as nothing", async () => {
    readInbox.mockResolvedValue({ messages: 0, conversations: 0 });
    expect((await chromeData()).unread).toBe(0);
  });

  it("draws no Money stop for a staff login, or when /me did not answer", async () => {
    readMe.mockResolvedValue({ canManage: false, account: LIVE });
    expect((await chromeData()).canManage).toBe(false);

    readMe.mockRejectedValue(new Error("no signal"));
    const chrome = await chromeData();
    expect(chrome.canManage).toBe(false);
    // The rest still arrives.
    expect(chrome.unread).toBe(2);
  });

  it("reads nothing without a session", async () => {
    token = null;
    const chrome = await chromeData();
    expect(chrome.businessName).toBeNull();
    expect(readBusinessName).not.toHaveBeenCalled();
  });
});
