/**
 * Fixtures for the operator portal.
 *
 * Times are anchored to "today in Asia/Kolkata" at fixed clock times rather
 * than to fixed dates. O10 is the screen for TODAY: a fixture pinned to
 * 18 August renders an empty day on every other day of the year, and an empty
 * screen is the one thing a manifest fixture must never be.
 */

/*
  `GET /me` is "who am I and what may I do", so `name` is the PERSON, not the
  business — `operatorId` is the business. The two were the same value here
  until O5 put the signed-in user in a list beside their colleagues, where a
  row named after the dive shop reads as a shared login rather than an owner.
*/
export const OPERATOR = {
  id: "usr_havelock_owner",
  name: "Priya Raut",
  roles: ["OWNER"],
  operatorId: "op_nemo_reef",
  canManage: true,
};

const TZ = "Asia/Kolkata";

/** The market's calendar date, `YYYY-MM-DD`, `dayOffset` days from now. */
function marketDay(dayOffset = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(
    new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000),
  );
}

/** An instant today at a given IST wall-clock time. */
export function todayAt(hhmm: string, dayOffset = 0): string {
  return new Date(`${marketDay(dayOffset)}T${hhmm}:00+05:30`).toISOString();
}

/**
 * An instant that has **already happened**, and is still today.
 *
 * A wall-clock literal cannot promise both. `slot_dawn` was pinned to 06:45
 * and the suite that depends on it having departed was therefore red between
 * midnight and quarter to seven every morning — nobody noticed, because nobody
 * runs it then. Its counterpart was pinned to 23:30 and went red at 23:30,
 * which is how this was found: `pnpm verify` refused a push at 23:36.
 *
 * Clamped to the start of the market's day so it never slides into yesterday
 * and out of the `from=today&to=today` window the day screen filters on.
 * `hasDeparted` compares with `>=`, so the clamp is still "departed" at the
 * stroke of midnight.
 */
export function earlierToday(hoursBack = 3): string {
  const dayStart = Date.parse(`${marketDay()}T00:00:00+05:30`);
  return new Date(
    Math.max(dayStart, Date.now() - hoursBack * 60 * 60 * 1000),
  ).toISOString();
}

export interface MockParty {
  bookingId: string;
  reference: string;
  name: string;
  guests: number;
  state: string;
  arrived: boolean;
  arrivedAt?: string;
}

export interface MockSlot {
  id: string;
  experienceId: string;
  title: string;
  startsAt: string;
  timezone: string;
  seats: number;
  sold: number;
  remaining: number;
  /**
   * Held seats, or the operator answering.
   *
   * Optional here as it is in the contract, and one fixture leaves it out on
   * purpose: a row that says nothing about its mode is the only way to test
   * that the screen says nothing either, rather than defaulting to
   * `allotment` and claiming seats are held that are not.
   */
  bookingMode?: "allotment" | "request";
  status: string;
  meetingPoint: string;
  calledOff?: { reasonCode: string };
  parties: MockParty[];
  seatsSoldOffline: number;
}

/**
 * Three departures, chosen to put every state of the screen on the day.
 *
 * The 06:45 one has already left in the market's morning, so the terminal
 * outcomes are reachable; the 11:00 one has not, so they are correctly absent;
 * the 15:30 one is called off.
 */
