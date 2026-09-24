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
  /**
   * The BUSINESS's address on the traveller app — yuvoy-api#164.
   *
   * Not the operator id and not derivable from it: `op_nemo_reef` is ours and
   * the slug is what a traveller can read. It is what "Preview your operator
   * page" links to, and the reason that button could not be built until the
   * API sent it (yuvoy-operator#41).
   */
  slug: "reef-divers-havelock",
  /**
   * 15%, in basis points — yuvoy-api#180.
   *
   * A real figure rather than a round one would be better still, but 1500 is
   * the rate `EARNINGS` already implies (810,000 of 5,400,000), so the two
   * fixtures describe one business rather than two.
   */
  commissionRateBps: 1500,
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
  /**
   * The medical screener's answer, per party.
   *
   * **Optional here exactly as it is in the contract**, and the option is
   * load-bearing rather than convenience: `screening` is "present only on
   * listings that ask a medical question", so a snorkel trip's parties carry
   * nothing and the screen must say nothing. Making this required would delete
   * the only fixture that can prove the false alarm does not happen.
   *
   * Never carries anything a screen may repeat about a person. `clear` is here
   * because the contract sends it and for no other reason — nothing in `src/`
   * reads it.
   */
  screening?: {
    declared: boolean;
    clear: boolean;
    needsAttention: boolean;
    answeredVersion?: number;
  };
  /**
   * What the listing asks and what this party answered.
   *
   * Optional exactly as in the contract: "present only when there is something
   * to show". A listing with no questions carries none, and the screen must
   * draw nothing rather than an empty heading.
   *
   * These "never ask about health, which stays with `screening`" — the two are
   * deliberately separate, and this one may be read out on a jetty.
   */
  questions?: {
    questionId: string;
    text: string;
    answerType: "short_text" | "choice" | "yes_no";
    required: boolean;
    current: boolean;
    answered: boolean;
    answer?: string;
    answeredAt?: string;
  }[];
  /**
   * Why this booking ended, on a party that arrives already cancelled.
   *
   * Separate from the cancellations a test makes through the portal, which the
   * handler keeps in its own state: this is for the shapes a test cannot
   * produce, chiefly a departure called off and a traveller who cancelled from
   * their own link. Both are lines the screen has to be right about and neither
   * has a button in this portal.
   */
  cancellation?: {
    at: string;
    by?: "traveller" | "operator" | "yuvoy" | "system";
    reasonCode?: string;
    calledOff?: { reasonCode: string };
    operatorCancelled?: { reasonCode: string };
  };
  /**
   * Paid at the counter — yuvoy-operator#40 §1.
   *
   * On the BOOKING, never on the manifest party: `Manifest.parties[]` carries
   * no cash in the contract, and `mocks/handlers.ts` strips this before a
   * manifest goes out. A mock that let it through would let the manifest ship
   * reading a field the real API has never sent.
   */
  cash?: {
    collectPaise: number;
    collected: boolean;
    collectedAt?: string;
    collectedPaise?: number;
  };
  /**
   * Mock-internal, and NOT part of any response: this traveller left no
   * address anything can carry a message on (a WhatsApp number, on a
   * deployment with no WhatsApp sender). A relay counts them in `notReached`
   * rather than `recipients`, which is the case yuvoy-api#200 exists for.
   */
  unreachable?: boolean;
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
  /**
   * Mock-internal: seats set by hand that nobody has confirmed for two days,
   * so the departure is off sale for that alone until
   * `POST /slots/confirm-seats` confirms it (yuvoy-api#211).
   */
  seatsUnconfirmed?: boolean;
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
    /*
      A try-dive, so this departure ASKS the medical question — and every
      answer the screen has to tell apart is on it exactly once:

        Asha    answered, nothing flagged      → the screen says nothing
        Daniel  answered, flagged by the API   → "check with them"
        Priya   asked, has not answered        → "no answer recorded"
        Marco   a hold carrying no screening   → the ambiguous one, also
                                                 "no answer recorded"

      Two of four outstanding, which is what the summary line above the list
      must say. The snorkel departure below carries none of this, and that is
      the fixture that proves a false alarm cannot reach a listing with no
      screener.
    */
    parties: [
      {
        bookingId: "bkg_1",
        reference: "YV-4K2M9P7Q",
        name: "Asha Menon",
        guests: 2,
        state: "confirmed",
        arrived: false,
        screening: { declared: true, clear: true, needsAttention: false },
        /*
          Answered, and one of them to a question the listing NO LONGER asks.
          `current: false` only ever appears on an answered question, and it is
          kept "so an answer to a reworded question stays readable with the
          words it answered" — the one case where a screen must show a question
          that is not on the listing in front of it.
        */
        questions: [
          {
            questionId: "q_shoe",
            text: "What shoe size are you?",
            answerType: "short_text",
            required: true,
            current: true,
            answered: true,
            answer: "44",
            answeredAt: todayAt("19:10", -3),
          },
          {
            questionId: "q_swim_old",
            text: "Can you swim 200m unaided?",
            answerType: "yes_no",
            required: false,
            current: false,
            answered: true,
            answer: "yes",
            answeredAt: todayAt("19:11", -3),
          },
        ],
      },
      {
        bookingId: "bkg_2",
        reference: "YV-7T1N4X8B",
        name: "Daniel Okafor",
        guests: 1,
        state: "confirmed",
        arrived: true,
        arrivedAt: todayAt("06:31"),
        /*
          Flagged by the server. `clear: true` beside it is deliberate: the
          flag is NOT derivable from what he answered, so a client that tries
          to compute one gets this row wrong.
        */
        screening: {
          declared: true,
          clear: true,
          needsAttention: true,
          answeredVersion: 3,
        },
      },
      {
        bookingId: "bkg_3",
        reference: "YV-9Q5R2W6C",
        name: "Priya Raghavan",
        guests: 2,
        state: "confirmed",
        /*
          Left only a WhatsApp number, so nothing can carry a relay to her
          today. A departure-wide update therefore reaches two of three, and
          the receipt has to say so (op#89).
        */
        unreachable: true,
        arrived: false,
        screening: { declared: false, clear: false, needsAttention: false },
        /*
          Asked and NOT answered, which is the case the copy exists for: a
          question with nothing under it reads as an answer somebody gave. It is
          also what a booking looks like 90 days after the trip, when the answer
          is deleted and the question reads `answered: false` again.
        */
        questions: [
          {
            questionId: "q_shoe",
            text: "What shoe size are you?",
            answerType: "short_text",
            required: true,
            current: true,
            answered: false,
          },
        ],
      },
      // A live hold: mid-checkout, no bookingId, may still walk up — and no
      // screening object at all, on a departure where everybody else has one.
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
    sold: 3,
    remaining: 7,
    status: "open",
    meetingPoint: "Havelock jetty, gate 1",
    seatsSoldOffline: 0,
    parties: [
      {
        /*
          Paid at the counter, and the cash is in the till. Calling this
          departure off refunds nothing on it, because nothing reached us, so
          the call-off answers with it in `cashToGiveBack` (op#95).
        */
        bookingId: "bkg_ca_cash",
        reference: "YV-CA5HA7K2",
        name: "Nadia Khan",
        guests: 1,
        state: "confirmed",
        arrived: false,
        cash: {
          collectPaise: 450_000,
          collected: true,
          collectedAt: todayAt("08:15"),
          collectedPaise: 450_000,
        },
      },
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
    sold: 4,
    remaining: 6,
    status: "open",
    meetingPoint: "Havelock jetty, gate 1",
    seatsSoldOffline: 0,
    parties: [
      {
        /*
          Paid at the counter, and the cash is in the till. Calling this
          departure off refunds nothing on it, because nothing reached us, so
          the call-off answers with it in `cashToGiveBack` (op#95).
        */
        bookingId: "bkg_cb_cash",
        reference: "YV-CB5HB8M3",
        name: "Joel Mathew",
        guests: 1,
        state: "confirmed",
        arrived: false,
        cash: {
          collectPaise: 450_000,
          collected: true,
          collectedAt: todayAt("08:15"),
          collectedPaise: 450_000,
        },
      },
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
  /*
    CASH AT THE COUNTER — yuvoy-operator#40 §1.

    Its own departure, tomorrow, so none of the counts the day, the manifest's
    screener summary or the relay assert on moves. Every state the collection
    has to tell apart is on it:

      Kavya / Tom     owe the whole fare     one per project, recorded in full
      Lena / Omar     owe the whole fare     one per project, recorded SHORT
      Anil            owes the whole fare    never touched — the read side
      Meera           already taken, 08:10   the row that must offer nothing
      Sofia           paid online            the row that must say nothing

    Recording mutates state in the Next server both Playwright projects share,
    which is why the two walkthroughs take a party each — a fixture two tests
    can both collect from is a race in the FIXTURE.

    ₹4,500 a seat, as `bookingMoney` prices every other party.
  */
  {
    id: "slot_cash",
    experienceId: "exp_dive",
    title: "Reef dive",
    startsAt: todayAt("10:00", 1),
    timezone: TZ,
    seats: 16,
    sold: 15,
    remaining: 1,
    bookingMode: "allotment",
    status: "open",
    meetingPoint: "Beach 3 dive hut",
    seatsSoldOffline: 0,
    parties: [
      {
        bookingId: "bkg_cash_a",
        reference: "YV-C4SH1A2B",
        name: "Kavya Iyer",
        guests: 2,
        state: "paid_pending_ops",
        arrived: false,
        cash: { collectPaise: 900_000, collected: false },
      },
      {
        bookingId: "bkg_cash_b",
        reference: "YV-C4SH3C4D",
        name: "Tom Becker",
        guests: 2,
        state: "paid_pending_ops",
        arrived: false,
        cash: { collectPaise: 900_000, collected: false },
      },
      {
        bookingId: "bkg_short_a",
        reference: "YV-SH0RT5E6",
        name: "Lena Park",
        guests: 3,
        state: "paid_pending_ops",
        arrived: false,
        cash: { collectPaise: 1_350_000, collected: false },
      },
      {
        bookingId: "bkg_short_b",
        reference: "YV-SH0RT7F8",
        name: "Omar Haddad",
        guests: 3,
        state: "paid_pending_ops",
        arrived: false,
        cash: { collectPaise: 1_350_000, collected: false },
      },
      {
        bookingId: "bkg_cash_owed",
        reference: "YV-0WED9K3L",
        name: "Anil Kumar",
        guests: 2,
        state: "paid_pending_ops",
        arrived: false,
        cash: { collectPaise: 900_000, collected: false },
      },
      {
        bookingId: "bkg_cash_taken",
        reference: "YV-TAKEN4M5",
        name: "Meera Das",
        guests: 2,
        state: "confirmed",
        arrived: false,
        cash: {
          collectPaise: 900_000,
          collected: true,
          collectedAt: todayAt("08:10"),
          collectedPaise: 900_000,
        },
      },
      {
        bookingId: "bkg_card",
        reference: "YV-CARD6N7P",
        name: "Sofia Alves",
        guests: 1,
        state: "confirmed",
        arrived: false,
      },
      /*
        Two bookings that exist only to be CANCELLED, one per Playwright
        project — yuvoy-operator#43 item 4.

        Cancelling is one-way, so a booking two projects both cancel is a race
        in the fixture, and the second project reports a product failure that is
        not there. The first attempt at this reused the two cash parties above,
        which `cash.spec.ts` claims by name for its collection walkthroughs; a
        cancelled booking has no Cash taken button, so that suite went red.

        Cash rather than card, because the confirmation's money sentence is the
        opposite one and it is the one that can promise a traveller a refund
        that was never taken: "nothing is refunded online."
      */
      {
        bookingId: "bkg_cancel_a",
        reference: "YV-CANCEL1A",
        name: "Ritu Bhalla",
        guests: 2,
        state: "paid_pending_ops",
        arrived: false,
        cash: { collectPaise: 900_000, collected: false },
      },
      {
        bookingId: "bkg_cancel_b",
        reference: "YV-CANCEL2B",
        name: "Jonas Weber",
        guests: 2,
        state: "paid_pending_ops",
        arrived: false,
        cash: { collectPaise: 900_000, collected: false },
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
    parties: [
      {
        /*
          A CARD booking the call-off took with it — yuvoy-operator#43 item 1.

          The line an operator reads most often after something goes wrong, and
          nothing in the portal can produce it: a call-off cancels every booking
          on the departure, so this shape only exists as a fixture. The money is
          the other half of the acceptance: commission is 0 on a cancelled
          booking and the net is gross less refunds, which is what a payout will
          pay on it.
        */
        bookingId: "bkg_calledoff_card",
        reference: "YV-CALL0FF1",
        name: "Ishaan Roy",
        guests: 2,
        state: "cancelled",
        arrived: false,
        cancellation: {
          at: todayAt("07:40"),
          by: "operator",
          reasonCode: "OPERATOR_CALLED_OFF",
          calledOff: { reasonCode: "weather" },
        },
      },
      {
        /*
          Cancelled, and its CASH is still in the till. The one path where we
          refunded nothing because nothing reached us, so the money the business
          is holding belongs to somebody else until they record handing it back
          (item 5). Nothing else in these fixtures reaches that state.
        */
        bookingId: "bkg_calledoff_cash",
        reference: "YV-CALL0FF2",
        name: "Farah Sheikh",
        guests: 1,
        state: "cancelled",
        arrived: false,
        cash: {
          collectPaise: 450_000,
          collected: true,
          collectedAt: todayAt("07:05"),
          collectedPaise: 450_000,
        },
        cancellation: {
          at: todayAt("07:40"),
          by: "operator",
          reasonCode: "OPERATOR_CALLED_OFF",
          calledOff: { reasonCode: "weather" },
        },
      },
      {
        /*
          The traveller cancelled it themselves, from their own booking link.
          The most common cancellation there is, and the one an operator will
          otherwise assume WE did.
        */
        bookingId: "bkg_traveller_left",
        reference: "YV-LEFT2R4T",
        name: "Bruno Costa",
        guests: 1,
        state: "cancelled",
        arrived: false,
        cancellation: {
          at: todayAt("18:20", -1),
          by: "traveller",
          reasonCode: "CUSTOMER_REQUEST",
        },
      },
    ],
  },
  /*
    Two days of their own, twelve and thirteen out, for closing a day —
    yuvoy-operator#45.

    A closure is read back now: the day turns Closed and its departures go off
    sale. A test closing TODAY would take the day screen's departures off sale
    under every other test, so each closing test has a day nothing else looks
    at, carrying one confirmed party — which makes "you still owe 1 booking"
    and "3 guests are already confirmed" true of exactly one day each.
  */
  {
    id: "slot_closing_a",
    experienceId: "exp_snorkel",
    title: "Lagoon kayak (closing fixture A)",
    startsAt: todayAt("08:00", 12),
    timezone: TZ,
    seats: 6,
    sold: 2,
    remaining: 4,
    status: "open",
    meetingPoint: "Havelock jetty, gate 2",
    seatsSoldOffline: 0,
    parties: [
      {
        bookingId: "bkg_closing_a",
        reference: "YV-7K3M8Q2A",
        name: "Noor Hassan",
        guests: 2,
        state: "confirmed",
        arrived: false,
      },
    ],
  },
  /*
    Two more days of their own, seven and eight out, for STOPPING ONE
    DEPARTURE and putting it back — yuvoy-operator#45 items 2 and 4.

    Separate from the closing fixtures above for the same reason those are
    separate from each other: closing is read back now, so a departure two
    projects both close is a race in the fixture. Each carries one confirmed
    booking, so the receipt's "the bookings already on it still stand" is
    exercised rather than the empty case.

    TWO departures on each day, deliberately. Stopping one has to leave the
    other selling — "this departure stops selling and the rest of its day does
    not" — and a day with one departure cannot tell that apart from closing the
    whole day.
  */
  {
    id: "slot_stop_a1",
    experienceId: "exp_snorkel",
    title: "Lagoon kayak (stop fixture A)",
    startsAt: todayAt("08:00", 7),
    timezone: TZ,
    seats: 6,
    sold: 2,
    remaining: 4,
    status: "open",
    meetingPoint: "Havelock jetty, gate 2",
    seatsSoldOffline: 0,
    parties: [
      {
        bookingId: "bkg_stop_a",
        reference: "YV-ST0P1A2B",
        name: "Leela Nair",
        guests: 2,
        state: "confirmed",
        arrived: false,
      },
    ],
  },
  {
    id: "slot_stop_a2",
    experienceId: "exp_snorkel",
    title: "Sunset paddle (stop fixture A)",
    startsAt: todayAt("16:30", 7),
    timezone: TZ,
    seats: 6,
    sold: 0,
    remaining: 6,
    status: "open",
    meetingPoint: "Havelock jetty, gate 2",
    seatsSoldOffline: 0,
    parties: [],
  },
  {
    id: "slot_stop_b1",
    experienceId: "exp_snorkel",
    title: "Lagoon kayak (stop fixture B)",
    startsAt: todayAt("08:00", 8),
    timezone: TZ,
    seats: 6,
    sold: 2,
    remaining: 4,
    status: "open",
    meetingPoint: "Havelock jetty, gate 2",
    seatsSoldOffline: 0,
    parties: [
      {
        bookingId: "bkg_stop_b",
        reference: "YV-ST0P3C4D",
        name: "Arjun Pillai",
        guests: 2,
        state: "confirmed",
        arrived: false,
      },
    ],
  },
  {
    id: "slot_stop_b2",
    experienceId: "exp_snorkel",
    title: "Sunset paddle (stop fixture B)",
    startsAt: todayAt("16:30", 8),
    timezone: TZ,
    seats: 6,
    sold: 0,
    remaining: 6,
    status: "open",
    meetingPoint: "Havelock jetty, gate 2",
    seatsSoldOffline: 0,
    parties: [],
  },
  {
    id: "slot_closing_b",
    experienceId: "exp_snorkel",
    title: "Lagoon kayak (closing fixture B)",
    startsAt: todayAt("08:00", 13),
    timezone: TZ,
    seats: 6,
    sold: 3,
    remaining: 3,
    status: "open",
    meetingPoint: "Havelock jetty, gate 2",
    seatsSoldOffline: 0,
    parties: [
      {
        bookingId: "bkg_closing_b",
        reference: "YV-9P4R6T1B",
        name: "Jonas Weber",
        guests: 3,
        state: "confirmed",
        arrived: false,
      },
    ],
  },
  /*
    OFF SALE BECAUSE NOBODY CONFIRMED ITS SEATS (yuvoy-operator#94).

    On "Blue lagoon", a live listing with no other departures, ten days out:
    the calendar's own tests keep +3, +5 and +6 empty and build on +9 and
    +11, and +10 is nobody's. Confirming it is one-way in this mock, so the
    walkthrough that confirms it runs on one project only.
  */
  {
    id: "slot_unconfirmed",
    experienceId: "exp_nofootage",
    title: "Blue lagoon (no footage fixture)",
    startsAt: todayAt("10:00", 10),
    timezone: TZ,
    seats: 6,
    sold: 0,
    remaining: 6,
    bookingMode: "allotment",
    status: "open",
    meetingPoint: "Havelock jetty, gate 1",
    seatsSoldOffline: 0,
    parties: [],
    seatsUnconfirmed: true,
  },
  /*
    CASH TO TAKE TODAY (yuvoy-operator#96, Home's "Needs you").

    Every other cash party is on tomorrow's `slot_cash` or on a call-off
    fixture whose cash is already taken, so nothing put a "collect" row on
    Home. One party, never recorded by any test, so the row reads the same
    on both projects: "Collect ₹4,500 from 1 party on the 20:30". Late in the
    day and on the dive listing, so no count another suite reads moves.
  */
  {
    id: "slot_cash_today",
    experienceId: "exp_dive",
    title: "Reef dive (cash today fixture)",
    startsAt: todayAt("20:30"),
    timezone: TZ,
    seats: 8,
    sold: 1,
    remaining: 7,
    bookingMode: "allotment",
    status: "open",
    meetingPoint: "Beach 3 dive hut",
    seatsSoldOffline: 0,
    parties: [
      {
        bookingId: "bkg_cash_today",
        reference: "YV-T0DAY4K5",
        name: "Hana Ito",
        guests: 1,
        state: "paid_pending_ops",
        arrived: false,
        cash: { collectPaise: 450_000, collected: false },
      },
    ],
  },
  /*
    OFF SALE FOR UNCONFIRMED SEATS, for Home's "Confirm all"
    (yuvoy-operator#96). Home confirms every listing at once, so it cannot
    share `slot_unconfirmed` with the listing hub's own walkthrough: the two
    run in order in one serial block, the hub's first, and this is what is
    still off sale when Home's turn comes. On "Sunset cruise", whose hub no
    suite reads, on the same day as the other, which is nobody else's.
  */
  {
    id: "slot_unconfirmed_home",
    experienceId: "exp_sunset",
    title: "Sunset cruise (seats fixture)",
    startsAt: todayAt("11:00", 10),
    timezone: TZ,
    seats: 6,
    sold: 0,
    remaining: 6,
    bookingMode: "allotment",
    status: "open",
    meetingPoint: "Havelock jetty, gate 1",
    seatsSoldOffline: 0,
    parties: [],
    seatsUnconfirmed: true,
  },
];

export const DEV_CODE = "424242";

export interface MockRequest {
  id: string;
  slotId: string;
  /**
   * The listing, "always present. The same id the listings endpoints use, so a
   * listing filter applies to requests as it does to bookings."
   *
   * Added for yuvoy-operator#57 item 5, which filters the Requests pill in the
   * portal because `GET /requests` takes no search. Matched on the id and never
   * on `experience`: two listings may be called the same thing, and a title is
   * a label somebody can edit.
   */
  experienceId: string;
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
    experienceId: "exp_snorkel",
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
    experienceId: "exp_snorkel",
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
    experienceId: "exp_snorkel",
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
    experienceId: "exp_try_dive",
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
    experienceId: "exp_snorkel",
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
    experienceId: "exp_snorkel",
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
  /*
    Answered from HOME, one per Playwright project (yuvoy-operator#96).

    Home draws the three soonest requests, so these sit inside that three
    whatever else has been answered: after the one that is never answered,
    before every other. Nothing else answers them.
  */
  {
    id: "req_home_mobile",
    slotId: "slot_late_morning",
    experienceId: "exp_snorkel",
    experience: "Snorkel trip to Elephant Beach",
    guests: 2,
    startsAt: todayAt("23:30"),
    timezone: TZ,
    requestedAt: todayAt("04:30"),
    expiresAt: todayAt("09:00"),
    contactName: "Meenakshi Rao",
    seatsGrantable: 6,
    minutesToAnswer: 90,
  },
  {
    id: "req_home_desktop",
    slotId: "slot_late_morning",
    experienceId: "exp_snorkel",
    experience: "Snorkel trip to Elephant Beach",
    guests: 2,
    startsAt: todayAt("23:30"),
    timezone: TZ,
    requestedAt: todayAt("04:35"),
    expiresAt: todayAt("09:05"),
    contactName: "Tobias Klein",
    seatsGrantable: 6,
    minutesToAnswer: 95,
  },
];

/**
 * Past payout weeks, one of each state (yuvoy-operator#47).
 *
 * `EARNINGS` and its month-shaped figures are gone with `GET /earnings`: a
 * calendar month was never the unit money moves in.
 *
 * The three states are here because they are three different promises to an
 * operator, and only one of them means money has actually moved. The oldest
 * week is NEGATIVE: a correction larger than what the week pays, which the
 * contract says leaves that week unpaid "until somebody at Yuvoy decides how to
 * recover it". A fixture with no negative week would let a screen render an
 * absolute value and pass.
 */
export const SETTLEMENT_SENT = {
  id: "stl_sent",
  periodStart: "2026-08-31",
  periodEnd: "2026-09-06",
  state: "settled" as const,
  bookings: 5,
  /*
    Deliberately NOT the same net as `nextSettlement` in the overview. The first
    version of this fixture paid an identical ₹40,150, which made an e2e
    assertion on that figure ambiguous and, worse, described a world where two
    different weeks paid the same amount to the paise. A fixture should not be
    a coincidence.
  */
  grossPaise: 5_400_000,
  commissionPaise: 540_000,
  refundsPaise: 900_000,
  adjustmentsPaise: -125_000,
  netPaise: 3_835_000,
  lockedAt: "2026-09-07T04:00:00Z",
  settledAt: "2026-09-08T06:30:00Z",
  reference: "UTR2026090812345",
};

export const SETTLEMENT_APPROVED = {
  id: "stl_approved",
  periodStart: "2026-08-24",
  periodEnd: "2026-08-30",
  state: "approved" as const,
  bookings: 4,
  grossPaise: 3_600_000,
  commissionPaise: 540_000,
  refundsPaise: 0,
  adjustmentsPaise: 0,
  netPaise: 3_060_000,
  lockedAt: "2026-08-31T04:00:00Z",
};

export const SETTLEMENT_OWED_BACK = {
  id: "stl_owed_back",
  periodStart: "2026-08-17",
  periodEnd: "2026-08-23",
  state: "locked" as const,
  bookings: 1,
  grossPaise: 450_000,
  commissionPaise: 67_500,
  refundsPaise: 0,
  adjustmentsPaise: -600_000,
  netPaise: -217_500,
  lockedAt: "2026-08-24T04:00:00Z",
};

/**
 * The statement, as the API sends it.
 *
 * A TOTAL row whose net INCLUDES the adjustment, which has no column: that is
 * the contract's own description and the reason the rows do not add up to the
 * total. The second row is a cancelled booking the operator kept money on, so
 * its commission is 0.00, because we take none on a booking that did not
 * happen.
 */
export const STATEMENT_CSV = `reference,trip_date,guests,gross,commission,refunded,net
YV-7KJ2MQ,2026-09-02,2,36000.00,5400.00,0.00,30600.00
YV-9PL4XR,2026-09-04,1,18000.00,0.00,9000.00,9000.00
TOTAL,,3,54000.00,5400.00,9000.00,38350.00
`;

/**
 * What is owed on cash already taken — yuvoy-operator#40 §2.
 *
 * Three completed cash trips. The totals are the sum of the lines on purpose:
 * the screen refuses to reconcile when they are not, and a fixture that never
 * added up would leave that check firing on every load instead of never.
 *
 * The last line took LESS than the fare. Our share is owed on the fare —
 * "a discount you gave is yours to have given" — so that row's share is not
 * 15% of what was collected, which is exactly the line an operator would ring
 * us about if the screen did not explain it.
 */
export const COMMISSION_OWED = {
  bookings: 3,
  farePaise: 3_000_000,
  // What was recorded taken on the three: the fares, less the shortfall below.
  collectedPaise: 2_700_000,
  commissionPaise: 450_000,
  lines: [
    {
      bookingReference: "YV-8F3K2A",
      tripDate: marketDay(-2),
      guests: 2,
      farePaise: 1_000_000,
      collectedPaise: 1_000_000,
      commissionPaise: 150_000,
    },
    {
      bookingReference: "YV-2M9QX1",
      tripDate: marketDay(-4),
      guests: 1,
      farePaise: 500_000,
      collectedPaise: 500_000,
      commissionPaise: 75_000,
    },
    {
      bookingReference: "YV-7T4WPZ",
      tripDate: marketDay(-6),
      guests: 3,
      farePaise: 1_500_000,
      // Took ₹3,000 less than the fare. The share below is still on the fare.
      collectedPaise: 1_200_000,
      commissionPaise: 225_000,
    },
  ],
  /*
    HELD for trips still to run (yuvoy-api#211, op#94): the cash the screen
    left out, which is how an operator holding ₹42,000 read ₹30,000. Two
    trips, and their shares add up to the held share, as the owed ones do.
  */
  heldBookings: 2,
  heldFarePaise: 1_500_000,
  heldCollectedPaise: 1_500_000,
  heldCommissionPaise: 225_000,
  heldLines: [
    {
      bookingReference: "YV-H3LD0B2",
      tripDate: marketDay(5),
      guests: 1,
      farePaise: 600_000,
      collectedPaise: 600_000,
      commissionPaise: 90_000,
    },
    {
      bookingReference: "YV-H3LD0A1",
      tripDate: marketDay(2),
      guests: 2,
      farePaise: 900_000,
      collectedPaise: 900_000,
      commissionPaise: 135_000,
    },
  ],
  /*
    A trip that RAN with no cash recorded (yuvoy-api#221): nothing says
    whether the business was paid, so it is in no held or owed figure, and
    only the operator can close it.
  */
  unrecordedBookings: 1,
  unrecordedFarePaise: 450_000,
  unrecordedLines: [
    {
      bookingReference: "YV-UNR3C0D",
      tripDate: marketDay(-1),
      guests: 1,
      farePaise: 450_000,
      collectedPaise: 0,
      commissionPaise: 67_500,
    },
  ],
};

export const CHANGE_REQUESTS = [
  {
    id: "chg_bank_1",
    // The API's word, `bank_account`. This said `bank`, and every screen that
    // looked for `bank` passed against it while matching nothing in production.
    kind: "bank_account",
    // `cooling` is approved and STILL STOPPABLE — the state most worth
    // rendering, because an operator can still act on it.
    state: "cooling",
    summary: "HDFC Bank ••••4417 · HDFC0001234",
    requestedAt: todayAt("09:00", -1),
    objectionUntil: null,
    coolingUntil: todayAt("09:00", 1),
  },
  {
    id: "chg_bank_0",
    kind: "bank_account",
    /*
      What is ON FILE: the newest bank change that went live, which Payout
      details shows as text with one Change button (yuvoy-operator#87 s14).
      Written in the API's own summary shape, `Bank ····last4 (IFSC)`
      (yuvoy-api `BankChange.Summary`), so the screen's reading of it is
      exercised against what production sends rather than against this
      mock's own shape above.
    */
    state: "applied",
    summary: "HDFC Bank ····4412 (HDFC0001234)",
    requestedAt: todayAt("09:00", -40),
    objectionUntil: null,
    coolingUntil: todayAt("09:00", -38),
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
  /**
   * Mock-internal too: the email address an invitation was made with.
   *
   * Only an INVITATION carries one, and only so the join page can be told the
   * truth. With no WhatsApp sender an email address is the one thing that can
   * carry a join code, so `POST /join/{token}/code` answers `sent: false` for
   * an invitation made without one (yuvoy-api#227). Never in a response.
   */
  inviteEmail?: string;
}

/**
 * A Havelock dive shop, as three people and one invitation nobody has used.
 *
 * The owner is the signed-in user, which puts "This is you" on the first row —
 * the refusal an operator meets most often, and the one the API answers with
 * `409 cannot_remove`.
 */
/**
 * One join link per business — the same URL for everybody they add.
 *
 * It "grants nothing on its own: the number must already have been invited",
 * which is what makes it safe on a screen and in a forwarded message.
 */
export const JOIN_TOKEN = "jn_reefdivers";

/**
 * The BUSINESS's name, which is not `OPERATOR.name` — that is the person.
 *
 * The join flow is the first screen in this portal that has to name the
 * business to somebody who does not work there yet, and reaching for
 * `OPERATOR.name` renders "Join Priya Raut", which is an invitation from a
 * stranger rather than from a dive shop. Caught by an e2e; the distinction is
 * worth a constant so the next screen does not make the same reach.
 */
export const BUSINESS_NAME = "Reef Divers Havelock";
export const JOIN_URL = `https://operators.yuvoy.in/join/${JOIN_TOKEN}`;

/**
 * A pending invitation whose number already works with another business.
 *
 * Exists so the destructive path is reachable: accepting ends that membership
 * and drops its sessions, so the screen must ask first. Without a fixture for
 * it, neither the warning panel nor the `409 confirmation_required` branch
 * would ever render in a test.
 */
export const LEAVING_PHONE = "+919000000112";

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
    /*
      An active ADMIN — the stand-in for an owner who is off the island.

      Added when the backend started accepting the role (yuvoy-operator#23).
      Without one, the split that matters could not be tested at all.

      What that split IS changed on 6 September (yuvoy-api#109): an admin may
      now remove people, change roles, hold and restore — `DELETE /team/{id}`
      widened from OWNER-only — and `canManage` gained ADMIN, so an admin can
      also set seats and read earnings. What is left to them alone: they may
      not act on an OWNER or on another ADMIN, and they may not raise a bank
      change. This row is what exercises both halves.
    */
    id: "usr_admin_nisha",
    name: "Nisha Fernandes",
    roles: ["ADMIN"],
    state: "active",
    lastSeenAt: todayAt("07:20"),
    phone: "+919000000114",
  },
  {
    /*
      A SECOND active admin, and the only thing it exists for is the rule that
      changed on 14 September: an admin may now act on another admin.

      Every one of the four access endpoints used to refuse it, and both the
      portal and this mock agreed. Each endpoint now names one exception only —
      "an ADMIN cannot change an OWNER" — so admin-on-admin is a positive case,
      and without a second admin row there is nothing to assert it against. The
      old test passed by pointing an admin at their OWN row, which answers `409`
      and is in the same list of acceptable refusals, so it proved nothing.

      Read but never written: Nisha is the one tests act as, and this is the one
      they act on. Nothing demotes, holds or removes it.
    */
    id: "usr_admin_ravi",
    name: "Ravi Menon",
    roles: ["ADMIN"],
    state: "active",
    lastSeenAt: todayAt("06:40", -1),
    phone: "+919000000116",
  },
  /*
    Two managers that exist only to have their access changed, one per
    Playwright project.

    Changing a role, holding and restoring all mutate state in the shared Next
    server process, and the walkthrough leaves somebody demoted — so a member
    two projects can both edit is a race in the FIXTURE, and it would take the
    Earnings link away from whichever `roles.spec.ts` ran second. Exactly the
    call `slot_calloff_a` and `slot_calloff_b` make on the day screen.

    `usr_manager_dev` is deliberately NOT used for it: three other specs assert
    what a manager is offered, and they rely on that row still being a manager.
  */
  {
    id: "usr_access_a",
    name: "Access Fixture A",
    roles: ["MANAGER"],
    state: "active",
    lastSeenAt: todayAt("09:10", -1),
    phone: "+919000000121",
  },
  {
    id: "usr_access_b",
    name: "Access Fixture B",
    roles: ["MANAGER"],
    state: "active",
    lastSeenAt: todayAt("09:15", -1),
    phone: "+919000000122",
  },
  {
    // `id` is the INVITATION, not a user. Nothing is granted until it is used.
    id: "inv_ramesh",
    name: "Ramesh Toppo",
    roles: ["STAFF"],
    state: "invited",
    pending: true,
    phone: "+919000000104",
    inviteEmail: "ramesh@example.com",
  },
  {
    /*
      Invited as ADMIN, and their number already works with another business.

      Two things nothing else in these fixtures covers: the role the portal
      could not even offer until yuvoy-operator#23, and the accept that ends an
      existing membership — which the screen has to ask about before it sends
      `confirmLeaving`, and which the API refuses with a 409 until it does.
    */
    id: "inv_joinlink",
    name: "Sunil Ekka",
    roles: ["STAFF"],
    state: "invited",
    pending: true,
    /*
      Reserved for the join-by-link e2e, which ACCEPTS it — flipping it from
      pending to active. Ramesh's invitation was used at first and another test
      asserts on it being unused, so the two quietly fought. A consuming test
      needs a fixture nobody else reads.
    */
    phone: "+919000000113",
    inviteEmail: "sunil@example.com",
  },
  {
    id: "inv_lakshmi",
    name: "Lakshmi Rao",
    roles: ["ADMIN"],
    state: "invited",
    pending: true,
    phone: LEAVING_PHONE,
    inviteEmail: "lakshmi@example.com",
  },
  {
    /*
      An invitation to be the business's OWNER — impossible until D15.
      `POST /team` now says "**Everybody joins as `STAFF`, except an owner**",
      and an owner invitation is how a business whose first person runs it gets
      one at all (yuvoy-operator#51 items 2 and 5).
      
      Never accepted by any test. Asking for the code is enough to see what
      accepting would make somebody — the join screen names it before they
      accept — and that read leaves the invitation where it is, so both
      Playwright projects can make it. Accepting would consume it and the second
      project would find nothing.
    */
    id: "inv_owner_seema",
    name: "Seema Lall",
    roles: ["OWNER"],
    state: "invited",
    pending: true,
    phone: "+919000000117",
    inviteEmail: "seema@example.com",
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
      LIVE and selling, with the logo and registered address outstanding —
      yuvoy-operator#38. The state that could not exist before yuvoy-api#139
      and is now the common one, and the state whose outstanding list this
      portal hid the moment it became possible.
    */
    id: "usr_live_outstanding",
    name: "Live Outstanding",
    roles: ["OWNER"],
    state: "active",
    /*
      115 because 101-114 are all spoken for. `sessionUser` resolves an
      identity by PHONE with `.find()`, so a duplicate silently hands one
      fixture identity's session to another — which is what a first draft of
      this row did to Second Skipper, and it failed the upload-contention test
      two files away rather than anything on this screen.
    */
    phone: "+919000000115",
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
      The listings read fails while the departures read works.

      `/calendar` asks two endpoints: `GET /slots` for the fortnight it edits,
      and `GET /experiences` for the departure picker. This identity refuses
      the second, which is the failure that would otherwise take a working
      seat-editing screen down to an error page over a form nobody had opened.

      Before yuvoy-operator#32 the listings came off a ±120-day `GET /slots`
      read and this identity refused THAT. The endpoint changed; what is being
      modelled did not.
    */
    id: "usr_wide_read_fails",
    name: "Wide Read",
    roles: ["OWNER"],
    state: "active",
    phone: "+919000000111",
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
  {
    /*
      A business with nothing yet: no listing, no departure, no booking, no
      reel, and two documents to send (yuvoy-operator#96, "New operator,
      nothing live"). Every other identity reads the fixture dive shop's
      listings and departures, so without this one Home's start-selling
      checklist could never be rendered.
    */
    id: "usr_new_business",
    name: "Kiran Das",
    roles: ["OWNER"],
    state: "active",
    phone: "+919000000118",
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
  /*
    NOTHING outstanding, and this stays that way.

    An unmet required document was put here at first, with the
    `CREDENTIAL_MISSING` that explains it — and it broke two suites that read
    this identity as "a live account with nothing waiting on you", which is what
    it is for. The unmet case lives on `ACCOUNT_LIVE_OUTSTANDING`, which already
    has blockers and its own identity.
  */
  blocking: [],
  credentials: [
    {
      /*
        VERIFIED with NO FILE: production's own case in yuvoy-operator#93, "1 of
        1 required documents are verified", then "Directorate registration,
        Verified, Valid until 31 January 2027, No file sent". The row must not
        read as simply verified, and it offers no upload: the operator's upload
        answers `409 document_locked` for a verified document, and only our
        staff attach one (D56).
      */
      id: "cred_directorate_verified",
      type: "directorate_registration",
      state: "verified",
      mandatory: true,
      issuer: "A&N Tourism Directorate",
      hasFile: false,
      // Far enough out to say nothing. The screen must not cry wolf.
      expiresOn: marketDay(400),
      verifiedAt: todayAt("10:00", -120),
    },
    {
      /*
        Verified WITH a file, so the one row above is the only one that says
        we hold none. `id` and `hasFile` are required on every row, and a
        fixture without them is a response the API cannot send.
      */
      id: "cred_insurance_verified",
      type: "insurance",
      state: "verified",
      mandatory: true,
      hasFile: true,
      filename: "public-liability-2026.pdf",
      sizeBytes: 350_000,
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
    {
      /*
        PENDING, with an id and no file — the one state that takes one
        (yuvoy-operator#46 items 2 and 3).

        "Only a pending document takes a file. Once somebody at Yuvoy has
        verified or rejected a document, a new file behind it would change the
        evidence under a decision nobody re-made." The two above are verified
        and must therefore offer nothing, which is half of what makes this
        fixture worth having.
      */
      id: "cred_oxygen_pending",
      type: "oxygen",
      state: "pending",
      mandatory: true,
      issuer: "Andaman Divers Supply",
      hasFile: false,
      filedAt: todayAt("11:00", -2),
    },
    {
      /*
        A SECOND pending document, and the only one a test uploads to.

        `cred_oxygen_pending` above is read by both Playwright projects, which
        assert it has no file and offers the control; a successful upload is not
        reversible and the mock's state is shared, so the project that uploaded
        first would take both assertions away from the other. This row is the
        one that receives a file, and nothing asserts it is empty.
      */
      id: "cred_gst_pending",
      type: "gst",
      state: "pending",
      mandatory: false,
      issuer: "GST Network",
      hasFile: false,
      filedAt: todayAt("11:00", -2),
    },
    {
      /*
        VERIFIED and carrying a file, so the row that names one is exercised and
        the row that offers to send one is proved absent on the same screen.
      */
      id: "cred_boat_verified",
      type: "boat",
      state: "verified",
      mandatory: true,
      issuer: "Port Blair Harbour Master",
      hasFile: true,
      filename: "boat-survey-2026.pdf",
      sizeBytes: 480_000,
      expiresOn: marketDay(300),
      verifiedAt: todayAt("10:00", -30),
    },
  ],
  /*
    Four required, four met — yuvoy-operator#46 item 1.

    `bank` is in the set and has NO credential row, which is the whole reason
    the count is read rather than counted: a portal totalling the rows it can
    see would answer "5" here, and the set is "what your market requires of
    every business, plus what the categories you have published listings in
    require". The unmet case is on `ACCOUNT_LIVE_OUTSTANDING`, so this identity
    keeps its empty `blocking`.
  */
  requiredDocuments: [
    { type: "directorate_registration", satisfied: true },
    { type: "insurance", satisfied: true },
    { type: "boat", satisfied: true },
    { type: "bank", satisfied: true },
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
      // Required since yuvoy-api#139: a missing credential does stop a sale.
      gates: true,
      since: todayAt("09:00", -3),
    },
    {
      code: "CREDENTIAL_MISSING",
      label: "We still need your insurance certificate",
      waitingOn: "operator",
      gates: true,
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
      // Nothing sells until the review finishes, so this one gates.
      gates: true,
      since: todayAt("11:00", -1),
    },
  ],
  credentials: [
    {
      /*
        Pending with no file, so it takes one, on a business whose service has
        no documents store: the mock answers this identity's upload intents
        `503 documents_unavailable`, which is what production answers today
        (yuvoy-operator#93). It is how the plain "switched off" state runs.
      */
      id: "cred_directorate_awaiting",
      type: "directorate_registration",
      state: "pending",
      mandatory: true,
      issuer: "A&N Tourism Directorate",
      hasFile: false,
      expiresOn: marketDay(300),
    },
  ],
};

/**
 * LIVE, selling, and still owing us two things — yuvoy-operator#38.
 *
 * The fifth state, and the one that regressed. `bookable` used to go false
 * for ANY outstanding item, so this combination could not occur and the
 * portal gated the whole outstanding list on `!bookable`. yuvoy-api#139
 * narrowed `bookable` to things that actually stop a sale — an operator with
 * three listings selling in the feed was being told "you cannot be booked
 * yet" over a missing logo — and the list promptly disappeared for everybody
 * in this state, which is production's `HC Diving skl` and most live
 * operators besides.
 *
 * Both rows are `gates: false`: real asks, stopping nothing. That is the
 * distinction the whole API change exists to express, and a fixture without
 * it would let the list vanish again with every test still green.
 */
export const ACCOUNT_LIVE_OUTSTANDING = {
  state: "LIVE",
  bookable: true,
  blocking: [
    {
      code: "BUSINESS_DETAILS_INCOMPLETE",
      label: "We still need your registered business name and address",
      waitingOn: "operator",
      gates: false,
      since: todayAt("09:00", -9),
    },
    {
      code: "LOGO_MISSING",
      label: "We still need your logo",
      waitingOn: "operator",
      gates: false,
      since: todayAt("09:00", -9),
    },
    {
      /*
        The blocker that explains an unmet required document — yuvoy-operator#46
        item 1. "A document that is not satisfied always has a `CREDENTIAL_*`
        entry in `blocking` saying why", and without one the row would name a
        document and no reason.
      */
      code: "CREDENTIAL_MISSING",
      label: "We have no equipment inspection on file.",
      waitingOn: "operator",
      gates: false,
      since: todayAt("09:00", -5),
    },
  ],
  credentials: ACCOUNT_LIVE.credentials,
  /*
    Five required, four met. `equipment` is required and has no credential row
    at all, so a portal counting the rows it can see would answer "4 of 4" and
    tell an operator they were finished.
  */
  requiredDocuments: [
    ...ACCOUNT_LIVE.requiredDocuments,
    { type: "equipment", satisfied: false },
  ],
};

export const SUSPENDED_ID = "usr_suspended";

/**
 * A suspended business, as `GET /me` now answers it - yuvoy-operator#50.
 *
 * Live-shaped in every other respect, because that is the point: it signs in,
 * reads everything and runs the trips it has already sold. `bookable` is false
 * and `OPERATOR_SUSPENDED` sits in `blocking` like any other reason, with the
 * detail in `suspension`.
 *
 * The three sentences are the API's own, from the contract's description of
 * the field. `adminMessage` is included because it is the one a person wrote
 * and the one a screen is most likely to drop.
 */
export const ACCOUNT_SUSPENDED = {
  state: "SUSPENDED",
  bookable: false,
  blocking: [
    {
      code: "OPERATOR_SUSPENDED",
      label: "Your account has been suspended",
      waitingOn: "yuvoy",
      gates: true,
      since: todayAt("09:00", -3),
    },
  ],
  credentials: ACCOUNT_LIVE.credentials,
  suspension: {
    since: todayAt("09:00", -3),
    message:
      "Your account has been suspended. Please reach out to admin for help.",
    adminMessage:
      "We have had three complaints about missed pickups this month. Call us before your next departure.",
    stillAllowed:
      "You can still read everything, run or stop the trips already booked with anything paid online refunded in full, and deal with your team, a bank change and your documents.",
  },
};
export const PROSPECT_ID = "usr_prospect";
export const AWAITING_ID = "usr_awaiting";
/** Live and selling, with the logo and the registered address outstanding. */
export const LIVE_OUTSTANDING_ID = "usr_live_outstanding";
/** Their uploads drop once, mid-chunk. See `mocks/tus-server.ts`. */
export const DROPPING_ID = "usr_upload_drops";
/** A colleague holds the one upload slot, so they get the 409 that is left. */
export const CONTENDED_ID = "usr_upload_contended";
/** `GET /slots` refuses their wide range, and answers the fortnight. */
export const WIDE_READ_FAILS_ID = "usr_wide_read_fails";
export const FAILING_ID = "usr_api_failing";
/** A business with nothing on it yet: Home's start-selling checklist. */
export const NEW_BUSINESS_ID = "usr_new_business";

/* --------------------------------------------------- conversations ------- */

export interface MockMessage {
  id: string;
  from: "traveller" | "operator";
  senderName: string;
  text?: string;
  textRemovedAt?: string;
  sentAt: string;
}

export interface MockThread {
  bookingId: string;
  messages: MockMessage[];
  /** Absent means writable. Set means the composer is gone, and why. */
  closedReason?: "cancelled" | "declined" | "window_closed";
  /** How many of the traveller's messages nobody has marked read yet. */
  unread: number;
}

/**
 * Four conversations, and each one exists for a branch that is otherwise
 * unreachable — yuvoy-operator#52.
 *
 * `bkg_1` is the live one, and it carries **two unread** so the Home strip has a
 * number to draw and a number to lose. It is long enough to page: the endpoint's
 * first page is the most recent messages and `nextCursor` walks backwards, which
 * is the opposite of how a list usually reads, and a conversation that fits on
 * one page would let a client ship that backwards.
 *
 * `bkg_2` is CANCELLED: messages, the cancelled line, and no composer. `bkg_3`
 * is `window_closed`, which is the same shape with a different sentence and the
 * one an operator meets most often, since every trip reaches it eventually.
 *
 * `bkg_5` holds a message whose text was REMOVED. "The message stays, with who
 * wrote it and when" — an empty bubble would say somebody sent nothing, which is
 * a different and untrue thing.
 */
/**
 * The part of a long conversation nobody reads, so the part that CAN be paged.
 *
 * Alternating sides, oldest first, ending three days before the hand-written
 * messages begin. The first one is distinctive on purpose: it is what a test
 * looks for to prove "Show earlier messages" reached the beginning.
 */
function earlierChat(count: number): MockMessage[] {
  return Array.from({ length: count }, (_, i) => {
    const traveller = i % 2 === 0;
    return {
      id: `msg_1_early_${String(i).padStart(2, "0")}`,
      from: traveller ? ("traveller" as const) : ("operator" as const),
      senderName: traveller ? "Asha Menon" : "Priya Raut",
      text:
        i === 0
          ? "This is where the conversation begins."
          : traveller
            ? `Another question, number ${i}.`
            : `Answered, number ${i}.`,
      /*
        Spread across the days before the written ones, so the list is ordered by
        something real rather than by array position alone. Ten minutes apart is
        enough to keep every `sentAt` distinct without running into the next day.
      */
      sentAt: todayAt(
        `${String(8 + Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}`,
        -10 + Math.floor(i / 6),
      ),
    };
  });
}

export const MESSAGE_THREADS: MockThread[] = [
  {
    bookingId: "bkg_1",
    /*
      NO unread on this one, and that is a decision about the test suite rather
      than about the fixture.

      Reading a conversation marks it read, and it is not reversible. Half a
      dozen tests open this booking to exercise the composer, the paging and the
      removed text, so any unread here would be cleared by whichever ran first
      and the strip test would be racing them. `bkg_card` carries the unread
      instead, and nothing else in the suite opens it.
    */
    unread: 0,
    messages: [
      /*
        Longer than ONE PAGE, and that is the whole reason the filler is here.

        The endpoint's first page is the 50 most recent messages and `nextCursor`
        walks backwards through what came before, which is the opposite of how a
        list usually reads. A conversation that fitted on one page would let a
        client ship that backwards and nothing would notice, so this one does not
        fit: the eleven written out below are the most recent, and the generated
        block before them pushes the opening past the first page.

        Generated rather than typed, because forty-five lines of invented small
        talk would bury the eleven that carry the branches.
      */
      ...earlierChat(45),
      {
        id: "msg_1_01",
        from: "traveller",
        senderName: "Asha Menon",
        text: "Hello, we are two people booked for the dawn dive.",
        sentAt: todayAt("18:02", -3),
      },
      {
        id: "msg_1_02",
        from: "operator",
        senderName: "Priya Raut",
        text: "You are on the list. Be at Beach 3 dive hut by 06:30.",
        sentAt: todayAt("18:20", -3),
      },
      {
        id: "msg_1_03",
        from: "traveller",
        senderName: "Asha Menon",
        text: "Is there somewhere to leave a bag?",
        sentAt: todayAt("09:15", -2),
      },
      {
        id: "msg_1_04",
        from: "operator",
        senderName: "Priya Raut",
        text: "Yes, the hut has lockers. Bring your own padlock if you can.",
        sentAt: todayAt("09:40", -2),
      },
      {
        id: "msg_1_05",
        from: "traveller",
        senderName: "Asha Menon",
        text: "Perfect, thank you.",
        sentAt: todayAt("09:44", -2),
      },
      {
        id: "msg_1_06",
        from: "operator",
        senderName: "Dev Kapoor",
        /*
          A second name on the business's side. "The name of the person on the
          team who wrote it" — the traveller sees the business, the business sees
          who answered, and a screen showing one name for every outgoing message
          would hide which colleague already replied.
        */
        text: "Dev here, covering the morning. Anything else, just ask.",
        sentAt: todayAt("07:05", -1),
      },
      {
        id: "msg_1_07",
        from: "traveller",
        senderName: "Asha Menon",
        text: "One of us has not dived since last year. Is that a problem?",
        sentAt: todayAt("19:30", -1),
      },
      {
        id: "msg_1_08",
        from: "operator",
        senderName: "Priya Raut",
        text: "Not at all. We will run through the basics before we go in.",
        sentAt: todayAt("19:55", -1),
      },
      {
        id: "msg_1_09",
        from: "traveller",
        senderName: "Asha Menon",
        text: "Great. What time should we actually arrive?",
        sentAt: todayAt("05:10"),
      },
      {
        /*
          The first of the two unread ones, and the reason `unread` is 2: the
          count is the TRAVELLER's messages nobody has marked read, so the two
          newest from her are it.
        */
        id: "msg_1_10",
        from: "traveller",
        senderName: "Asha Menon",
        text: "Also, do you have fins in size 44?",
        sentAt: todayAt("05:12"),
      },
      {
        id: "msg_1_11",
        from: "traveller",
        senderName: "Asha Menon",
        text: "We are on our way now.",
        sentAt: todayAt("05:40"),
      },
    ],
  },
  {
    /*
      The only conversation with anything UNREAD, and the only one the Home strip
      and the unread chip are asserted against.

      Two messages, both from the traveller, both after the last thing the
      business said: `unreadCount` is "the traveller's messages nobody at the
      business has marked read", so a reply of ours in between would be counted
      by nobody and the number would not be two.
    */
    bookingId: "bkg_card",
    unread: 2,
    messages: [
      {
        id: "msg_card_01",
        from: "operator",
        senderName: "Priya Raut",
        text: "You are booked. Meet us at the counter twenty minutes before.",
        sentAt: todayAt("16:00", -1),
      },
      {
        id: "msg_card_02",
        from: "traveller",
        senderName: "Sofia Alves",
        text: "Is the counter the same one as the ticket office?",
        sentAt: todayAt("06:05"),
      },
      {
        id: "msg_card_03",
        from: "traveller",
        senderName: "Sofia Alves",
        text: "I am running about ten minutes behind.",
        sentAt: todayAt("06:20"),
      },
    ],
  },
  {
    bookingId: "bkg_2",
    unread: 0,
    closedReason: "cancelled",
    messages: [
      {
        id: "msg_2_01",
        from: "traveller",
        senderName: "Daniel Okafor",
        text: "Sorry, something has come up and I need to cancel.",
        sentAt: todayAt("14:00", -2),
      },
      {
        id: "msg_2_02",
        from: "operator",
        senderName: "Priya Raut",
        text: "No problem at all. Come and see us next season.",
        sentAt: todayAt("14:06", -2),
      },
    ],
  },
  {
    bookingId: "bkg_3",
    unread: 0,
    closedReason: "window_closed",
    messages: [
      {
        id: "msg_3_01",
        from: "operator",
        senderName: "Priya Raut",
        text: "Thanks for coming out with us. Hope the photos came out well.",
        sentAt: todayAt("16:00", -30),
      },
    ],
  },
  {
    /*
      `bkg_4` rather than an id nothing else knows: a thread has to resolve to a
      real booking for the list to carry its reference, its experience and its
      departure, and inventing one would give the conversations list a row that
      opens a 404.
    */
    bookingId: "bkg_4",
    unread: 0,
    closedReason: "window_closed",
    messages: [
      {
        id: "msg_4_01",
        from: "traveller",
        senderName: "Rhea Kapoor",
        /*
          No `text`. Removed "a set time after the trip ends (90 days unless the
          service is configured otherwise)", and the message stays: who wrote it,
          when, and this field in place of the words.
        */
        textRemovedAt: todayAt("03:00", -1),
        sentAt: todayAt("11:20", -95),
      },
      {
        id: "msg_4_02",
        from: "operator",
        senderName: "Priya Raut",
        textRemovedAt: todayAt("03:00", -1),
        sentAt: todayAt("11:31", -95),
      },
    ],
  },
];
