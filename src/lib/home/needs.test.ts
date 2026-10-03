import { describe, expect, it } from "vitest";
import type { Standing } from "@/lib/account/standing";
import type { OpenRequest } from "@/lib/day/request-types";
import type { HomeListing } from "./listings";
import type { ThreadRow } from "@/lib/messages/thread";
import { needsYou, type CashParty, type TodayCash } from "./needs";

const TODAY = "2026-09-22"; // a Tuesday
const TOMORROW = "2026-09-23";
const NOW = Date.parse("2026-09-22T00:30:00Z"); // 06:00 in the market

const standing = (over: Partial<Standing> = {}): Standing => ({
  state: "LIVE",
  bookable: true,
  blocking: [],
  credentials: [],
  requiredDocuments: [],
  ...over,
});

function request(over: Partial<OpenRequest> = {}): OpenRequest {
  return {
    id: "req_1",
    experience: "Snorkel trip",
    guests: 3,
    // Saturday 09:00 in the market.
    startsAt: "2026-09-26T03:30:00Z",
    timezone: "Asia/Kolkata",
    contactName: "Reuben Mathai",
    seatsGrantable: 6,
    minutesToAnswer: 80,
    ...over,
  };
}

const listing = (over: Partial<HomeListing> = {}): HomeListing => ({
  id: "exp_1",
  title: "Dawn dive",
  status: "live",
  publicationState: "published",
  sentBack: false,
  bookableDatesNext30Days: 10,
  departuresNotOnSale: 0,
  departuresGoingOffSaleSoon: 0,
  ...over,
});

const party = (over: Partial<CashParty> = {}): CashParty => ({
  bookingId: "bkg_1",
  name: "Asha Menon",
  reference: "YV-4K2M9P7Q",
  guests: 2,
  state: "confirmed",
  cash: { collectPaise: 500_000, collected: false },
  ...over,
});

const thread = (over: Partial<ThreadRow> = {}): ThreadRow => ({
  bookingId: "bkg_card",
  reference: "YV-CARD6N7P",
  experience: "Reef dive",
  // 11:30 today in the market, after NOW.
  startsAt: "2026-09-22T06:00:00Z",
  timezone: "Asia/Kolkata",
  unreadCount: 2,
  ...over,
});

const NO_INBOX = { messages: 0, conversations: 0, unread: [] as ThreadRow[] };

const base = {
  standing: standing(),
  suspended: false,
  canManage: true,
  requests: [] as OpenRequest[],
  listings: [listing()],
  cash: [] as TodayCash[],
  unrecorded: 0,
  inbox: NO_INBOX,
  today: TODAY,
  tomorrow: TOMORROW,
  now: NOW,
};

const keys = (needs: ReturnType<typeof needsYou>) => needs.map((n) => n.key);

