/**
 * The operator, the market clock, the departure types and the dev code, moved out of
 * fixtures.ts (yuvoy-operator#178), which re-exports them by name.
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

export const TZ = "Asia/Kolkata";

/** The market's calendar date, `YYYY-MM-DD`, `dayOffset` days from now. */
export function marketDay(dayOffset = 0): string {
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

export const DEV_CODE = "424242";
