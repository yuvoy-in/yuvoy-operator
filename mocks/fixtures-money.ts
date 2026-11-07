/**
 * Settlements, statements, commission and the change requests, moved out of
 * fixtures.ts (yuvoy-operator#178), which re-exports them by name.
 */
import { marketDay, todayAt } from "./fixtures-base";

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

/**
 * Where to pay the commission statements (yuvoy-operator#121).
 *
 * A UPI ID on a handle no UPI app knows (`@example`), on purpose: somebody
 * tapping "Pay by UPI" in a development build must never be one confirm away
 * from paying a stranger who happens to own a real-looking ID.
 */
export const COMMISSION_PAY_TO = {
  available: true,
  upiId: "yuvoy.dev@example",
  payee: "Yuvoy (development)",
};

/**
 * Reef Divers' weekly commission statements, newest first, one in each
 * state, because each is a different promise: `issued` and `part_paid` have
 * something to pay, `paid` does not, and `waived` is settled without being
 * paid, which is the one most easily drawn as a debt.
 *
 * The figures close the way the contract says: `owedPaise` is
 * `commissionPaise - paidPaise`, 0 once waived, and each statement's lines
 * and payments add up to it, so the screen's "does not add up" check runs on
 * a passing case. One line took less than the fare and one week carries a
 * second rate, so neither the shortfall note nor `rateLabel` is only ever
 * read at 15%. ₹3,550 is owed across them.
 */
export const COMMISSION_STATEMENTS = [
  {
    id: "cst_issued",
    reference: "YC-7KQ2MZ9P",
    weekStart: "2026-09-21",
    weekEnd: "2026-09-27",
    state: "issued" as const,
    bookings: 2,
    farePaise: 1_500_000,
    commissionPaise: 225_000,
    paidPaise: 0,
    owedPaise: 225_000,
    issuedAt: "2026-09-29T03:30:00Z",
    lines: [
      {
        bookingReference: "YV-4QX7LM",
        tripDate: "2026-09-22",
        guests: 2,
        farePaise: 1_000_000,
        collectedPaise: 1_000_000,
        commissionRateBps: 1500,
        commissionPaise: 150_000,
      },
      {
        bookingReference: "YV-9RT2KD",
        tripDate: "2026-09-26",
        guests: 1,
        farePaise: 500_000,
        // Took ₹1,000 less than the fare. The commission is on the fare.
        collectedPaise: 400_000,
        commissionRateBps: 1500,
        commissionPaise: 75_000,
      },
    ],
    payments: [],
  },
  {
    id: "cst_part_paid",
    reference: "YC-3HD8WQ4N",
    weekStart: "2026-09-14",
    weekEnd: "2026-09-20",
    state: "part_paid" as const,
    bookings: 3,
    farePaise: 2_400_000,
    commissionPaise: 330_000,
    paidPaise: 200_000,
    owedPaise: 130_000,
    issuedAt: "2026-09-22T03:30:00Z",
    lines: [
      {
        bookingReference: "YV-6MB3ZP",
        tripDate: "2026-09-15",
        guests: 4,
        farePaise: 1_200_000,
        collectedPaise: 1_200_000,
        commissionRateBps: 1500,
        commissionPaise: 180_000,
      },
      {
        bookingReference: "YV-2KW9TJ",
        tripDate: "2026-09-17",
        guests: 2,
        farePaise: 800_000,
        collectedPaise: 800_000,
        commissionRateBps: 1250,
        commissionPaise: 100_000,
      },
      {
        bookingReference: "YV-8NC5VR",
        tripDate: "2026-09-19",
        guests: 1,
        farePaise: 400_000,
        collectedPaise: 400_000,
        commissionRateBps: 1250,
        commissionPaise: 50_000,
      },
    ],
    payments: [
      {
        amountPaise: 200_000,
        utr: "425918736201",
        receivedOn: "2026-09-24",
        recordedAt: "2026-09-24T10:15:00Z",
      },
    ],
  },
  {
    /*
      August, and a gap before the next: "a week with nothing owed has no
      statement". Also no week a payout fixture uses, so a week label on the
      Money tab is never two things at once.
    */
    id: "cst_paid",
    reference: "YC-9TP2XK6B",
    weekStart: "2026-08-10",
    weekEnd: "2026-08-16",
    state: "paid" as const,
    bookings: 1,
    farePaise: 900_000,
    commissionPaise: 135_000,
    paidPaise: 135_000,
    owedPaise: 0,
    issuedAt: "2026-08-18T03:30:00Z",
    lines: [
      {
        bookingReference: "YV-5JH7QS",
        tripDate: "2026-08-13",
        guests: 2,
        farePaise: 900_000,
        collectedPaise: 900_000,
        commissionRateBps: 1500,
        commissionPaise: 135_000,
      },
    ],
    payments: [
      {
        amountPaise: 135_000,
        utr: "425311902447",
        receivedOn: "2026-08-19",
        recordedAt: "2026-08-19T08:40:00Z",
      },
    ],
  },
  {
    id: "cst_waived",
    reference: "YC-1WV6RM3D",
    weekStart: "2026-08-03",
    weekEnd: "2026-08-09",
    state: "waived" as const,
    bookings: 1,
    farePaise: 300_000,
    commissionPaise: 45_000,
    paidPaise: 0,
    owedPaise: 0,
    issuedAt: "2026-08-11T03:30:00Z",
    waivedAt: "2026-08-25T06:00:00Z",
    lines: [
      {
        bookingReference: "YV-3GF8NA",
        tripDate: "2026-08-05",
        guests: 1,
        farePaise: 300_000,
        collectedPaise: 300_000,
        commissionRateBps: 1500,
        commissionPaise: 45_000,
      },
    ],
    payments: [],
  },
];

export const CHANGE_REQUESTS = [
  {
    id: "chg_bank_1",
    // The API's word, `bank_account`. This said `bank`, and every screen that
    // looked for `bank` passed against it while matching nothing in production.
    kind: "bank_account",
    // `cooling` is approved and STILL STOPPABLE — the state most worth
    // rendering, because an operator can still act on it.
    state: "cooling",
    summary: "HDFC Bank ····4417 (HDFC0001234)",
    requestedAt: todayAt("09:00", -1),
    objectionUntil: null,
    coolingUntil: todayAt("09:00", 1),
  },
  {
    /*
      A bank change we refused, with the sentence the API writes for the
      business (yuvoy-api#223, `ChangeRejectionMessage`). It names the
      published support line: the API's own constant is a number that is not
      Yuvoy's (yuvoy-api#235), and the portal holds back any sentence naming
      another number, which the unit tests cover; this is the API once fixed.
    */
    id: "chg_bank_rejected",
    kind: "bank_account",
    state: "rejected",
    summary: "SBI ····1111 (SBIN0000123)",
    requestedAt: todayAt("09:00", -60),
    objectionUntil: null,
    coolingUntil: null,
    rejectionReason:
      "We could not accept the new bank details. Your payouts still go to the account already on file. Call us on +91 81216 57657 and we will tell you what we need.",
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

/**
 * The bank change history of `BANK_UNCONFIRMED_ID`'s business: one change,
 * applied two days ago, which is the account on file. `GET /me` holds its
 * payouts until our team updates the bank we pay from to match it.
 */
export const BANK_UNCONFIRMED_CHANGES = [
  {
    id: "chg_bank_unconfirmed",
    kind: "bank_account",
    state: "applied",
    summary: "ICICI Bank ····7788 (ICIC0000456)",
    requestedAt: todayAt("09:00", -4),
    objectionUntil: null,
    coolingUntil: todayAt("09:00", -2),
  },
];