export const SLOTS: MockSlot[] = [
  {
    id: "slot_dawn",
    experienceId: "exp_try_dive",
    title: "Try-dive at Nemo Reef",
    // Has departed, at every hour of the day. See `earlierToday`.
    startsAt: earlierToday(),
    timezone: TZ,
    seats: 8,
    sold: 5,
    remaining: 3,
    bookingMode: "allotment",
    status: "open",
    meetingPoint: "Beach 3 dive hut, 06:30",
    seatsSoldOffline: 2,
    parties: [
      {
        bookingId: "bkg_1",
        reference: "YV-4K2M9P7Q",
        name: "Asha Menon",
        guests: 2,
        state: "confirmed",
        arrived: false,
      },
      {
        bookingId: "bkg_2",
        reference: "YV-7T1N4X8B",
        name: "Daniel Okafor",
        guests: 1,
        state: "confirmed",
        arrived: true,
        arrivedAt: todayAt("06:31"),
      },
      {
        bookingId: "bkg_3",
        reference: "YV-9Q5R2W6C",
        name: "Priya Raghavan",
        guests: 2,
        state: "confirmed",
        arrived: false,
      },
      // A live hold: mid-checkout, no bookingId, may still walk up.
      {
        bookingId: "",
        reference: "YV-3H8L1V4D",
        name: "Marco Bianchi",
        guests: 2,
        state: "holding",
        arrived: false,
      },
    ],
  },
  {
    id: "slot_late_morning",
    experienceId: "exp_snorkel",
    title: "Snorkel trip to Elephant Beach",
    /*
      Has NOT departed, at every hour of the day — which "later today" cannot
      promise, because at 23:40 there is no later today. Tomorrow morning can.
      It is reached by id rather than from the day list, and `/capacity` covers
      a fortnight, so nothing needs it to be today.
    */
    startsAt: todayAt("09:00", 1),
    timezone: TZ,
    seats: 12,
    sold: 1,
    remaining: 11,
    /*
      The one the screen must not guess. Nothing is held on a request-mode
      departure until the operator answers, so "11 left" read as held seats is
      a promise Yuvoy cannot keep.
    */
    bookingMode: "request",
    status: "open",
    meetingPoint: "Havelock jetty, gate 2",
    seatsSoldOffline: 0,
    parties: [
      {
        bookingId: "bkg_4",
        reference: "YV-6M2K8P1S",
        name: "Nadia Farouk",
        guests: 3,
        state: "confirmed",
        arrived: false,
      },
    ],
  },
  /*
    Two departures that exist only to be called off, one per Playwright
    project. Calling off mutates state in the shared Next server process and
    is the one action that cannot be undone — so a slot two tests can both
    cancel is a race in the FIXTURE, and it would take the relay panel away
    from whichever test ran second.
  */
  {
    id: "slot_calloff_a",
    experienceId: "exp_snorkel",
    title: "Sunset cruise (call-off fixture A)",
    startsAt: todayAt("17:00"),
    timezone: TZ,
    seats: 10,
    sold: 2,
    remaining: 8,
    status: "open",
    meetingPoint: "Havelock jetty, gate 1",
    seatsSoldOffline: 0,
    parties: [
      {
        bookingId: "bkg_ca_1",
        reference: "YV-1A2B3C4D",
        name: "Elena Rossi",
        guests: 2,
        state: "confirmed",
        arrived: false,
      },
    ],
  },
  {
    id: "slot_calloff_b",
    experienceId: "exp_snorkel",
    title: "Sunset cruise (call-off fixture B)",
    startsAt: todayAt("17:30"),
    timezone: TZ,
    seats: 10,
    sold: 3,
    remaining: 7,
    status: "open",
    meetingPoint: "Havelock jetty, gate 1",
    seatsSoldOffline: 0,
    parties: [
      {
        bookingId: "bkg_cb_1",
        reference: "YV-5E6F7G8H",
        name: "Ravi Shankar",
        guests: 3,
        state: "confirmed",
        arrived: false,
      },
    ],
  },
  {
    id: "slot_called_off",
    experienceId: "exp_charter",
    title: "Private boat charter, whole day",
    startsAt: todayAt("15:30"),
    timezone: TZ,
    seats: 6,
    sold: 4,
    remaining: 0,
    status: "cancelled",
    meetingPoint: "Beach 5 slipway",
    seatsSoldOffline: 0,
    calledOff: { reasonCode: "weather" },
    parties: [],
  },
];

export const DEV_CODE = "424242";

export interface MockRequest {
  id: string;
  slotId: string;
  experience: string;
  guests: number;
  startsAt: string;
  timezone: string;
  requestedAt: string;
  expiresAt: string;
  contactName: string;
  seatsGrantable: number;
  minutesToAnswer: number;
}

