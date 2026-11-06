/**
 * Today's departures, moved out of
 * fixtures.ts (yuvoy-operator#178), which re-exports them by name.
 */
import { TZ, todayAt, earlierToday, type MockSlot } from "./fixtures-base";
import { LATER_SLOTS } from "./fixtures-slots-later";

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
  ...LATER_SLOTS,
];
