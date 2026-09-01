/**
 * Fixtures for the operator portal.
 *
 * Times are anchored to "today in Asia/Kolkata" at fixed clock times rather
 * than to fixed dates. O10 is the screen for TODAY: a fixture pinned to
 * 18 August renders an empty day on every other day of the year, and an empty
 * screen is the one thing a manifest fixture must never be.
 */

export const OPERATOR = {
  id: "usr_havelock_owner",
  name: "Nemo Reef Divers",
  roles: ["OWNER"],
  operatorId: "op_nemo_reef",
  canManage: true,
};

const TZ = "Asia/Kolkata";

/** An instant today at a given IST wall-clock time. */
export function todayAt(hhmm: string, dayOffset = 0): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(
    new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000),
  );
  return new Date(`${day}T${hhmm}:00+05:30`).toISOString();
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
    startsAt: todayAt("06:45"),
    timezone: TZ,
    seats: 8,
    sold: 5,
    remaining: 3,
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
    startsAt: todayAt("23:30"),
    timezone: TZ,
    seats: 12,
    sold: 1,
    remaining: 11,
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
