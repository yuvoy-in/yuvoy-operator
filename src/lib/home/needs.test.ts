import { describe, expect, it } from "vitest";
import type { Standing } from "@/lib/account/standing";
import type { OpenRequest } from "@/lib/day/request-types";
import type { HomeListing } from "./listings";
import { needsYou, requestNeed, type TodayCash } from "./needs";

const TODAY = "2026-09-22"; // a Tuesday
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

const base = {
  standing: standing(),
  suspended: false,
  canManage: true,
  requests: [] as OpenRequest[],
  listings: [listing()],
  cash: [] as TodayCash[],
  unrecorded: 0,
  inbox: { messages: 0, conversations: 0 },
  today: TODAY,
  now: NOW,
};

const keys = (needs: ReturnType<typeof needsYou>) => needs.map((n) => n.key);

/*
  yuvoy-operator#96 block 2, and #82 s2: "requests waiting first, then
  messages, then anything else, and each labelled with the time pressure".
*/
describe("a request, as its row says it", () => {
  it("says how many, which departure, and the clock", () => {
    expect(requestNeed(request(), TODAY)).toMatchObject({
      kind: "request",
      id: "req_1",
      title: "Snorkel trip",
      detail: "3 people · Sat 09:00 · answer within 1h 20m",
      urgent: false,
    });
  });

  it("marks the ones inside the hour", () => {
    expect(requestNeed(request({ minutesToAnswer: 24 }), TODAY).urgent).toBe(
      true,
    );
  });

  it("says today and tomorrow as words, and one person in the singular", () => {
    expect(
      requestNeed(
        request({ guests: 1, startsAt: "2026-09-22T18:00:00Z" }),
        TODAY,
      ).detail,
    ).toBe("1 person · today 23:30 · answer within 1h 20m");
  });

  it("says before the tap when the party will not fit", () => {
    expect(
      requestNeed(request({ guests: 5, seatsGrantable: 3 }), TODAY).short,
    ).toBe("Only 3 seats left, not enough for this party");
    expect(requestNeed(request(), TODAY).short).toBeUndefined();
  });

  it("answers the ceiling exactly as the Bookings queue does", () => {
    /*
      `canGrant` decides it on both screens. The boundary is where a second
      copy of the comparison would drift: a party that exactly fills what is
      left CAN be accepted, and Home saying otherwise would refuse a sale the
      API would have taken.
    */
    expect(
      requestNeed(request({ guests: 4, seatsGrantable: 4 }), TODAY).short,
    ).toBeUndefined();
    expect(
      requestNeed(request({ guests: 4, seatsGrantable: 3 }), TODAY).short,
    ).toBe("Only 3 seats left, not enough for this party");
  });
});

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
          parties: 2,
          collectPaise: 1_000_000,
        },
      ],
      unrecorded: 7,
      inbox: { messages: 3, conversations: 2 },
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
      // Off sale already costs sales now; the cash is due at 09:00.
      "confirm-seats",
      "cash-slot_9",
      "messages",
      "no-dates",
      "unrecorded",
      "account-LOGO_MISSING-0",
    ]);
    expect(needs.find((n) => n.key === "cash-slot_9")).toMatchObject({
      text: "Collect ₹10,000 from 2 parties on the 09:00",
      detail: "Reef dive",
      href: "/today/slot_9",
    });
    expect(needs.find((n) => n.key === "messages")).toMatchObject({
      text: "2 guests wrote to you",
      href: "/messages",
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
        detail: "Soonest: answer within 24 min",
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
          parties: 1,
          collectPaise: null,
        },
      ],
    });
    expect(needs[0]).toMatchObject({
      text: "Collect cash from 1 party on the 17:00",
    });
  });
});