/**
 * Requests, chosen to put every decision on the screen at once.
 *
 * Ordered soonest-to-expire, because that is how the endpoint returns them and
 * a mock that returns them in another order lets a client ship a sort the API
 * does not have.
 *
 * `minutesToAnswer` is a fixed number rather than derived from `expiresAt`.
 * The contract computes it server-side precisely so every client agrees, and a
 * fixture that recomputes it locally would hide a client that re-derives it.
 *
 * **Two of these are never answered by any test, and four are split one pair
 * per Playwright project.** Answering a request mutates state in the Next
 * server process, which both projects share — so a fixture two tests can both
 * touch is a race in the FIXTURE, and softening the assertions to survive it
 * would be the wrong repair. The untouched pair is what the ordering and
 * ceiling assertions read.
 */
export const REQUESTS: MockRequest[] = [
  // Never answered. The urgent one the day's banner and the ordering read.
  {
    id: "req_urgent",
    slotId: "slot_late_morning",
    experience: "Snorkel trip to Elephant Beach",
    guests: 2,
    startsAt: todayAt("23:30"),
    timezone: TZ,
    requestedAt: todayAt("05:10"),
    expiresAt: todayAt("07:10"),
    contactName: "Reuben Mathai",
    seatsGrantable: 6,
    minutesToAnswer: 24,
  },
  {
    id: "req_accept_mobile",
    slotId: "slot_late_morning",
    experience: "Snorkel trip to Elephant Beach",
    guests: 4,
    startsAt: todayAt("23:30"),
    timezone: TZ,
    requestedAt: todayAt("04:00"),
    expiresAt: todayAt("10:00"),
    contactName: "Ingrid Sorensen",
    seatsGrantable: 6,
    minutesToAnswer: 175,
  },
  {
    id: "req_accept_desktop",
    slotId: "slot_late_morning",
    experience: "Snorkel trip to Elephant Beach",
    guests: 3,
    startsAt: todayAt("23:30"),
    timezone: TZ,
    requestedAt: todayAt("04:05"),
    expiresAt: todayAt("10:05"),
    contactName: "Kwame Boateng",
    seatsGrantable: 6,
    minutesToAnswer: 180,
  },
  {
    // Never answered. Cannot be granted: the party is larger than what is
    // left, so the accept button is disabled rather than offered and answered
    // with a 409.
    id: "req_over_ceiling",
    slotId: "slot_dawn",
    experience: "Try-dive at Nemo Reef",
    guests: 5,
    startsAt: todayAt("06:45"),
    timezone: TZ,
    requestedAt: todayAt("03:30"),
    expiresAt: todayAt("18:00"),
    contactName: "Tomas Lindqvist",
    seatsGrantable: 3,
    minutesToAnswer: 420,
  },
  {
    id: "req_decline_mobile",
    slotId: "slot_late_morning",
    experience: "Snorkel trip to Elephant Beach",
    guests: 1,
    startsAt: todayAt("23:30", 1),
    timezone: TZ,
    requestedAt: todayAt("02:00"),
    expiresAt: todayAt("20:00", 1),
    contactName: "Aditi Bose",
    seatsGrantable: 6,
    minutesToAnswer: 1_800,
  },
  {
    id: "req_decline_desktop",
    slotId: "slot_late_morning",
    experience: "Snorkel trip to Elephant Beach",
    guests: 1,
    startsAt: todayAt("23:30", 1),
    timezone: TZ,
    requestedAt: todayAt("02:05"),
    expiresAt: todayAt("20:05", 1),
    contactName: "Yuki Tanabe",
    seatsGrantable: 6,
    minutesToAnswer: 1_805,
  },
];

/**
 * Earnings, and a bank change that holds the payout.
 *
 * The figures reconcile on purpose — gross − commission − refunds = net — so
 * that the screen's own reconciliation check is exercised on a case that
 * passes rather than only on one that fails.
 */
export const EARNINGS = {
  bookings: 12,
  grossPaise: 5_400_000,
  commissionPaise: 810_000,
  refundsPaise: 450_000,
  netPaise: 4_140_000,
  state: "provisional" as const,
};