/*
  yuvoy-operator#96 block 2, and #82 s2: "requests waiting first, then
  messages, then anything else, and each labelled with the time pressure".
  The request card's own words are `request-view.test.ts`.
*/
describe("what needs the operator", () => {
  it("draws nothing when nothing is waiting", () => {
    expect(needsYou(base)).toEqual([]);
  });

  it("puts requests first, then clocks, then guests who wrote, then chores", () => {
    const needs = needsYou({
      ...base,
      requests: [
        request({ id: "r1", minutesToAnswer: 24 }),
        request({ id: "r2" }),
      ],
      listings: [
        listing({ departuresNotOnSale: 2 }),
        listing({
          id: "exp_t2",
          title: "test2Activity",
          bookableDatesNext30Days: 0,
        }),
      ],
      cash: [
        {
          slotId: "slot_9",
          startsAt: "2026-09-22T03:30:00Z",
          timezone: "Asia/Kolkata",
          title: "Reef dive",
          parties: [party(), party({ bookingId: "bkg_2", name: "Kavya Iyer" })],
        },
      ],
      unrecorded: 7,
      inbox: {
        messages: 3,
        conversations: 2,
        unread: [
          // About a departure later today: on that departure's clock.
          thread(),
          // About another day: after everything with a clock.
          thread({
            bookingId: "bkg_old",
            reference: "YV-OLD12345",
            startsAt: "2026-09-26T03:30:00Z",
            unreadCount: 1,
          }),
        ],
      },
      standing: standing({
        blocking: [
          {
            code: "LOGO_MISSING",
            label: "We still need your logo",
            waitingOn: "operator",
            gates: false,
          },
        ],
      }),
    });

    expect(keys(needs)).toEqual([
      "request-r1",
      "request-r2",
      // Off sale already costs sales now; the cash is due at 09:00, and the
      // guest writing about the 11:30 is on that departure's clock.
      "confirm-seats",
      "cash-slot_9",
      "message-bkg_card",
      "message-bkg_old",
      "no-dates",
      "unrecorded",
      "account-LOGO_MISSING-0",
    ]);
    expect(needs.find((n) => n.key === "cash-slot_9")).toMatchObject({
      kind: "cash",
      text: "Collect ₹10,000 on the 09:00",
      detail: "Reef dive · 2 parties",
      slotId: "slot_9",
    });
    expect(needs.find((n) => n.key === "message-bkg_card")).toEqual({
      kind: "message",
      key: "message-bkg_card",
      bookingId: "bkg_card",
      reference: "YV-CARD6N7P",
      unread: "2 new",
      trip: "Reef dive · Today at 11:30",
    });
    expect(needs.find((n) => n.key === "request-r1")).toMatchObject({
      kind: "request",
      view: { title: "Reuben Mathai, 3 people", clock: "24 min left" },
    });
    expect(needs.find((n) => n.key === "no-dates")).toMatchObject({
      text: "test2Activity has no dates in the next 30 days",
      action: "Add departures",
      href: "/today/listing/exp_t2",
    });
    expect(needs.find((n) => n.key === "unrecorded")).toMatchObject({
      text: "7 past cash trips have no payment recorded",
      href: "/cash#unrecorded",
    });
    expect(needs.find((n) => n.key === "account-LOGO_MISSING-0")).toMatchObject(
      {
        text: "We still need your logo",
        action: "Add your logo",
        href: "/logo",
      },
    );
  });

  it("shows three requests and hands the rest to Bookings", () => {
    const needs = needsYou({
      ...base,
      requests: ["a", "b", "c", "d", "e"].map((id) => request({ id })),
    });
    expect(keys(needs)).toEqual([
      "request-a",
      "request-b",
      "request-c",
      "requests-more",
    ]);
    expect(needs[3]).toMatchObject({
      text: "2 more requests waiting",
      href: "/bookings?view=requests",
    });
  });

  it("offers three guests to answer and hands the rest to Messages", () => {
    const unread = ["a", "b", "c", "d"].map((id) =>
      thread({ bookingId: id, startsAt: "2026-09-26T03:30:00Z" }),
    );
    const needs = needsYou({
      ...base,
      inbox: { messages: 9, conversations: 5, unread },
    });
    expect(keys(needs)).toEqual([
      "message-a",
      "message-b",
      "message-c",
      "messages-more",
    ]);
    // Five conversations are unread, whatever the walk kept rows for.
    expect(needs[3]).toMatchObject({
      text: "2 more guests wrote to you",
      href: "/messages",
    });
  });

  it("names a document about to take listings down, by the day it runs out", () => {
    const insured = standing({
      credentials: [
        {
          id: "c1",
          type: "insurance",
          state: "verified",
          hasFile: true,
          mandatory: true,
          // 21 market days after TODAY.
          expiresOn: "2026-10-13",
        },
      ],
    });
    const needs = needsYou({ ...base, standing: insured });
    expect(needs).toEqual([
      {
        kind: "document",
        key: "document-0-Insurance",
        text: "Insurance expires 13 October 2026. Listings that need it come down that day.",
        chip: "21 days left",
        action: { href: "/profile#documents", label: "Replace it" },
      },
    ]);
    // A staff phone is not who renews it, and an account on hold cannot.
    expect(needsYou({ ...base, standing: insured, canManage: false })).toEqual(
      [],
    );
    expect(
      needsYou({ ...base, standing: insured, suspended: true }).map(
        (n) => n.key,
      ),
    ).toEqual(["suspended"]);
    // Outside the renewal window it is not news yet.
    expect(
      needsYou({
        ...base,
        standing: standing({
          credentials: [
            {
              id: "c1",
              type: "insurance",
              state: "verified",
              hasFile: true,
              mandatory: true,
              expiresOn: "2027-03-01",
            },
          ],
        }),
      }),
    ).toEqual([]);
  });

  it("says the messages did not load, rather than drawing nothing", () => {
    /*
      Nothing is what an empty inbox draws, and with nothing else waiting
      "Needs you" went away.
    */
    expect(needsYou({ ...base, inbox: null })).toEqual([
      expect.objectContaining({
        key: "messages-failed",
        text: "Messages did not load",
        href: "/messages",
      }),
    ]);
    // An inbox that answered with nothing unread still draws nothing.
    expect(needsYou(base)).toEqual([]);
  });

  it("says the requests did not load, rather than that there are none", () => {
    expect(needsYou({ ...base, requests: null })).toEqual([
      expect.objectContaining({
        key: "requests-failed",
        text: "Requests did not load",
        href: "/bookings?view=requests",
        tone: "alert",
      }),
    ]);
  });

  it("gives a staff login the queue as one row, and nothing it would be refused", () => {
    const needs = needsYou({
      ...base,
      canManage: false,
      requests: [request({ minutesToAnswer: 24 }), request({ id: "r2" })],
      listings: [
        listing({ departuresNotOnSale: 3, bookableDatesNext30Days: 0 }),
      ],
      unrecorded: 7,
      standing: standing({
        blocking: [
          {
            code: "LOGO_MISSING",
            label: "We still need your logo",
            waitingOn: "operator",
            gates: false,
          },
        ],
      }),
    });
    expect(needs).toEqual([
      {
        kind: "link",
        key: "requests-staff",
        text: "2 requests are waiting on an answer",
        detail: "Soonest: 24 min left",
        action: "Open Bookings",
        href: "/bookings?view=requests",
        tone: "alert",
      },
    ]);
  });

  it("leads with what stops the business selling, and keeps what does not for last", () => {
    const needs = needsYou({
      ...base,
      requests: [request()],
      standing: standing({
        bookable: false,
        blocking: [
          {
            code: "LOGO_MISSING",
            label: "We still need your logo",
            waitingOn: "operator",
            gates: false,
          },
          {
            code: "CREDENTIAL_EXPIRED",
            label: "Your insurance certificate has expired",
            waitingOn: "operator",
            gates: true,
          },
          {
            code: "AWAITING_REVIEW",
            label: "A person at Yuvoy is checking it.",
            waitingOn: "yuvoy",
            gates: true,
          },
        ],
      }),
    });
    expect(keys(needs)).toEqual([
      "account-CREDENTIAL_EXPIRED-0",
      "request-req_1",
      "account-LOGO_MISSING-2",
    ]);
    expect(needs[0]).toMatchObject({
      text: "Your insurance certificate has expired",
      action: "Send us the document",
      tone: "alert",
    });
  });

  it("leads with the call to make when the account is on hold, and offers nothing it refuses", () => {
    const needs = needsYou({
      ...base,
      suspended: true,
      listings: [
        listing({ departuresNotOnSale: 3, bookableDatesNext30Days: 0 }),
      ],
    });
    expect(needs).toEqual([
      {
        kind: "link",
        key: "suspended",
        text: "Your account is on hold",
        action: "Call Yuvoy",
        href: "tel:+918121657657",
        tone: "alert",
      },
    ]);
  });

  it("warns before departures go off sale, after what is off sale already", () => {
    const needs = needsYou({
      ...base,
      listings: [listing({ departuresGoingOffSaleSoon: 4 })],
    });
    expect(needs).toEqual([
      {
        kind: "confirm-seats",
        key: "confirm-seats",
        text: "4 departures go off sale within a day",
        detail: "Unless the seats are confirmed",
      },
    ]);
  });

  it("groups live listings with nothing to sell once there is more than one", () => {
    const needs = needsYou({
      ...base,
      listings: [
        listing({ bookableDatesNext30Days: 0 }),
        listing({ id: "exp_2", bookableDatesNext30Days: 0 }),
      ],
    });
    expect(needs).toEqual([
      expect.objectContaining({
        text: "2 live listings have no dates in the next 30 days",
        href: "/calendar",
      }),
    ]);
  });

  it("says cash with no amount when a fare did not come back", () => {
    const needs = needsYou({
      ...base,
      cash: [
        {
          slotId: "s",
          startsAt: "2026-09-22T11:30:00Z",
          timezone: "Asia/Kolkata",
          title: "Sunset cruise",
          parties: [party({ cash: { collectPaise: null, collected: false } })],
        },
      ],
    });
    expect(needs[0]).toMatchObject({
      text: "Collect cash on the 17:00",
      detail: "Sunset cruise · 1 party",
    });
  });
});
