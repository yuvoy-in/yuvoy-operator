/**
 * The booking requests, moved out of
 * fixtures.ts (yuvoy-operator#178), which re-exports them by name.
 */
import { TZ, todayAt } from "./fixtures-base";

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