export const CHANGE_REQUESTS = [
  {
    id: "chg_bank_1",
    kind: "bank",
    // `cooling` is approved and STILL STOPPABLE — the state most worth
    // rendering, because an operator can still act on it.
    state: "cooling",
    summary: "HDFC Bank ••••4417 · HDFC0001234",
    requestedAt: todayAt("09:00", -1),
    objectionUntil: null,
    coolingUntil: todayAt("09:00", 1),
  },
];

/* --------------------------------------------------------------- team ---- */

export interface MockTeamMember {
  id: string;
  name: string;
  roles: string[];
  state: string;
  pending?: boolean;
  lastSeenAt?: string;
  /**
   * Mock-internal, and deliberately NOT part of the response.
   *
   * `TeamMember` never carries the whole number. The API knows it — it is how
   * the invitation was sent and how "a number already belonging to any
   * operator" is refused — and returns only its last four digits as
   * `phoneMasked` (yuvoy-api#62). `publicMember` derives that mask from this
   * field the same way, so the two cannot disagree.
   */
  phone: string;
}

/**
 * A Havelock dive shop, as three people and one invitation nobody has used.
 *
 * The owner is the signed-in user, which puts "This is you" on the first row —
 * the refusal an operator meets most often, and the one the API answers with
 * `409 cannot_remove`.
 */
export const TEAM: MockTeamMember[] = [
  {
    id: OPERATOR.id,
    name: OPERATOR.name,
    roles: ["OWNER"],
    state: "active",
    lastSeenAt: todayAt("05:50"),
    phone: "+919000000101",
  },
  {
    id: "usr_manager_dev",
    name: "Dev Kapoor",
    roles: ["MANAGER"],
    state: "active",
    lastSeenAt: todayAt("18:20", -2),
    phone: "+919000000102",
  },
  {
    id: "usr_staff_arun",
    name: "Arun Biswas",
    roles: ["STAFF"],
    state: "active",
    lastSeenAt: todayAt("07:05", -4),
    phone: "+919000000103",
  },
  {
    // `id` is the INVITATION, not a user. Nothing is granted until it is used.
    id: "inv_ramesh",
    name: "Ramesh Toppo",
    roles: ["STAFF"],
    state: "invited",
    pending: true,
    phone: "+919000000104",
  },
];

/* ------------------------------------------------ other people's accounts - */

/**
 * Two identities that exist only so two screens are reachable at all.
 *
 * Neither is on `TEAM` — they belong to other businesses — and neither appears
 * anywhere in this portal's UI. They exist because the alternative was
 * shipping O3's not-active branch and the error boundary having never once
 * been rendered, which is how this repo ended up with a `requireOperator()`
 * that threw "to the error boundary" when there was no error boundary.
 */
export const OTHER_MEMBERS: MockTeamMember[] = [
  {
    /*
      Signed up through `POST /auth/signup` and verified nothing yet — a real
      session on an account that cannot sell. Before AccountStanding this
      person was told "your account is live".
    */
    id: "usr_prospect",
    name: "New Operator",
    roles: ["OWNER"],
    state: "active",
    phone: "+919000000105",
  },
  {
    /** Everything sent; it is sitting in Yuvoy's queue. */
    id: "usr_awaiting",
    name: "Waiting Operator",
    roles: ["OWNER"],
    state: "active",
    phone: "+919000000106",
  },
  {
    /*
      Signs in fine; the business account is on hold. The contract's own
      distinction: "the person is fine, the business relationship is not."
    */
    id: "usr_suspended",
    name: "Ismail Khan",
    roles: ["OWNER"],
    state: "active",
    phone: "+919000000109",
  },
  {
    /*
      A link that drops mid-upload. The one thing a resumable uploader exists
      for, and the one thing it cannot be shown to do without an interruption
      to recover from.
    */
    id: "usr_upload_drops",
    name: "Drop Test",
    roles: ["OWNER"],
    state: "active",
    phone: "+919000000107",
  },
  {
    /*
      A colleague at the same business is already uploading.

      Since yuvoy-api#66 §3 the upload endpoint RESUMES your own upload rather
      than refusing it, so the only 409 left is somebody else holding the one
      slot — if the quota is per operator rather than per user, which is still
      open on that issue. The portal handles the refusal either way, and it
      would otherwise be a contract branch nothing ever rendered.
    */
    id: "usr_upload_contended",
    name: "Second Skipper",
    roles: ["OWNER"],
    state: "active",
    phone: "+919000000110",
  },
  {
    /*
      The API having a bad minute — a 500 from `GET /me`, which is not an
      account state and must never render as one. Lands on the error boundary,
      where the answer is a retry rather than a sentence about suspension.
    */
    id: "usr_api_failing",
    name: "Test Failure",
    roles: ["OWNER"],
    state: "active",
    phone: "+919000000108",
  },
];

