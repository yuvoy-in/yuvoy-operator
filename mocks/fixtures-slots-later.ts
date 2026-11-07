import { TZ, todayAt, type MockSlot } from "./fixtures-base";

export const LATER_SLOTS: MockSlot[] = [
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