/* ------------------------------------------------------ account standing - */

/**
 * `AccountStanding` on `GET /me` — yuvoy-api#63, PR #83.
 *
 * Four accounts, because the screen has four states and three of them had
 * never been rendered: live, blocked on the operator, blocked on Yuvoy, and
 * an API that does not send the block at all.
 *
 * `state` is a bare string in the contract with no enum, and the API's own
 * example (`PROSPECT`) is not among the schema's examples
 * (`ONBOARDING`/`LIVE`/`PAUSED`). Both appear below on purpose: a client that
 * branched on this value would be wrong on one of them, and the portal
 * branches on `bookable` instead.
 */
export const ACCOUNT_LIVE = {
  state: "LIVE",
  bookable: true,
  blocking: [],
  credentials: [
    {
      type: "directorate_registration",
      state: "verified",
      mandatory: true,
      issuer: "A&N Tourism Directorate",
      // Far enough out to say nothing. The screen must not cry wolf.
      expiresOn: marketDay(400),
      verifiedAt: todayAt("10:00", -120),
    },
    {
      type: "insurance",
      state: "verified",
      mandatory: true,
      issuer: "New India Assurance",
      /*
        Inside the sixty-day window, so the one warning this portal raises
        on its own is exercised on a LIVE account — which is exactly who it
        is for. "A dive licence that lapses mid-season takes the listing
        down, and an operator who was never shown the date finds out from a
        cancelled booking."
      */
      expiresOn: marketDay(21),
      verifiedAt: todayAt("10:00", -60),
    },
  ],
};

/** Signed up, verified nothing. After D-029 self-signup, the common case. */
export const ACCOUNT_PROSPECT = {
  state: "PROSPECT",
  bookable: false,
  blocking: [
    {
      code: "CREDENTIAL_MISSING",
      label: "We still need your tourism department registration",
      waitingOn: "operator",
      since: todayAt("09:00", -3),
    },
    {
      code: "CREDENTIAL_MISSING",
      label: "We still need your insurance certificate",
      waitingOn: "operator",
      since: todayAt("09:00", -3),
    },
  ],
  credentials: [],
};

/**
 * Everything sent, nothing left for them to do.
 *
 * The case Hima called out: "an operator with everything done and no ability
 * to sell gets AWAITING_REVIEW rather than an empty list. 'Nothing
 * outstanding' shown to somebody who is not selling reads as a fault in us."
 */
export const ACCOUNT_AWAITING = {
  state: "ONBOARDING",
  bookable: false,
  blocking: [
    {
      code: "AWAITING_REVIEW",
      label: "Everything is in. A person at Yuvoy is checking it.",
      waitingOn: "yuvoy",
      since: todayAt("11:00", -1),
    },
  ],
  credentials: [
    {
      type: "directorate_registration",
      state: "pending",
      mandatory: true,
      issuer: "A&N Tourism Directorate",
      expiresOn: marketDay(300),
    },
  ],
};

export const SUSPENDED_ID = "usr_suspended";
export const PROSPECT_ID = "usr_prospect";
export const AWAITING_ID = "usr_awaiting";
/** Their uploads drop once, mid-chunk. See `mocks/tus-server.ts`. */
export const DROPPING_ID = "usr_upload_drops";
/** A colleague holds the one upload slot, so they get the 409 that is left. */
export const CONTENDED_ID = "usr_upload_contended";
export const FAILING_ID = "usr_api_failing";
