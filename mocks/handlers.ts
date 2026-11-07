import { http, HttpResponse } from "msw";
import { apiBaseUrl } from "../src/lib/api/server-client";
import {
  MOCK_TUS_PORT,
  resetMockPhotos,
  resetMockDocuments,
  resetMockUploads,
} from "./tus-server";
import { validateRelay } from "../src/lib/day/relay-types";
import {
  ACCOUNT_AWAITING,
  ACCOUNT_LIVE,
  ACCOUNT_LIVE_OUTSTANDING,
  ACCOUNT_PROSPECT,
  AWAITING_ID,
  BANK_UNCONFIRMED_CHANGES,
  BANK_UNCONFIRMED_ID,
  CHANGE_REQUESTS,
  BUSINESS_NAME,
  FAILING_ID,
  OTHER_MEMBERS,
  LIVE_OUTSTANDING_ID,
  PROSPECT_ID,
  SUSPENDED_ID,
  ACCOUNT_SUSPENDED,
  SLOTS,
  TEAM,
  MESSAGE_THREADS,
  type MockMessage,
  type MockThread,
  type MockParty,
  WIDE_READ_FAILS_ID,
  NEW_BUSINESS_ID,
  type MockSlot,
  type MockTeamMember,
} from "./fixtures";
import { claimHandlers, resetClaimMocks } from "./claims-handlers";
import { moneyHandlers } from "./money-handlers";
import { bankChangeHandlers } from "./bank-change-handlers";
import { capacityHandlers, type MockClosure } from "./capacity-handlers";
import { departureHandlers } from "./departure-handlers";
import { dayHandlers } from "./day-handlers";
import { bookingHandlers } from "./booking-handlers";
import { conversationHandlers } from "./conversation-handlers";
import { bookingActionHandlers } from "./booking-action-handlers";
import { mediaHandlers, type MockMediaAsset } from "./media-handlers";
import { photoHandlers } from "./photo-handlers";
import { listingHandlers, type MockQuestion } from "./listing-handlers";
import {
  storyHandlers,
  type MockStory,
  type MockStoryPhoto,
} from "./story-handlers";
import { teamHandlers } from "./team-handlers";
import { authHandlers } from "./auth-handlers";
import { profileHandlers, type MockProfile } from "./profile-handlers";
import { documentFileHandlers } from "./document-file-handlers";
import { checkInHandlers } from "./check-in-handlers";
import { experienceHandlers, type MockExperience } from "./experience-handlers";
import { scheduleHandlers } from "./schedule-handlers";

/**
 * The operator API, mocked.
 *
 * Server-side only. Every call in this portal is made from a server component
 * or a Server Action, so unlike the traveller app there is no browser worker
 * here and nothing to race against on first paint.
 *
 * The handlers enforce the rules that matter rather than just returning shapes
 * — attendance really is idempotent for `arrived`, terminal outcomes really
 * are refused before the departure time, and a settled booking really refuses
 * to be re-settled. A mock that says yes to everything is how a client ships
 * against behaviour the API does not have.
 */

/*
  The same resolver the client uses, not a second copy of the fallback. A mock
  registered against a slightly different base URL intercepts nothing, and the
  symptom is a real network call to somewhere that is not listening — which
  looks exactly like the API being down.
*/
const url = (path: string) => `${apiBaseUrl()}${path}`;

/**
 * The mock's session table, as a function of the team.
 *
 * A single hard-coded token was enough while every screen belonged to one
 * identity. O5 is the screen that ends that: a portal whose whole subject is
 * "three people, three different amounts of access" cannot be exercised by a
 * mock that only knows one of them, and the first version of these handlers
 * checked the OWNER fixture's roles rather than the caller's — which would
 * have let a MANAGER invite somebody here while the real API answered 403.
 *
 * Two properties fall out of resolving the token against the live team rather
 * than a constant, and both match the API:
 *
 *   - **Removing somebody ends their session.** The lookup simply stops
 *     finding them, so their next request is a 401. "Their sessions are
 *     revoked in the same transaction."
 *   - **Only a real member can sign in.** A number nobody on the account owns
 *     gets the same 401 as a wrong code — which is what makes the accept →
 *     sign-in journey worth testing at all.
 */
const sessionTokenFor = (id: string) => `opsess_mock_${id}`;

function sessionUser(request: Request): MockTeamMember | null {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer opsess_mock_(.+)$/);
  if (!match) return null;
  // A pending row is an invitation, not a user, and cannot hold a session.
  return (
    [...team, ...OTHER_MEMBERS, ...signups].find(
      (m) => !m.pending && m.id === match[1],
    ) ?? null
  );
}

/**
 * Which BUSINESS this session belongs to, as far as these mocks model one.
 *
 * Everybody on `TEAM` works for Reef Divers and shares its state. An identity
 * created through `POST /auth/signup` is a business of its own, brand new, with
 * nothing behind it — and `OTHER_MEMBERS` belong to businesses this mock does not
 * otherwise model.
 *
 * It exists because one piece of state was leaking across all of them: the bank
 * change list. An account created a minute ago was shown Reef Divers' open
 * change and told "there is already a change in progress", which is not a screen
 * the real API can produce. It also made a second business's tests depend on
 * whether another spec had raised one, which is a race rather than a fixture.
 */
function businessOf(request: Request): string {
  const me = sessionUser(request);
  if (!me) return "none";
  return team.some((m) => m.id === me.id) ? "reef" : `solo:${me.id}`;
}

/**
 * Whether this session is the business with nothing on it yet
 * (yuvoy-operator#96): no listings, departures, requests, reels or
 * conversations. Every other identity reads the fixture dive shop's, which is
 * what their own screens are tested against, so this one is answered empty by
 * name rather than by changing what a business owns for everybody.
 */
function isNewBusiness(request: Request): boolean {
  return sessionUser(request)?.id === NEW_BUSINESS_ID;
}

/**
 * Whether this session sees no commission statements (yuvoy-operator#121):
 * the manager, who owes nothing on `/commission-owed` either, and the
 * business with nothing on it yet, which has taken no cash to be billed for.
 */
function ownsNoStatements(request: Request): boolean {
  return (
    sessionUser(request)?.id === "usr_manager_dev" || isNewBusiness(request)
  );
}

/**
 * The change requests this session's business actually has.
 *
 * `CHANGE_REQUESTS` is Reef Divers' history; `bankChanges` is what anybody has
 * raised since the process started, each tagged with `raisedFor`. The tag is
 * stripped here rather than stored on the way out, because it is bookkeeping
 * this mock needs and not a field the API sends.
 */
function changesFor(request: Request): Record<string, unknown>[] {
  const mine = businessOf(request);
  /*
    Newest first, as the API orders them. A logo or details change is filed
    in the same table as a bank change (`operator_change_requests`, kind
    `logo` or `profile`) and listed beside it, so the screens that read this
    for a bank change have to filter on `kind`, and do.
  */
  const raised = [...accountChanges, ...bankChanges]
    .filter((r) => r.raisedFor === mine)
    .map((r) => {
      const out = { ...r };
      delete out.raisedFor;
      return out;
    });
  if (mine === "reef") return [...raised, ...CHANGE_REQUESTS];
  if (mine === `solo:${BANK_UNCONFIRMED_ID}`) {
    return [...raised, ...BANK_UNCONFIRMED_CHANGES];
  }
  return raised;
}

/**
 * This business's bank changes that are still open: not yet live, not
 * stopped and not refused.
 *
 * BANK changes only. The list also carries logo and details changes waiting
 * for review (the same table, another `kind`), and one of those in flight
 * says nothing about where the money goes: counting it refused every bank
 * change raised after a live business sent a new logo.
 *
 * `approved` is open too: the API holds payouts on it as on the other three
 * (`readPayoutHolds`), whatever this portal's own screens make of it.
 */
function openBankChanges(request: Request): Record<string, unknown>[] {
  return changesFor(request).filter(
    (r) =>
      (r as { kind?: string }).kind === "bank_account" &&
      !stoppedChanges.includes(String((r as { id?: string }).id)) &&
      ["objection_window", "pending", "cooling", "approved"].includes(
        String((r as { state?: string }).state),
      ),
  );
}

/**
 * `payoutsHeld` on `GET /me`, by the API's rule (yuvoy-api#275): a bank
 * change still open holds first; then a new account that went live and that
 * our team has not yet put into the bank we pay from. Only
 * `BANK_UNCONFIRMED_ID`'s business is in that second state here.
 */
function payoutsHeldFor(request: Request) {
  if (openBankChanges(request).length > 0) {
    return { held: true, reason: "bank_change_in_progress" };
  }
  if (businessOf(request) === `solo:${BANK_UNCONFIRMED_ID}`) {
    return { held: true, reason: "destination_unconfirmed" };
  }
  return { held: false, reason: null };
}

/**
 * A LIVE business's logo or details change, filed for review the way the API
 * files it: one pending row per kind, a new one withdrawing the last
 * (`operator_logo.go`, `operator_business_details.go` at e7291e3).
 */
let accountChanges: Record<string, unknown>[] = [];

/** Departures whose hand-set seats were confirmed this session. */
let seatsConfirmed: Record<string, true> = {};

/** Off sale only because nobody confirmed its seats (yuvoy-api#211). */
function seatsAwaitingConfirmation(slot: MockSlot): boolean {
  return Boolean(slot.seatsUnconfirmed) && !seatsConfirmed[slot.id];
}

function fileForReview(
  request: Request,
  kind: "logo" | "profile",
  summary: string,
) {
  const mine = businessOf(request);
  accountChanges = accountChanges.map((r) =>
    r.raisedFor === mine && r.kind === kind && r.state === "pending"
      ? { ...r, state: "withdrawn" }
      : r,
  );
  accountChanges = [
    {
      id: `chg_${kind}_${Math.random().toString(36).slice(2, 8)}`,
      kind,
      state: "pending",
      summary,
      requestedAt: new Date().toISOString(),
      objectionUntil: null,
      coolingUntil: null,
      raisedFor: mine,
    },
    ...accountChanges,
  ];
}

/**
 * OWNER, ADMIN or MANAGER, exactly as `GET /me` defines it (yuvoy-api
 * `Identity.CanManage`). It left ADMIN out, so an admin read as staff here and
 * nowhere else: the mock refused them what the API allows.
 */
const canManage = (member: MockTeamMember) =>
  member.roles.includes("OWNER") ||
  member.roles.includes("ADMIN") ||
  member.roles.includes("MANAGER");

let attendance: Record<string, { outcome: string; arrivedAt?: string }> = {};
/**
 * Message sends kept under their Idempotency-Key, `person:key`, with the
 * request they answered (B4, yuvoy-api#282 item 4).
 */
const messageKeys = new Map<
  string,
  { fingerprint: string; message: MockMessage }
>();
/** Wrong sign-in codes per number. The sixth answers 429. */
let codeAttempts: Record<string, number> = {};
const CODE_ATTEMPT_LIMIT = 5;

/**
 * A number whose account was offboarded, so `POST /auth/session` refuses it
 * with `403 account_not_active` even with the right code. Belongs to nobody on
 * any team, which is what an offboarded account's people are to the rest of
 * the mock.
 */
const OFFBOARDED_PHONE = "+919000000198";
/** Requests that have been answered. An answered one is not open any more. */
let answered: Record<string, "active" | "released"> = {};
/** Departures called off in this session. Irreversible, as in production. */
let calledOff: Record<string, string> = {};
/** Seats offered, once an operator has changed them in this session. */
let capacity: Record<string, number> = {};
/** Seats reported sold at the operator's own counter. */
let offlineSold: Record<string, number> = {};
/**
 * Each counter sale recorded this session, so one can be taken back by its id
 * (`DELETE /slots/{id}/offline-sales/{saleId}`, yuvoy-api#226). A take-back
 * leaves the entry on the record, as the API's append-only adjustments do.
 */
let offlineEntries: {
  id: string;
  slotId: string;
  seats: number;
  takenBack: boolean;
}[] = [];
/** Sessions elevated by a step-up code, and bank changes raised. */
let steppedUp = false;
let bankChanges: Record<string, unknown>[] = [];
let stoppedChanges: string[] = [];
/**
 * The team, mutated in place for the life of the server process.
 *
 * A copy rather than the fixture itself, so a reset restores the fixture
 * instead of restoring whatever the last test left behind.
 */
let team: MockTeamMember[] = TEAM.map((m) => ({ ...m }));
/**
 * Operators who created their own account this session (O1, `POST
 * /auth/signup`).
 *
 * A separate list rather than rows appended to `team`: a signup creates a NEW
 * BUSINESS, not a colleague at the fixture's dive shop. Putting them in `team`
 * would show a stranger on `/team` — which is the one screen whose whole
 * subject is who can get into your business.
 */
let signups: MockTeamMember[] = [];
/**
 * Upload intents for a document's file, by intent id — yuvoy-operator#46.
 *
 * Kept as state because `complete` is specified to CHECK rather than trust:
 * "the browser saying it finished is a reason to look, not a fact … that it is
 * the size declared, and that its first bytes are the kind its label claims."
 * A mock that recorded nothing at intent time would have nothing to check
 * against, and the portal's whole failure surface would ship unexercised.
 */
let documentIntents: Record<
  string,
  {
    credentialId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    /** Refused or already used. A closed intent answers `upload_closed`. */
    closed?: boolean;
  }
> = {};
/** Files on record, by credential id. What `hasFile` and `filename` read. */
let documentFiles: Record<
  string,
  { filename: string; sizeBytes: number; contentType: string }
> = {};
/**
 * Notification switches somebody has changed, by user id then group.
 *
 * Absent means ON, which is the contract's own default: "every switch is on
 * until somebody turns it off." Stored as the change rather than as the whole
 * set for the same reason the endpoint takes one switch at a time — two people
 * on two phones must not overwrite each other.
 *
 * `by` is what makes item 6 testable: an owner turning off a staff member's
 * switch has to show up, by name, on that person's own screen.
 */
let switchState: Record<
  string,
  Record<string, { on: boolean; at: string; by: { id: string; name: string } }>
> = {};
/**
 * Bookings this team cancelled, by id — yuvoy-operator#43 item 4.
 *
 * Kept as state rather than baked into a fixture, because the whole point of
 * the endpoint is that the second call answers `409 already_cancelled` and
 * refunds nothing twice. A mock that cancelled statelessly would let the portal
 * ship a retry that refunds again.
 */
let cancelled: Record<
  string,
  { at: string; reasonCode: string; refundedPaise: number }
> = {};
/** Cash handed back, by booking id. Recorded once, and it cannot be undone. */
let cashReturned: Record<
  string,
  { returnedAt: string; returnedPaise: number }
> = {};
/** Conversations, by booking. Written to by `POST /bookings/{id}/messages`. */
let threads: MockThread[] = seedThreads();
function seedThreads(): MockThread[] {
  return MESSAGE_THREADS.map((t) => ({
    ...t,
    messages: t.messages.map((m) => ({ ...m })),
  }));
}
/** Upload intents in flight, by operator. One at a time, as the API enforces. */
let uploadIntents: Record<
  string,
  { id: string; uploadId: string; sizeBytes: number; confirmedAt?: number }
> = {};

/** A tiny inline picture, so a poster needs no network and no binary fixture. */
const FIXTURE_POSTER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160">' +
      '<rect width="120" height="160" fill="#2f4f43"/></svg>',
  );

function seedExperiences(): MockExperience[] {
  return [
    /*
      THE LISTINGS THE DEPARTURE FIXTURES BELONG TO — yuvoy-operator#32.

      `SLOTS` reference `exp_try_dive`, `exp_snorkel` and `exp_charter`, and
      until this issue none of the three existed here: departures and listings
      were two disjoint fixture sets, because the two screens read from two
      different endpoints and nothing made them agree.

      That mirrored the defect rather than catching it. Capacity built its
      picker from departures and Services listed from `/experiences`, so a
      listing existed on one tab and not the other — and a mock in which the
      same is true cannot fail when a screen gets it wrong. In the real API
      these are one table, and now they are one fixture set.

      Live and sellable, because they carry the departures every capacity and
      manifest test edits.
    */
    {
      id: "exp_try_dive",
      slug: "try-dive-nemo-reef",
      title: "Try-dive at Nemo Reef",
      summary: "Your first breath underwater, on a shallow reef.",
      category: "adventure",
      destination: "andaman/havelock",
      status: "live",
      publicationState: "published",
      bookingMode: "allotment",
      durationMinutes: 180,
      maxPartySize: 6,
      unitPricePaise: 450000,
      pricingUnit: "per_person",
      meetingPoint: "Beach 3 dive hut",
      activityType: "scuba",
      activityTypeLabel: "Scuba diving",
      publishBlockers: [],
      sellable: true,
      upcomingDepartures: 6,
      /*
        A schedule that exists, so clearing it is the branch the form asks
        about. A listing with none can be saved empty without a question, which
        is the other half and is what every other fixture here covers.
      */
      schedule: {
        repeatsWeekly: true,
        weekly: [
          { weekday: 2, startTime: "09:00", seats: 8 },
          { weekday: 4, startTime: "09:00", seats: 8 },
        ],
      },
    },
    {
      id: "exp_snorkel",
      slug: "snorkel-elephant-beach",
      title: "Snorkel trip to Elephant Beach",
      summary: "A boat out to the reef and back before lunch.",
      category: "adventure",
      destination: "andaman/havelock",
      status: "live",
      publicationState: "published",
      bookingMode: "allotment",
      durationMinutes: 240,
      maxPartySize: 8,
      unitPricePaise: 320000,
      pricingUnit: "per_person",
      meetingPoint: "Havelock jetty 2",
      activityType: "snorkelling",
      activityTypeLabel: "Snorkelling",
      publishBlockers: [],
      sellable: true,
      upcomingDepartures: 5,
    },
    {
      id: "exp_charter",
      slug: "private-boat-charter",
      title: "Private boat charter, whole day",
      summary: "The boat, the crew and the day are yours.",
      category: "nature_wildlife",
      destination: "andaman/havelock",
      status: "live",
      publicationState: "published",
      durationMinutes: 480,
      maxPartySize: 10,
      unitPricePaise: 1200000,
      // Group pricing, so a per-person phrase here would misstate it.
      pricingUnit: "per_group",
      meetingPoint: "Havelock jetty 1",
      /*
        A LISTING THAT PREDATES THE TAXONOMY — yuvoy-operator#39.

        No `activityType`, and the API names it as a publish blocker on a
        listing that is nonetheless live and selling. That combination is not
        contrived: `testactivity`, `test2activity` and `test3` are all in it in
        production, because `activityType` became mandatory after they were
        written. Blockers describe what would stop the NEXT approval, not
        whether the listing is on sale today.

        This is the fixture the edit form's activity picker exists for. Without
        it the picker could be deleted and every test would still pass.
      */
      publishBlockers: ["activityType"],
      sellable: true,
      upcomingDepartures: 2,
    },
    {
      id: "exp_dive",
      slug: "reef-dive",
      title: "Reef dive",
      summary: "A guided dive on the house reef.",
      category: "adventure",
      destination: "andaman/havelock",
      status: "live",
      publicationState: "published",
      bookingMode: "allotment",
      durationMinutes: 180,
      maxPartySize: 6,
      unitPricePaise: 450000,
      pricingUnit: "per_person",
      meetingPoint: "Beach 3 dive hut",
      /*
        The only fixture carrying the material fields, so the edit form's
        pre-fill is exercised rather than assumed. Arrays on the wire and one
        per line on the form, which is the conversion most likely to be got
        wrong in one direction only.
      */
      activityType: "scuba",
      activityTypeLabel: "Scuba diving",
      publishBlockers: [],
      inclusions: ["Mask and fins", "One guided dive", "Drinking water"],
      requirements: ["Able to swim 50m", "No diving within 24h of flying"],
      safetyNotes: "Two guides in the water on every dive.",
      upcomingDepartures: 4,
      sellable: true,
      review: { state: "applied" },
    },
    /*
      A live listing that exists ONLY to be taken off sale.

      The withdraw walkthrough mutates whatever it touches, and the mock server
      is shared across the whole run — so pointing it at `exp_dive` left that
      listing withdrawn for every test after it, and for every rerun against a
      reused server. Same call `med_unattached_fixture` makes on the media side.

      Carries footage so it does not change which listings the Activities
      screen reports as "on sale with nothing to show".
    */
    {
      id: "exp_offsale",
      slug: "sunrise-paddle",
      title: "Sunrise paddle",
      summary: "A quiet hour on the water before the island wakes up.",
      category: "nature_wildlife",
      destination: "andaman/havelock",
      status: "live",
      publicationState: "published",
      bookingMode: "allotment",
      durationMinutes: 60,
      maxPartySize: 4,
      unitPricePaise: 120000,
      pricingUnit: "per_person",
      activityType: "mangrove_kayak",
      activityTypeLabel: "Mangrove kayaking",
      publishBlockers: [],
      meetingPoint: "Beach 1, by the boats",
      upcomingDepartures: 2,
      sellable: true,
      review: { state: "applied" },
    },
    /*
      PAUSED, AND NOT READY TO COME BACK — yuvoy-operator#44.

      Resuming is refused with `400` while a mandatory field is empty, "so you
      find out while the form is open rather than after putting something back
      that cannot sell". This one lost its meeting point while it was off sale,
      which is the case the refusal exists for. Nothing can succeed against it,
      so both Playwright projects may ask.
    */
    {
      id: "exp_paused_incomplete",
      slug: "dusk-paddle",
      title: "Dusk paddle",
      summary: "An hour on the water as the light goes.",
      category: "nature_wildlife",
      destination: "andaman/havelock",
      status: "withdrawn",
      publicationState: "withdrawn",
      bookingMode: "allotment",
      durationMinutes: 60,
      maxPartySize: 4,
      unitPricePaise: 110000,
      pricingUnit: "per_person",
      activityType: "mangrove_kayak",
      activityTypeLabel: "Mangrove kayaking",
      publishBlockers: ["meetingPoint"],
      sellable: true,
      upcomingDepartures: 0,
      review: { state: "applied" },
    },
    {
      id: "exp_boat",
      slug: "island-boat-day",
      title: "Island boat day",
      category: "nature_wildlife",
      destination: "andaman/havelock",
      status: "draft",
      publicationState: "draft",
      // No price — "saves but cannot be approved". The one fixture that proves
      // the form says so while they are writing rather than after a review.
      unitPricePaise: null,
      /*
        The listing that actually shows the blockers list — yuvoy-operator#30
        §3. No price, no summary, no activity type, and a basis nobody stated.
        Before this the row could only say "No price yet", which was true and
        incomplete: the operator sent it for review and found out the rest.

        `pricingUnit` is the interesting one — the column is NOT NULL, so the
        value alone cannot say whether anybody chose it, and an unstated basis
        blocks publication rather than printing a guessed phrase beside the
        price.
      */
      publishBlockers: [
        "summary",
        "activityType",
        "unitPricePaise",
        "pricingUnit",
      ],
      sellable: false,
      upcomingDepartures: 0,
    },
    {
      id: "exp_sunset",
      slug: "sunset-cruise",
      title: "Sunset cruise",
      category: "local_life",
      destination: "andaman/neil",
      /*
        On sale AND with us. The state the contract calls out: "a published
        listing with a submitted edit is live and in review", and a client
        recombining the parts would call it one or the other.
      */
      status: "live_changes_in_review",
      publicationState: "published",
      unitPricePaise: 300000,
      sellable: true,
      upcomingDepartures: 2,
      review: { state: "submitted", since: new Date().toISOString() },
    },
    /*
      Two live listings that exist only to have a change proposed on them, one
      per Playwright project.

      A revision moves `status` in the shared Next server process, so a listing
      both projects can submit against is a race in the FIXTURE — and it would
      take "On sale" away from whichever assertion ran second. Exactly the call
      `slot_calloff_a` and `slot_calloff_b` make on the day screen.

      `exp_dive` is deliberately NOT used for it: other checks rely on that row
      still reading as plainly on sale.
    */
    /*
      A LIVE listing with nothing attached to it, and nothing else asserts on
      it — yuvoy-operator#58.

      The cross-link it proves is the one the two old section pages existed for:
      "on sale with nothing to show", which renders as a black card in the
      traveller app and is exactly what `yuvoy.in` showed for months. It needs a
      listing that is selling AND has no media, and every other live fixture is
      either attached to by `reels.spec.ts` or submitted against elsewhere.
    */
    /*
      A listing that exists only to carry a COVER and a GALLERY item —
      yuvoy-operator#67.

      Its own, because `med_published_fixture` is consumed by the takedown walk
      and a role assertion against it passes alone and fails in a full run. The
      same trap the revision and taxonomy fixtures exist for.
    */
    {
      id: "exp_cover",
      slug: "cover-role-fixture",
      title: "Coral wall (cover fixture)",
      summary: "A wall dive for the role fixtures.",
      category: "adventure",
      destination: "andaman/havelock",
      status: "live",
      publicationState: "published",
      unitPricePaise: 400000,
      pricingUnit: "per_person",
      activityType: "scuba",
      meetingPoint: "Beach 3 dive hut",
      upcomingDepartures: 1,
      sellable: true,
      review: { state: "applied" },
    },
    {
      id: "exp_nofootage",
      slug: "blue-lagoon-no-footage",
      title: "Blue lagoon (no footage fixture)",
      summary: "A quiet hour in the lagoon.",
      category: "nature_wildlife",
      destination: "andaman/havelock",
      status: "live",
      publicationState: "published",
      unitPricePaise: 150000,
      pricingUnit: "per_person",
      meetingPoint: "Havelock jetty 2",
      upcomingDepartures: 1,
      sellable: true,
      review: { state: "applied" },
    },
    {
      id: "exp_revision_a",
      slug: "revision-fixture-a",
      title: "Lagoon snorkel (revision fixture A)",
      category: "nature_wildlife",
      destination: "andaman/havelock",
      status: "live",
      publicationState: "published",
      unitPricePaise: 220000,
      pricingUnit: "per_person",
      meetingPoint: "Beach 3 dive hut",
      upcomingDepartures: 1,
      sellable: true,
      review: { state: "applied" },
    },
    {
      id: "exp_revision_b",
      slug: "revision-fixture-b",
      title: "Lagoon snorkel (revision fixture B)",
      category: "nature_wildlife",
      destination: "andaman/havelock",
      status: "live",
      publicationState: "published",
      unitPricePaise: 220000,
      pricingUnit: "per_person",
      meetingPoint: "Beach 3 dive hut",
      upcomingDepartures: 1,
      sellable: true,
      review: { state: "applied" },
    },
    /*
      A LISTING THAT PREDATES THE TAXONOMY, one per project —
      yuvoy-operator#39.

      No `activityType`, and the API names it as a publish blocker on a listing
      that is nonetheless live. `exp_charter` carries the same combination and
      is what the READ side asserts against; these two exist because the
      activity test SUBMITS, and a revision moves `status` in the shared Next
      server process — submitting against a row another test asserts on takes
      "On sale" away from whichever runs second, which is the trap already
      documented on the revision fixtures above.
    */
    {
      id: "exp_taxonomy_a",
      slug: "pre-taxonomy-a",
      title: "Mangrove drift (taxonomy fixture A)",
      summary: "A slow paddle through the mangroves.",
      category: "nature_wildlife",
      destination: "andaman/havelock",
      status: "live",
      publicationState: "published",
      unitPricePaise: 180000,
      pricingUnit: "per_person",
      meetingPoint: "Havelock jetty 1",
      upcomingDepartures: 1,
      publishBlockers: ["activityType"],
      sellable: true,
      review: { state: "applied" },
    },
    {
      id: "exp_taxonomy_b",
      slug: "pre-taxonomy-b",
      title: "Mangrove drift (taxonomy fixture B)",
      summary: "A slow paddle through the mangroves.",
      category: "nature_wildlife",
      destination: "andaman/havelock",
      status: "live",
      publicationState: "published",
      unitPricePaise: 180000,
      pricingUnit: "per_person",
      meetingPoint: "Havelock jetty 1",
      upcomingDepartures: 1,
      publishBlockers: ["activityType"],
      sellable: true,
      review: { state: "applied" },
    },
    {
      id: "exp_night",
      slug: "night-fishing",
      title: "Night fishing",
      category: "local_life",
      destination: "andaman/havelock",
      status: "changes_rejected",
      publicationState: "draft",
      unitPricePaise: 340000,
      sellable: true,
      upcomingDepartures: 0,
      /*
        A FIRST listing sent back — yuvoy-api#180.

        This fixture already was one: `changes_rejected` over a listing that
        has never been published. It carried only `review.rejectionCode`, which
        the contract now reserves for a rejected EDIT to something already
        live, so the portal had no way to say the thing that matters most about
        this state — that it is a draft again and will not sell until it comes
        back.

        Both are set, because that is what the API sends: `status` reads
        `changes_rejected` while it is sent back, and `review` still records
        the decision. The portal shows one panel, not two.
      */
      sentBack: {
        rejectionCode: "meeting_point_unclear",
        rejectionNote: "Which jetty gate? A traveller cannot find this.",
        at: new Date().toISOString(),
      },
      review: {
        state: "rejected",
        since: new Date().toISOString(),
        rejectionCode: "meeting_point_unclear",
        rejectionNote: "Which jetty gate? A traveller cannot find this.",
      },
    },
  ];
}

/**
 * The mandatory fields a draft is still without.
 *
 * Computed, never stored, so a fixture cannot claim a listing is ready while
 * missing something the API would refuse — and so a save that fills a field
 * clears the mark the builder draws from it.
 *
 * `pricingUnit` is the subtle one: the column is NOT NULL, so its value cannot
 * say whether anybody chose it. The mock models the same thing with an explicit
 * `pricingUnitStated` flag set only by a write that named it.
 */
function draftBlockers(listing: MockExperience): string[] {
  const missing: string[] = [];
  if (!listing.title) missing.push("title");
  if (!listing.category) missing.push("category");
  if (!listing.summary) missing.push("summary");
  if (!listing.activityType) missing.push("activityType");
  if (!listing.destination) missing.push("destination");
  if (
    typeof listing.unitPricePaise !== "number" ||
    listing.unitPricePaise <= 0
  ) {
    missing.push("unitPricePaise");
  }
  if (!listing.pricingUnitStated) missing.push("pricingUnit");
  if (!listing.meetingPoint) missing.push("meetingPoint");
  if (!listing.durationMinutes) missing.push("durationMinutes");
  if (!listing.maxPartySize) missing.push("maxPartySize");
  return missing;
}

/**
 * The questions per listing, empty until somebody saves some.
 *
 * Seeded on `exp_boat` so the builder's Questions step has a list to edit
 * rather than only an empty one: keeping an existing question's id across a
 * save is the behaviour that is easy to get wrong, and it cannot be exercised
 * against a listing that has never had one.
 */
const listingQuestions: Record<string, MockQuestion[]> = {
  exp_boat: [
    {
      id: "q_seed_swim",
      text: "Can everyone in your party swim?",
      answerType: "yes_no",
      options: [],
      required: true,
    },
  ],
};

/*
  The seeded listings state their basis unless their own `publishBlockers` say
  they do not. Written once here rather than on twenty fixtures, so the two can
  never disagree: a fixture claiming a blocker it does not have is a fixture that
  tests nothing.
*/
function seedWithBasis(): MockExperience[] {
  return seedExperiences().map((e) => ({
    ...e,
    pricingUnitStated: !(e.publishBlockers ?? []).includes("pricingUnit"),
  }));
}

let mockExperiences: MockExperience[] = seedWithBasis();

function seedMediaAssets(): Record<string, MockMediaAsset> {
  return {
    med_approved_fixture: {
      attested: true,
      kind: "video",
      state: "approved",
      durationSeconds: 24,
    },
    /*
      A clip still PROCESSING, with no duration and no poster.

      The single most important row in this fixture. It is the exact shape that
      would be mislabelled by the one inference available before yuvoy-api#119
      — "no `durationSeconds` means a photograph" — so it is what stops that
      inference being reintroduced: replace `kind` with the guess and this row
      renders as a photograph, in the list an operator checks right after
      posting a reel.
    */
    med_processing_fixture: {
      attested: false,
      kind: "video",
      state: "processing",
    },
    /*
      A photograph, and one that is NOT published.

      For an image the picture is the item, so the API builds a URL at read
      time in every state — which the old poster gate (`state === "published"`)
      would have hidden. An operator waiting on review has to be able to see
      which photograph they are waiting on.
    */
    med_photo_fixture: {
      attested: true,
      kind: "image",
      state: "in_moderation",
      posterUrl: FIXTURE_POSTER,
    },
    med_waiting_fixture: {
      attested: true,
      kind: "video",
      state: "attested",
      durationSeconds: 18,
    },
    /*
      An approved clip attached to NOTHING, and nothing in the suite attaches
      it.

      `listing` absent is "exactly where a reel sits between finishing upload
      and appearing anywhere", and it is the loudest thing the Reels screen can
      say — approved work no traveller can see. The attach test consumes
      `med_approved_fixture` on the mobile project, and the two projects share
      one Next server, so a check reading that state needs a clip of its own or
      it passes alone and fails in a full run.
    */
    med_unattached_fixture: {
      attested: true,
      kind: "video",
      state: "approved",
      durationSeconds: 31,
    },
    /*
      A clip that is live on a listing, for the takedown walkthrough.

      Deliberately attached to `exp_night`, which is `changes_rejected` and
      therefore not selling — so it does not change which listings the
      Activities screen reports as "on sale with no video", and the two checks
      cannot take each other down.

      Its state is `published` rather than `approved`, which is also the more
      interesting half of the copy: taking down an attached clip empties the
      card a traveller is looking at, and the form has to say so.
    */
    med_published_fixture: {
      attested: true,
      kind: "video",
      state: "published",
      durationSeconds: 27,
      // Published, so the provider has produced a still and it is public.
      posterUrl: FIXTURE_POSTER,
      listing: {
        experienceId: "exp_night",
        title: "Night fishing",
        state: "draft",
      },
    },
    /*
      THE COVER, and a gallery item beside it on the same listing —
      yuvoy-operator#67, once `listing.role` existed.

      Two of them on one listing, because the interesting assertions need both:
      a hero that says it is the cover and offers only the demotion, a gallery
      item that offers only the promotion, and a `hero_taken` reachable by
      promoting the second while the first is still the cover.
    */
    med_cover_fixture: {
      attested: true,
      kind: "video",
      state: "published",
      durationSeconds: 29,
      posterUrl: FIXTURE_POSTER,
      listing: {
        experienceId: "exp_cover",
        title: "Coral wall (cover fixture)",
        state: "published",
        role: "hero",
      },
    },
    med_gallery_fixture: {
      attested: true,
      kind: "video",
      state: "published",
      durationSeconds: 19,
      posterUrl: FIXTURE_POSTER,
      listing: {
        experienceId: "exp_cover",
        title: "Coral wall (cover fixture)",
        state: "published",
        role: "gallery",
      },
    },
    /*
      A clip a reviewer refused, for the "why it was declined" half of the reel
      sheet (#58 item 6). It carries `rejection`, which is the only reason the
      sheet has anything to say: "a clip that disappears into rejected with no
      reason is a support conversation."
    */
    med_declined_fixture: {
      attested: true,
      kind: "video",
      state: "rejected",
      durationSeconds: 22,
      rejection: {
        code: "NOT_THIS_EXPERIENCE",
        note: "This looks like a different beach.",
      },
    },
    /*
      A clip already taken down. The one state that offers NOTHING — not even
      a takedown — so it is what proves the sheet withholds a control rather
      than offering one the API would refuse.
    */
    med_withdrawn_fixture: {
      attested: true,
      kind: "video",
      state: "withdrawn",
      durationSeconds: 15,
    },
  };
}

/**
 * The whole answer in one word, computed here because the API computes it.
 *
 * "`state` and `listing.state` are both still here and both still true, and
 * since media can be approved, attached to a listing, and invisible all at once,
 * deriving the situation from two enumerations client side gets it wrong in ways
 * nobody notices for a month."
 *
 * A mock that omitted it left every tile in the portal badgeless and every reel
 * sheet offering only the one action an unknown situation earns, which is the
 * worst kind of green suite: the screens rendered, and none of them rendered
 * what production sends.
 */
function situationOf(asset: MockMediaAsset): string {
  switch (asset.state) {
    case "uploaded":
    case "processing":
      return "processing";
    case "ready":
      return "needs_rights";
    case "attested":
    case "in_moderation":
      return "in_review";
    case "rejected":
    case "quarantined":
      return "changes_needed";
    case "withdrawn":
      return "withdrawn";
    case "failed":
      return "failed";
    case "approved":
      // Approved and on nothing at all. Only media that predates the listing
      // being chosen at upload time can be here.
      return asset.listing ? "waiting_on_listing" : "not_attached";
    case "published":
      return asset.listing?.state === "published"
        ? "live"
        : asset.listing?.state === "withdrawn"
          ? "listing_withdrawn"
          : "waiting_on_listing";
    default:
      return "processing";
  }
}

function seedProfile(): MockProfile {
  return {
    displayName: BUSINESS_NAME,
    legalName: "Nemo Reef Watersports",
    entityType: "sole_proprietor",
    address: { line1: "Beach 3", locality: "Havelock", country: "IN" },
  };
}

let profile: MockProfile = seedProfile();

/** The logo in use, or null for none. */
let logo: { imageId: string; uploadedAt: string } | null = null;

/** A logo the browser can draw without a network: a data URL, like the story's. */
function mockLogoUrl(imageId: string): string {
  const hue = [...imageId].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><circle cx="80" cy="80" r="80" fill="hsl(${hue} 40% 30%)"/><circle cx="80" cy="80" r="28" fill="#be7149"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Credentials filed this session, by type. See `POST /credentials`. */
let filedCredentials: Record<string, { state: string; expiresOn?: string }> =
  {};

let mediaAssets: Record<string, MockMediaAsset> = seedMediaAssets();
/** Photograph slots minted this session, by image id → owning operator. */
let photoIntents: Record<string, { operatorId: string }> = {};
/** Intent id → the image it minted. The listing travels on the intent. */
let photoIntentsById: Record<string, { imageId: string }> = {};
/**
 * Departures created in this session, by `POST /slots`.
 *
 * Kept beside the fixtures rather than pushed into them: `SLOTS` is a `const`
 * every other handler reads, and a test that added to it would leak into the
 * next one through a module nothing resets.
 */
let createdSlots: MockSlot[] = [];
/**
 * Departures moved this session, by id — yuvoy-operator#56 item 9.
 *
 * Kept beside the fixtures rather than written into them: `SLOTS` is a `const`
 * every other handler reads, and a test that moved one would leak into the next
 * through a module nothing resets.
 */
let movedTimes: Record<string, string> = {};
/**
 * Cash recorded as taken this session, by booking id — yuvoy-operator#40 §1.
 *
 * The fixture's own `collected` rows stay read-only; this is what a tap adds.
 * The FIRST report is kept and never replaced, exactly as the API keeps it: a
 * collection reported once is a fact.
 */
let cashTaken: Record<string, { collectedPaise: number; collectedAt: string }> =
  {};

/*
  The business's own story — yuvoy-operator#41.

  Seeded so every part of the screen has something to draw: words somebody
  wrote, two languages, two photographs, and both reviewed facts. The reviewed
  pair is a constant rather than state, because `PUT /story` has no parameter
  for either — a mock that let one change would let the screen offer to.
*/
function seedStory(): MockStory {
  return {
    about:
      "A small dive centre on Beach No. 3. Two instructors, one boat, and groups of four at most.",
    languages: ["English", "Hindi"],
    photos: [
      { id: "sph_boat", imageId: "img_story_boat", position: 1 },
      { id: "sph_crew", imageId: "img_story_crew", position: 2 },
    ],
  };
}

let story: MockStory = seedStory();

const STORY_REVIEWED = {
  operatingSince: 2014,
  findThemAt: "Beach No. 3, Havelock (Swaraj Dweep)",
  why: "These two are read as things we checked, so they change through us rather than in place.",
};

/**
 * A placeholder photograph of the operation: a `data:` URI, so the portal's
 * CSP (`img-src 'self' data: …`) draws it with no network, and there is no
 * picture of anybody's boat to license. Brand tokens only.
 */
function storyPhotoUrl(position: number): string {
  const waterline = 120 + position * 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#16362e"/><rect y="${waterline}" width="480" height="${360 - waterline}" fill="#0a100e"/><rect x="${200 + position * 20}" y="140" width="10" height="10" fill="#be7149"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function storyPhotoJson(photo: MockStoryPhoto) {
  return {
    id: photo.id,
    position: photo.position,
    url: storyPhotoUrl(photo.position),
  };
}

/** `GET /story`, as the API writes it. */
function storyResponse() {
  return {
    about: story.about,
    languages: story.languages,
    photos: story.photos.map(storyPhotoJson),
    reviewed: STORY_REVIEWED,
    /*
      The three numbers at the top of the business profile (yuvoy-api#185):
      "always present, zeroes included". This mock never sent them, so the
      profile's row of numbers had never once been drawn against it, and the
      finding it carried ("the header says 3 listings; the grid below shows
      six", op#86 s9) could not be seen here at all.

      `listings` is counted the way the API counts it: what a traveller can
      buy now, live or live with changes in review. `tripsRun` is a constant,
      because this mock keeps no record of departures that ran. No review has
      been published, which is what a count of 0 and a null average say.
    */
    stats: {
      listings: mockExperiences.filter(
        (e) => e.status === "live" || e.status === "live_changes_in_review",
      ).length,
      tripsRun: 128,
      rating: { average: null, count: 0 },
    },
  };
}

/*
  Dates closed to new bookings this session — yuvoy-operator#45.

  Read back, as the API reads them back: `POST /blackouts` sets every open
  departure on those market days (of one listing, or of all of them) to
  `closed`, and `GET /slots` then answers with that status and the reason it
  is not on sale. Before this a closure changed nothing the calendar could
  show, so no test could see a day turn Closed.
*/
let blackouts: MockClosure[] = [];

/** The market day a departure leaves on, in its OWN zone. */
function slotDay(slot: MockSlot): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: slot.timezone }).format(
    new Date(slot.startsAt),
  );
}

/** An RFC 3339 date-time, offset required: what the API's parser takes. */
const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** The instant a departure's market day begins, in its own zone. */
function slotDayStart(slot: MockSlot): number {
  const day = slotDay(slot);
  // The zone's offset that day, read off the clock rather than assumed.
  const noon = Date.parse(`${day}T12:00:00Z`);
  const wall = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: slot.timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(noon)
      .map((part) => [part.type, Number(part.value)]),
  );
  const offset =
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) -
    noon;
  return Date.parse(`${day}T00:00:00Z`) - offset;
}

/**
 * A FIRST arrival's time, by the API's rules for `seenAt` (yuvoy-api#292):
 * believed when no more than 12 hours back and not before the departure's
 * own day; a time ahead of the clock is now; one too early is ignored, not
 * refused, so the check-in is recorded at the time it arrived.
 */
function arrivalTime(slot: MockSlot, seenAt: number | undefined): string {
  const now = Date.now();
  if (seenAt === undefined) return new Date(now).toISOString();
  if (seenAt > now) return new Date(now).toISOString();
  const tooEarly =
    seenAt < now - 12 * 60 * 60 * 1000 || seenAt < slotDayStart(slot);
  return new Date(tooEarly ? now : seenAt).toISOString();
}

/** Every departure this operator has, fixtures and ones a test added. */
/**
 * Every departure there is, fixture or made this session. Every route that
 * acts on one departure reads this, as the API reads one table: six read the
 * fixtures alone, so a departure a test had just made answered 404 to its
 * seats, its manifest, a message, a call-off and a counter sale.
 */
function allSlots(): MockSlot[] {
  return [...SLOTS, ...createdSlots];
}

/**
 * Whether any closure STILL IN FORCE holds this departure.
 *
 * "A departure stays closed while any closure still in force holds it" — so a
 * departure closed twice and reopened once is still closed, which is the whole
 * reason `departuresStillClosed` exists on the reopen answer.
 */
function closedByAny(slot: MockSlot): boolean {
  const day = slotDay(slot);
  return blackouts.some((b) => {
    if (b.reopenedAt) return false;
    if (b.departureId) return b.departureId === slot.id;
    if (b.experienceId && b.experienceId !== slot.experienceId) return false;
    return day >= b.from && day <= b.to;
  });
}

/**
 * `bookableDatesNext30Days` as the API counts it (yuvoy-api#205), near enough
 * for the screens that read it: market days from today through the 29 after it
 * with at least one departure that is open and still to come, on a listing
 * that is on the traveller app. 0 for anything else, as the API answers a
 * draft or a listing that is not selling. Full departures are not subtracted:
 * no screen in this portal is tested against one.
 */
function bookableDatesOf(e: { id?: string; status?: string }): number {
  if (e.status !== "live" && e.status !== "live_changes_in_review") return 0;
  const dayOf = (at: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
      new Date(at),
    );
  const first = dayOf(Date.now());
  const last = dayOf(Date.now() + 29 * 86_400_000);
  const days = new Set<string>();
  for (const slot of allSlots()) {
    if (slot.experienceId !== e.id) continue;
    if (slotStatusOf(slot) !== "open") continue;
    if (seatsAwaitingConfirmation(slot)) continue;
    const at = Date.parse(slot.startsAt);
    if (Number.isNaN(at) || at <= Date.now()) continue;
    const day = dayOf(at);
    if (day >= first && day <= last) days.add(day);
  }
  return days.size;
}

/**
 * `departuresNotOnSale` for a listing: its departures still to come that are
 * off sale only because nobody confirmed their seats. Always present, 0 when
 * none. Going off sale within a day is not modelled, so that count is 0.
 */
function unconfirmedDeparturesOf(e: { id?: string }): number {
  return allSlots().filter(
    (slot) =>
      slot.experienceId === e.id &&
      slotStatusOf(slot) === "open" &&
      Date.parse(slot.startsAt) > Date.now() &&
      seatsAwaitingConfirmation(slot),
  ).length;
}

/** A departure's status as the API would answer it now. */
function slotStatusOf(slot: MockSlot): string {
  if (calledOff[slot.id]) return "cancelled";
  if (slot.status !== "open") return slot.status;
  return closedByAny(slot) ? "closed" : "open";
}

/**
 * Whether a departure is on sale, and the API's sentence when it is not — the
 * part of `OperatorSaleBlock` (yuvoy-api `catalog/operator_sale.go`) the
 * fixtures can reach, in its order and with its words.
 *
 * ## The one wrong sentence is FIXED, on both sides
 *
 * A called-off departure used to be `departure_closed` here too, carrying
 * "anybody already booked on it is unaffected" — the opposite of what a
 * call-off does — and the portal wrote its own sentence over it. The contract
 * now has `departure_called_off`, "split from departure_closed, which leaves
 * every booking in place", so the mock sends that and the portal renders it
 * (yuvoy-operator#45 item 5).
 *
 * `cancelled` is checked BEFORE `closed`, because a departure can be both: one
 * that was closed and then called off is called off, and the heavier fact is
 * the one somebody needs.
 */
/**
 * A departure's seat numbers the way `GET /slots` computes them (yuvoy-api
 * `ListSlots` at 2afd7b4): counter sales come OFF `seats`, floored at zero,
 * `sold` is what Yuvoy sold, and `soldOffline` is every counter sale, the
 * fixture's own and this session's, the same number the manifest reports.
 *
 * It added counter sales to `sold` before, which no API sends: a six-seat boat
 * with two walk-ups read "2 of 6 sold" here and "0 of 4 sold" in production.
 * A fixture's `seats` is already net of its own `seatsSoldOffline`.
 */
function departureSeats(slot: MockSlot): {
  seats: number;
  sold: number;
  remaining: number;
  soldOffline: number;
} {
  const session = offlineSold[slot.id] ?? 0;
  const seats = Math.max(0, (capacity[slot.id] ?? slot.seats) - session);
  return {
    seats,
    sold: slot.sold,
    remaining: Math.max(0, seats - slot.sold),
    soldOffline: (slot.seatsSoldOffline ?? 0) + session,
  };
}

function saleVerdictOf(
  slot: MockSlot,
  seats: number,
  sold: number,
): { onSale: boolean; notOnSaleReason?: string; notOnSaleDetail?: string } {
  const notOnSale = (reason: string, detail: string) => ({
    onSale: false,
    notOnSaleReason: reason,
    notOnSaleDetail: detail,
  });
  /*
    The listing's own state first, as the API ranks them (yuvoy-api
    `catalog.OperatorSaleBlock`: a kill switch, then the listing, then the
    departure), with the API's own sentences. Without it every draft's
    departure read as on sale here, and a screen that keeps drafts off Home
    was green against an answer production never gives.
  */
  const owner = mockExperiences.find((e) => e.id === slot.experienceId);
  switch (owner?.publicationState) {
    case "draft":
      return notOnSale(
        "listing_draft",
        "This listing is still a draft. Send it to us and we will check it.",
      );
    case "in_review":
      return notOnSale(
        "listing_in_review",
        "We are checking this listing. These departures go on sale when it is approved.",
      );
    case "withdrawn":
      return notOnSale(
        "listing_withdrawn",
        "This listing is off sale. Send it to us again to put it back.",
      );
  }
  const status = slotStatusOf(slot);
  if (status === "cancelled") {
    return notOnSale(
      "departure_called_off",
      "This departure was called off. Everybody who paid online has been refunded; anything paid in cash is with the operator.",
    );
  }
  if (status !== "open") {
    return notOnSale(
      "departure_closed",
      "This departure is closed to new bookings. Anybody already booked on it is unaffected.",
    );
  }
  if (Date.parse(slot.startsAt) <= Date.now()) {
    return notOnSale(
      "departure_past_cutoff",
      "Bookings for this departure have closed.",
    );
  }
  if (seatsAwaitingConfirmation(slot)) {
    return notOnSale(
      "departure_seats_unconfirmed",
      "Nobody has confirmed the seats on this departure for two days, so it is not on sale. Confirm them to put it back.",
    );
  }
  if (slot.bookingMode === "allotment" && seats - sold <= 0) {
    return notOnSale("departure_full", "Every seat on this departure is sold.");
  }
  return { onSale: true };
}

/**
 * What the API refuses to store, and the mock has to refuse too.
 *
 * "A message with a phone number, an email address or a link in it is refused
 * `400 invalid_input` … The rule is the traveller's too, and it is D-018 kept
 * in the conversation: you do not see a traveller's number, and neither side
 * can type one."
 *
 * Modelled rather than waved through, because this is the one branch of the
 * composer somebody will actually hit and the portal does NO filtering of its
 * own: the issue says so in `Do not build`. A permissive mock would let the
 * portal ship with the refusal never once rendered, which is exactly how this
 * repo ended up with a `requireOperator()` that threw to an error boundary
 * that did not exist.
 *
 * The server's D-051 rules exactly, as `internal/contactdetail` writes them at
 * the pinned contract. Since yuvoy-api#282 item 5 the same rules screen a
 * listing's questions and a traveller's answers, and three kinds of digits
 * are set aside before a phone number is counted: a date (14.09.2026 or
 * 2026-09-14, which an operator saying when to turn up must be able to
 * write), a span of clock times with no colon (0830-0930) and a code that
 * runs from letters into digits (Z1234567). A bare run of ten digits is
 * still a number.
 */
function contactDetailIn(text: string): "phone" | "email" | "link" | null {
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) {
    return "email";
  }
  if (
    /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|net|org|io|co|me)\b)/i.test(text)
  ) {
    return "link";
  }
  const digits = text
    .replace(
      /\b(?:(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|[12]\d|3[01])[./-](?:\d{4}|\d{2})|\d{4}[./-](?:0?[1-9]|1[0-2])[./-](?:0?[1-9]|[12]\d|3[01]))\b/g,
      "_",
    )
    .replace(
      /\b(?:[01]\d|2[0-3])[0-5]\d\s*-\s*(?:[01]\d|2[0-3])[0-5]\d\b/g,
      "_",
    )
    .replace(/\b[A-Za-z]+\d[A-Za-z0-9]*\b/g, "_");
  return /(?:\d[\s\-().]*){7,}/.test(digits) ? "phone" : null;
}

/** What the API calls each kind, in a refusal that never repeats the text. */
function contactKindWords(kind: "phone" | "email" | "link"): string {
  return kind === "email"
    ? "an email address"
    : kind === "link"
      ? "a link"
      : "a phone number, from seven or more digits written close together";
}

/**
 * A question's or a choice's refusal for holding a contact detail
 * (yuvoy-api#282 item 5), in the API's words, or "" when it holds none.
 * `what` is "a question" or "an option".
 */
function contactRefusal(text: string, what: string): string {
  const kind = contactDetailIn(text);
  return kind
    ? `${what} cannot include a phone number, an email address or a link, and this one looks like it has ${contactKindWords(kind)}. Write it another way`
    : "";
}

/**
 * A choice question's options as the API reads them
 * (`normaliseChoiceOptions`): trimmed, and the first thing wrong with them.
 */
function choiceOptionsOf(raw: string[]): [string[], string] {
  if (raw.length < 2 || raw.length > 10) {
    return [[], "give between 2 and 10 options"];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const option of raw) {
    const trimmed = option.trim();
    const length = [...trimmed].length;
    if (length === 0) return [[], "an option cannot be empty"];
    if (length > 60) return [[], "keep each option to 60 characters"];
    if (seen.has(trimmed.toLowerCase())) {
      return [[], "each option must be different"];
    }
    const why = contactRefusal(trimmed, "an option");
    if (why) return [[], why];
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  }
  return [out, ""];
}

/** An Idempotency-Key the API takes: 16-128 of `A-Za-z0-9_.:-`. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{16,128}$/;

/** The thread for a booking, or `null` for one that has never been written in. */
function threadFor(id: string): MockThread | null {
  return threads.find((t) => t.bookingId === id) ?? null;
}

/**
 * The booking behind a thread, so the conversations list can carry a
 * reference, an experience and a departure. A thread whose booking has gone is
 * dropped rather than rendered with blanks.
 */
function bookingOf(id: string) {
  for (const slot of SLOTS) {
    const party = slot.parties.find((p) => p.bookingId === id);
    if (party) {
      return {
        reference: party.reference,
        experience: slot.title,
        slotId: slot.id,
        slot: { startsAt: slot.startsAt, timezone: slot.timezone },
      };
    }
  }
  return null;
}

/**
 * The conversations `GET /message-threads` lists, with what each has unread:
 * one walk the list, the inbox counts on `GET /me` and the manifest's
 * per-party counts all read, so the three cannot disagree, as they cannot on
 * the API (yuvoy-api#260, #282 item 6).
 */
function threadRows() {
  return threads
    .map((t) => {
      const booking = bookingOf(t.bookingId);
      const last = t.messages.at(-1);
      if (!booking || !last) return null;
      return {
        bookingId: t.bookingId,
        reference: booking.reference,
        experience: booking.experience,
        slotId: booking.slotId,
        slot: booking.slot,
        lastMessageAt: last.sentAt,
        lastFrom: last.from,
        unreadCount: t.unread,
      };
    })
    .filter((r) => r !== null);
}

/** One booking's unread, as its conversation row says it; `0` with none. */
function unreadOf(bookingId: string): number {
  return threadRows().find((r) => r.bookingId === bookingId)?.unreadCount ?? 0;
}

/** `unreadCount` and `unreadConversations` on `GET /me`: the rows, added up. */
function unreadTotals(request: Request): {
  unreadCount: number;
  unreadConversations: number;
} {
  const rows = isNewBusiness(request) ? [] : threadRows();
  const unread = rows.filter((r) => r.unreadCount > 0);
  return {
    unreadCount: unread.reduce((n, r) => n + r.unreadCount, 0),
    unreadConversations: unread.length,
  };
}

/**
 * One credential by its id, across every account fixture.
 *
 * Needed because the intent endpoint refuses a document that is not pending,
 * and "pending" is a fact about the fixture rather than about the intent.
 */
function credentialOf(
  id: string,
): { id?: string; type?: string; state?: string } | undefined {
  for (const account of [
    ACCOUNT_LIVE,
    ACCOUNT_LIVE_OUTSTANDING,
    ACCOUNT_SUSPENDED,
    ACCOUNT_PROSPECT,
    ACCOUNT_AWAITING,
  ]) {
    const hit = (
      account.credentials as { id?: string; type?: string; state?: string }[]
    ).find((c) => c.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * An account block with this session's uploaded files overlaid.
 *
 * The fixtures are `const` and every handler reads them, so a file recorded by
 * an upload is kept beside them and merged on the way out — the same call
 * `createdSlots` and `cashTaken` make. Without this the row would still say "no
 * file sent" after a successful upload, and the walkthrough would be proving
 * the message rendered and nothing about the screen.
 */
function accountWithFiles<T extends { credentials: readonly unknown[] }>(
  account: T,
): T {
  const anyFiles = Object.keys(documentFiles).length > 0;
  if (!anyFiles) return account;
  return {
    ...account,
    credentials: (account.credentials as { id?: string }[]).map((c) => {
      const file = c.id ? documentFiles[c.id] : undefined;
      return file
        ? {
            ...c,
            hasFile: true,
            filename: file.filename,
            sizeBytes: file.sizeBytes,
          }
        : c;
    }),
  };
}

/**
 * The six switches, as the API declares them: yuvoy-operator#46 item 5, and
 * `seat_confirmations` since yuvoy-api e7291e3 (yuvoy-operator#94 item 3).
 *
 * `label` and `description` are the API's words, and the descriptions say who
 * each kind of message goes to. That is load-bearing rather than decorative:
 * "every person sees every switch, so this is how a staff member can tell that
 * a payout summary was never going to reach them."
 */
const SWITCHES = [
  {
    group: "new_bookings",
    label: "New bookings",
    description:
      "A booking, a seat request that needs an answer, and a message a traveller writes about their trip. Everybody at the business.",
  },
  {
    group: "guest_cancellations",
    label: "Guest cancellations",
    description:
      "A traveller cancelled a booking they made. Everybody at the business.",
  },
  {
    group: "todays_departures",
    label: "Today's departures",
    description: "The 06:00 summary of the day's booked departures.",
  },
  /*
    The API's own label, description and place (after the day's work, before
    money), from `noticeGroupWording` at e7291e3. On by default like every
    switch: nobody has turned it off.
  */
  {
    group: "seat_confirmations",
    label: "Seats to confirm",
    description:
      "Once a day, the departures that are off sale, or will be within a day, because nobody has confirmed their seats. Sent to the owner, admins and managers.",
  },
  {
    group: "settlement_summary",
    label: "Payout sent",
    description:
      "A payout has been sent to the business's bank. Owners, admins and managers only, so a staff login never receives one.",
  },
  {
    group: "document_expiry",
    label: "Documents running out",
    description:
      "A document we require of the business expires within 30 days. The owner and any admin.",
  },
] as const;

const ALWAYS_SENT =
  "Some messages have no switch: a booking being cancelled by us, a bank change being raised or stopped, and anything about your account being suspended. Those reach the owner whatever is set here.";

/** One person's switches, with anything changed overlaid. */
function switchesFor(user: MockTeamMember) {
  const changes = switchState[user.id] ?? {};
  return {
    userId: user.id,
    name: user.name,
    switches: SWITCHES.map((s) => {
      const change = changes[s.group];
      return {
        ...s,
        // Absent is ON: "every switch is on until somebody turns it off".
        on: change ? change.on : true,
        ...(change ? { changedAt: change.at, changedBy: change.by } : {}),
      };
    }),
    alwaysSent: ALWAYS_SENT,
  };
}

/**
 * Apply a change, or answer the `400` the contract describes.
 *
 * "No switch named, one named twice, one without `on`, or a name that is not a
 * switch. The message lists the switches that exist." Every one of those is
 * modelled: a mock that took anything would let the portal ship a body the API
 * refuses, and the operator would meet a refusal nobody could read.
 */
function applySwitches(
  actor: MockTeamMember,
  target: MockTeamMember,
  changes: { group?: string; on?: unknown }[] | undefined,
) {
  const names = SWITCHES.map((s) => s.group);
  const listed = `The switches are ${names.join(", ")}.`;

  if (!Array.isArray(changes) || changes.length === 0) {
    return envelope("invalid_input", `Name a switch. ${listed}`, 400);
  }
  const seen = new Set<string>();
  for (const change of changes) {
    const group = String(change.group ?? "");
    if (!names.includes(group as (typeof names)[number])) {
      return envelope("invalid_input", `No such switch. ${listed}`, 400);
    }
    if (seen.has(group)) {
      return envelope("invalid_input", `${group} is named twice.`, 400);
    }
    seen.add(group);
    if (typeof change.on !== "boolean") {
      /*
        "A switch sent without it is refused rather than read as off." Read as
        off, a body with a typo in the field name would silence somebody.
      */
      return envelope(
        "invalid_input",
        `${group} needs on: true or false.`,
        400,
      );
    }
  }

  const at = new Date().toISOString();
  switchState[target.id] = switchState[target.id] ?? {};
  for (const change of changes) {
    switchState[target.id][String(change.group)] = {
      on: change.on as boolean,
      at,
      // Who did it, which is the whole of item 6: an owner turning somebody
      // else's switch off shows up by name on that person's own screen.
      by: { id: actor.id, name: actor.name },
    };
  }
  return null;
}

/** Reset between tests so one case cannot make the next pass. */
/**
 * The account block `GET /me` sends for this identity, or `undefined` for none.
 *
 * `account` is per-BUSINESS, not per-user, so it is keyed off the identity
 * that stands in for one here. The upload-drop and API-failure identities
 * deliberately get NO account block: absent is a real response shape and the
 * contract says what it means ("unknown, never everything is fine"), so the
 * screen that must not read it as approval has something to be tested
 * against.
 *
 * One function rather than a branch inside `GET /me`, because the logo and
 * business-details writes ask the same question (is this business LIVE?) and
 * two copies of the answer would drift.
 */
function accountFor(me: { id: string }) {
  if (me.id === SUSPENDED_ID) return ACCOUNT_SUSPENDED;
  if (me.id === PROSPECT_ID || signups.some((sme) => sme.id === me.id)) {
    /*
      A brand-new account is PROSPECT and cannot be booked: that is the whole
      safety property of self-signup, and a mock that handed one ACCOUNT_LIVE
      would let this portal ship the congratulation the API never earns.
    */
    return ACCOUNT_PROSPECT;
  }
  if (me.id === AWAITING_ID) return ACCOUNT_AWAITING;
  // A business with nothing yet, two documents to send (yuvoy-operator#96).
  if (me.id === NEW_BUSINESS_ID) return ACCOUNT_PROSPECT;
  if (me.id === LIVE_OUTSTANDING_ID) {
    /*
      Live, selling, and still owing us the logo and the registered address
      (yuvoy-operator#38). Checked BEFORE the `OTHER_MEMBERS` fallthrough,
      which hands back no account block at all, because this identity exists
      to render a screen rather than to hide one.
    */
    return ACCOUNT_LIVE_OUTSTANDING;
  }
  // Live, and paid weekly: its payouts are held for another reason.
  if (me.id === BANK_UNCONFIRMED_ID) return ACCOUNT_LIVE;
  if (OTHER_MEMBERS.some((o) => o.id === me.id)) return undefined;
  return ACCOUNT_LIVE;
}

/**
 * Whether a logo or business-details write is RECORDED FOR REVIEW rather than
 * applied: the API asks `operators.status = 'LIVE'` (D-032.3) and answers
 * `202 { state: "in_review", next }` when it is.
 *
 * An identity with no account block is a colleague on the fixture business,
 * which is LIVE, so it is treated as live: the block is withheld to test a
 * screen, not because the business changed.
 */
function isLiveBusiness(me: { id: string }): boolean {
  return (accountFor(me)?.state ?? "LIVE") === "LIVE";
}

export function __resetOperatorMocks() {
  blackouts = [];
  attendance = {};
  messageKeys.clear();
  codeAttempts = {};
  answered = {};
  calledOff = {};
  capacity = {};
  offlineSold = {};
  offlineEntries = [];
  steppedUp = false;
  bankChanges = [];
  accountChanges = [];
  seatsConfirmed = {};
  stoppedChanges = [];
  team = TEAM.map((m) => ({ ...m }));
  signups = [];
  threads = seedThreads();
  documentIntents = {};
  documentFiles = {};
  switchState = {};
  cancelled = {};
  cashReturned = {};
  uploadIntents = {};
  mediaAssets = seedMediaAssets();
  profile = seedProfile();
  logo = null;
  filedCredentials = {};
  mockExperiences = seedWithBasis();
  createdSlots = [];
  movedTimes = {};
  cashTaken = {};
  story = seedStory();
  resetMockUploads();
  resetMockPhotos();
  resetMockDocuments();
  photoIntents = {};
  photoIntentsById = {};
  resetClaimMocks();
}

/**
 * The profile as the API returns it, with `missing` derived on every read.
 *
 * Derived rather than stored for the reason the contract gives about account
 * standing: "a stored status is a second copy of the truth that goes stale."
 * The names are the PUT's field names, so a form can mark the exact rows.
 */
function profileResponse() {
  const missing: string[] = [];
  if (!profile.legalName) missing.push("legalName");
  if (!profile.entityType) missing.push("entityType");
  if (!profile.address.line1) missing.push("addressLine1");
  if (!profile.address.locality) missing.push("locality");
  if (!profile.address.region) missing.push("region");
  if (!profile.address.postalCode) missing.push("postalCode");
  /*
    `editable` is sent as `true` for everybody, as the API has since D-032.3
    (`operator_business_details.go`): a LIVE account's write is queued for
    review rather than refused. The contract's description of `editable`
    still says the old lock, at 2afd7b4 (asked again on yuvoy-api#222).
  */
  return { ...profile, editable: true, missing };
}

/**
 * sha256 of a string, as lowercase hex.
 *
 * Computed rather than hardcoded, so the statement fixture cannot drift out of
 * agreement with its own header and make the portal's integrity check look
 * broken when the CSV is edited (yuvoy-operator#47 item 7).
 *
 * `crypto.subtle` rather than `node:crypto`: these handlers run in the browser
 * worker as well as in Node, and importing a Node builtin here would pull
 * `node:crypto` into the client graph, which is the failure `pnpm qa`'s
 * client-import walk exists to catch.
 */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * A listing as the API reads it back since yuvoy-api#249: `meetingLat` and
 * `meetingLng` always present, `null` when there is no pin. The portal offers
 * a pin only to an API that sends the key, so a mock that left it out would
 * hide the pin from every test.
 */
function withPin<
  T extends { meetingLat?: number | null; meetingLng?: number | null },
>(listing: T): T & { meetingLat: number | null; meetingLng: number | null } {
  return {
    ...listing,
    meetingLat: listing.meetingLat ?? null,
    meetingLng: listing.meetingLng ?? null,
  };
}

/**
 * A pin the API would refuse, in its words (`coerceListingValue` and
 * `RevisionPayloadError` at fb9245e): each coordinate on its own, a number or
 * null, inside its range. "we could not read: meetingLat", with the reason
 * keyed by field in `details`. The API does not check both-or-neither; the
 * portal does, before it sends.
 */
function pinRefusal(body: Record<string, unknown>) {
  const bounds = { meetingLat: 90, meetingLng: 180 } as const;
  const invalid: Record<string, string> = {};
  for (const [field, limit] of Object.entries(bounds)) {
    if (!(field in body) || body[field] === null) continue;
    const value = body[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      invalid[field] = "this should be a number";
    } else if (value < -limit) {
      invalid[field] = `must be ${-limit} or more`;
    } else if (value > limit) {
      invalid[field] = `must be ${limit} or less`;
    }
  }
  const names = Object.keys(invalid).sort();
  if (names.length === 0) return null;
  return envelope(
    "invalid_input",
    `we could not read: ${names.join(", ")}`,
    400,
    {
      allowed: LISTING_FIELDS,
      ...invalid,
    },
  );
}

/**
 * Every field a listing edit may carry, in the order the API declares them
 * (`listingFields` at fb9245e), which is the order `applied` and `inReview`
 * come back in.
 */
const LISTING_FIELDS = [
  "title",
  "summary",
  "description",
  "category",
  "activityType",
  "destination",
  "meetingPoint",
  "meetingLandmark",
  "meetingLat",
  "meetingLng",
  "inclusions",
  "requirements",
  "safetyNotes",
  "screenerKey",
  "durationMinutes",
  "maxPartySize",
  "unitPricePaise",
  "pricingUnit",
  "bookingMode",
];

/**
 * What the operator owns and changes without review once a listing has been
 * approved (D-032.3, `OperatorDirect` at fb9245e).
 */
const OPERATOR_DIRECT = new Set([
  "meetingPoint",
  "meetingLandmark",
  "meetingLat",
  "meetingLng",
  "durationMinutes",
  "maxPartySize",
  "unitPricePaise",
  "pricingUnit",
  "bookingMode",
]);

/** The fields marked *material* at fb9245e: a change to one needs review. */
const MATERIAL_FIELDS = new Set([
  "category",
  "activityType",
  "destination",
  "meetingPoint",
  "inclusions",
  "requirements",
  "safetyNotes",
  "screenerKey",
  "durationMinutes",
  "maxPartySize",
  "unitPricePaise",
  "pricingUnit",
  "bookingMode",
]);

function envelope(
  code: string,
  message: string,
  status: number,
  /*
    `details` is how a refusal names WHICH field it is about, and several
    screens branch on it: `unknownFields` and `screenerKey` on a draft save,
    `missing` on a submit, `questions[0].text` on a question list. A mock that
    could not carry it would let a client ship a details reader that has never
    once been given details.
  */
  details?: unknown,
) {
  return HttpResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status },
  );
}

/**
 * One upload slot, said the same way whether it is new or resumed.
 *
 * Factored out rather than duplicated because the two answers must be
 * indistinguishable to a client: the whole point of the resume is that a
 * reloaded page asks the same question and can act on the same answer.
 *
 * The URL is rebuilt from the upload id every time, which is the mock's way of
 * modelling the property that makes this safe in production — "derived, not
 * stored", so the server can always hand a working URL back without ever
 * having kept one.
 */
function uploadIntent(id: string, uploadId: string, sizeBytes: number) {
  return HttpResponse.json(
    {
      intentId: id,
      uploadUrl: `http://127.0.0.1:${MOCK_TUS_PORT}/uploads/${uploadId}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      maxBytes: 200 * 1024 * 1024,
      sizeBytes,
      maxSeconds: 60,
      protocol: "tus",
      /*
        1 MB here, 5 MB in production. The chunk size is the SERVER's to decide
        and the client's to honour — which is the property worth testing — so a
        smaller one exercises the same loop with a quarter of the bytes going
        over Playwright's wire. A client with its own idea of the chunk size is
        a client that breaks the day the provider changes.
      */
      chunkBytes: 1024 * 1024,
      aspectRatio: "9:16",
    },
    { status: 201 },
  );
}

/**
 * A write a suspended business may not make - yuvoy-operator#50.
 *
 * Called by the handlers for the writes that are NOT on the allowed list. The
 * list itself lives in `src/lib/account/standing.ts`; this is the other side
 * of it, and the two disagreeing is exactly the bug the portal would ship: a
 * button drawn for a write the API refuses, or a button withheld for one it
 * would have taken.
 *
 * The message is the API's own, and it is the SAME sentence `GET /me` carries
 * in `account.suspension.message`. The contract requires that: "every refused
 * write answers with [it] too, so a banner and a tapped button never
 * disagree."
 */
function requireWritable(request: Request) {
  const user = sessionUser(request);
  if (user?.id === SUSPENDED_ID) {
    return envelope(
      "account_suspended",
      ACCOUNT_SUSPENDED.suspension.message,
      403,
    );
  }
  return null;
}

/** Every authenticated route answers 401 the same way. */
function requireSession(request: Request) {
  const user = sessionUser(request);
  if (!user) {
    return envelope(
      "unauthorized",
      "No session, or one that is no longer valid.",
      401,
    );
  }
  /*
    A SUSPENDED BUSINESS IS NO LONGER REFUSED HERE - yuvoy-operator#50.

    It used to answer `403 account_not_active` on every endpoint including
    `/me`, which is what the API did then. The contract has since separated the
    two: "a suspended business is not refused here, and nor is one whose status
    is `OFFBOARDED` or `DISQUALIFIED`: each signs in, and its writes answer
    `account_suspended` instead."

    So this identity now signs in, reads everything, and meets
    `account_suspended` only on the writes it may not make. `requireWritable`
    below is what says which, and the reason the distinction matters is that a
    suspended operator still has departures to run that travellers have paid
    for: refusing them everywhere would strand those travellers.

    `account_not_active` is left for an OFFBOARDED account, which cannot hold a
    session at all and which no identity here stands in for.
  */
  /*
    Not an account state: the server having a bad minute. Kept distinct so the
    portal can be checked for the one confusion that matters — a dropped
    connection rendering as "your account has been suspended".
  */
  if (user.id === FAILING_ID) {
    return envelope("internal_error", "Something went wrong.", 500);
  }
  return null;
}

/**
 * The response shape: everything except the number — plus its last four.
 *
 * `phoneMasked` is derived here the way the API derives it in SQL, from the
 * number that is never returned, so the mock cannot hand the client a mask
 * that disagrees with the row. Four digits and never more: the API's own test
 * is that "a correct mask beside a field that leaks is the same failure as no
 * mask" (yuvoy-api#62), and this mock keeps that property.
 */
function publicMember(member: MockTeamMember) {
  // `inviteEmail` is dropped with the number: neither is in `TeamMember`.
  const { phone, inviteEmail: _inviteEmail, ...rest } = member;
  void _inviteEmail;
  return { ...rest, phoneMasked: `••••${phone.slice(-4)}` };
}

/**
 * OWNER only, and deliberately not `canManage`.
 *
 * `canManage` is "OWNER, ADMIN or MANAGER" and gates capacity, closed dates,
 * earnings
 * and listing edits. Both team writes are 403 "OWNER only" — a manager who
 * could add a staff account could hand out access to a business that is not
 * theirs.
 */
function requireOwner(request: Request) {
  const failed = requireSession(request);
  if (failed) return failed;
  if (!sessionUser(request)!.roles.includes("OWNER")) {
    return envelope("forbidden", "Only the owner can do that.", 403);
  }
  return null;
}

/**
 * OWNER **or ADMIN** — who may invite.
 *
 * Deliberately not the same guard as `requireOwner`, because the two stopped
 * being one question: `POST /team` is "OWNER or ADMIN" while
 * `DELETE /team/{id}` is still 403 "OWNER only". "ADMIN may invite because the
 * reason that role exists is an owner who is not on the island and cannot be
 * the only person able to add somebody."
 *
 * The mock keeping them apart is what makes the portal's own split testable —
 * a mock that gated both on OWNER would let the invite form go on being hidden
 * from an admin and nothing would notice.
 */
function requireInviter(request: Request) {
  const failed = requireSession(request);
  if (failed) return failed;
  const roles = sessionUser(request)!.roles;
  if (!roles.includes("OWNER") && !roles.includes("ADMIN")) {
    return envelope("forbidden", "Only an owner or an admin can do that.", 403);
  }
  return null;
}

/**
 * The 403 every access write shares — OWNER or ADMIN, and an admin may not act
 * on an OWNER.
 *
 * ## The "or another admin" clause is gone
 *
 * It was here until 14 September, and it was the contract's wording at the time.
 * Each of the four endpoints now names one exception and only one: "an ADMIN
 * cannot change an OWNER's role", "cannot hold an OWNER", "cannot restore an
 * OWNER", "cannot remove an OWNER". Two admins may act on each other, and what
 * stops that becoming a lockout is the `409` on the last active OWNER or ADMIN
 * rather than rank (D15, yuvoy-operator#51).
 *
 * The mock has to move with it. One that kept refusing admin-on-admin would let
 * the portal go on hiding controls the API allows, and no test would notice —
 * which is exactly how the old clause survived the restatement.
 *
 * Returns the refusal, or `null`, or the target member when it is allowed.
 */
function requireAccessManager(request: Request, targetId: string) {
  const failed = requireSession(request);
  if (failed) return { refusal: failed, member: null };

  const roles = sessionUser(request)!.roles;
  if (!roles.includes("OWNER") && !roles.includes("ADMIN")) {
    return {
      refusal: envelope(
        "forbidden",
        "Only an owner or an admin can do that.",
        403,
      ),
      member: null,
    };
  }

  const member = team.find((m) => m.id === targetId);
  // 404 covers "not on this team" and "belongs to somebody else" alike, and
  // deliberately does not tell them apart.
  if (!member) {
    return {
      refusal: envelope("not_found", "No such member.", 404),
      member: null,
    };
  }

  if (!roles.includes("OWNER") && member.roles.includes("OWNER")) {
    return {
      refusal: envelope("forbidden", "An admin cannot change an owner.", 403),
      member: null,
    };
  }

  if (member.id === sessionUser(request)!.id) {
    return {
      refusal: envelope(
        "cannot_change_access",
        "You cannot change your own access.",
        409,
      ),
      member: null,
    };
  }

  return { refusal: null, member };
}

/**
 * Active people who can let somebody in — owners AND admins, counted together.
 *
 * The line every access write holds: "the business keeps at least one active
 * OWNER or ADMIN … a business with neither has nobody who can let anybody back
 * in" (D15). Pending rows are invitations rather than logins and are not counted;
 * a held login cannot let anybody in either.
 *
 * The mock counted owners alone until 14 September, which meant the portal's own
 * owners-only version agreed with it and neither was right. A business whose
 * owner had left and whose last admin could be removed was a lockout both sides
 * called legal.
 */
function activeSeniors() {
  return team.filter(
    (m) =>
      !m.pending &&
      m.state !== "suspended" &&
      (m.roles.includes("OWNER") || m.roles.includes("ADMIN")),
  );
}

/** Whether this row is the last active owner or admin the business has. */
function isLastSenior(member: MockTeamMember) {
  const seniors = activeSeniors();
  return seniors.length === 1 && seniors[0].id === member.id;
}

/**
 * OWNER, ADMIN or MANAGER: `canManage`, exactly as `GET /me` defines it.
 *
 * Every write that commits seats or money is gated on it in the contract:
 * accept and decline ("STAFF cannot commit seats / answer requests"), seats,
 * closed dates, counter sales and call-off ("Requires OWNER, ADMIN or
 * MANAGER"), and
 * the earnings read. For its first month this mock refused none of them, so
 * the 403 branch every action renders had never once executed — a suite that
 * passes against a mock kinder than the API proves nothing about the refusal.
 * Found by the 2 Sep audit; `mock-roles.test.ts` now drives each one.
 */
/**
 * One IMAGE-hosting slot, for the logo's intent and the story's.
 *
 * The two endpoints answer the same shape and differ only in who may call
 * them, so the body is written once — a second copy is how they drift and how
 * a portal ends up handling one and not the other.
 *
 * Named apart from `uploadIntent` above, which is the tus slot a reel or a
 * listing photograph uploads through: a different protocol, a different
 * ceiling and a different response.
 */
function imageIntent() {
  const imageId = `img_${Math.random().toString(36).slice(2, 10)}`;
  return {
    imageId,
    // A different origin, exactly as in production.
    uploadUrl: `http://127.0.0.1:${MOCK_TUS_PORT}/photos/${imageId}`,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    maxBytes: 10 * 1024 * 1024,
    next: "upload_then_put",
  };
}

function requireManager(request: Request, refusal: string) {
  const failed = requireSession(request);
  if (failed) return failed;
  if (!canManage(sessionUser(request)!)) {
    return envelope("forbidden", refusal, 403);
  }
  return null;
}

/**
 * What one captured booking contributed (yuvoy-api#60).
 *
 * ₹4,500 a seat and 15% commission — the rate `EARNINGS` implies (810,000 of
 * 5,400,000), so the two fixtures describe one business rather than two.
 * `bkg_3` carries a one-seat refund so the "− refunds" line is not always ₹0
 * and the screen's WHICH-line-moved claim is exercised. Every row reconciles,
 * so the per-row check runs on a passing case; the failing case is a unit
 * test, because a mock that lies about arithmetic teaches the wrong thing.
 */
function bookingMoney(p: MockParty) {
  /*
    What the API really sends on a CASH booking — yuvoy-operator#40.

    `captured_amount_paise` is 0 rather than null, so `money` is present, and
    the commission on the fare was stored when the booking was made: gross ₹0,
    commission the share, net negative — and it reconciles. Modelled as sent,
    because a mock that left `money` off would let a screen render card
    arithmetic on a cash booking and pass.
  */
  if (p.cash) {
    const share = Math.round(p.cash.collectPaise * 0.15);
    return {
      grossPaise: 0,
      commissionPaise: share,
      refundsPaise: 0,
      netPaise: -share,
    };
  }
  const gross = 450_000 * p.guests;
  const commission = Math.round(gross * 0.15);
  const refunds = p.bookingId === "bkg_3" ? 450_000 : 0;
  return {
    grossPaise: gross,
    commissionPaise: commission,
    refundsPaise: refunds,
    netPaise: gross - commission - refunds,
  };
}

function partyOf(
  bookingId: string,
): { slotId: string; party: MockParty } | null {
  for (const slot of SLOTS) {
    const party = slot.parties.find((p) => p.bookingId === bookingId);
    if (party) return { slotId: slot.id, party };
  }
  return null;
}

/**
 * A booking's `fulfilment_state`, as the API would read it now.
 *
 * Arriving changes nothing — `MarkArrived` sets `arrived_at` and leaves the
 * state alone — so only a terminal outcome replaces it. Taking the cash moves a
 * cash booking to `confirmed`, in the same write that records the notes.
 *
 * Lists used to hand back `arrived` as a state after a tap on Here, which the
 * API never does, and which would have let a screen branch on it.
 */
function bookingStateOf(p: MockParty): string {
  /*
    A cancellation wins over everything, including a recorded collection: the
    booking is off, and the cash being in the till is what `cash-returned`
    exists for rather than a reason to call it confirmed.
  */
  if (cancelled[p.bookingId]) return "cancelled";
  /*
    A departure called off in this session took every booking on it with it,
    in the same transaction, as the API's call-off does. Without this a party
    on it read as live, and recording its cash going back was refused as "not
    cancelled".
  */
  const slotId = partyOf(p.bookingId)?.slotId;
  if (slotId && calledOff[slotId]) return "cancelled";
  const outcome = attendance[p.bookingId]?.outcome;
  if (outcome && outcome !== "arrived") return outcome;
  return cashTaken[p.bookingId] ? "confirmed" : p.state;
}

/**
 * A booking's `cancellation`, as the API sends it — present only on one that
 * ended.
 *
 * `operatorCancelled` is set because this team did it through the portal, which
 * is the only way a booking gets cancelled in this mock. `CALLED_OFF_PARTIES`
 * covers the other shape: a departure called off takes its bookings with it.
 */
function bookingCancellationOf(p: MockParty) {
  const ours = cancelled[p.bookingId];
  if (ours) {
    return {
      at: ours.at,
      by: "operator",
      reasonCode: "OPERATOR_CANCELLED",
      operatorCancelled: { reasonCode: ours.reasonCode },
    };
  }
  return p.cancellation;
}

/** A booking's `cash` — present only on a cash booking, as the API sends it. */
function bookingCashOf(p: MockParty) {
  if (!p.cash) return undefined;
  const taken = cashTaken[p.bookingId];
  return taken
    ? {
        collectPaise: p.cash.collectPaise,
        collected: true,
        collectedAt: taken.collectedAt,
        collectedPaise: taken.collectedPaise,
      }
    : { ...p.cash };
}

/** What was recorded as taken, which is all of what goes back. */
function cashReturnOf(p: MockParty) {
  const back = cashReturned[p.bookingId];
  return back
    ? { returnedAt: back.returnedAt, returnedPaise: back.returnedPaise }
    : {};
}

/**
 * `CashToGiveBack` for one departure, as the manifest and the call-off send it
 * (yuvoy-api#204): every CANCELLED booking whose cash was recorded taken and
 * not yet recorded given back. `null` when there is nobody, because the API
 * sends no block at all then ("present only when there is somebody on it").
 */
function cashToGiveBackOf(slot: MockSlot) {
  const owed = slot.parties
    .filter((p) => p.bookingId && bookingStateOf(p) === "cancelled")
    .filter((p) => !cashReturned[p.bookingId])
    .map((p) => ({ party: p, cash: bookingCashOf(p) }))
    .filter(({ cash }) => cash?.collected === true)
    .map(({ party, cash }) => ({
      bookingId: party.bookingId,
      reference: party.reference,
      // A first name and nothing else (D-018).
      name: party.name.split(" ")[0] ?? "",
      guests: party.guests,
      amountPaise: cash?.collectedPaise ?? cash?.collectPaise ?? 0,
    }));
  if (owed.length === 0) return null;
  return {
    totalPaise: owed.reduce((n, p) => n + p.amountPaise, 0),
    parties: owed,
    note: "You are holding this money. These travellers paid you in cash and nothing was paid online, so we refund nothing: hand it back to them.",
  };
}

/**
 * Both relay endpoints.
 *
 * The rules are enforced rather than echoed: `detail` is required for every
 * intent except `note`, times must be 24-hour, and the character rule is real.
 *
 * It calls the SAME `validateRelay` the screen calls, deliberately. The
 * alternative was a second copy of the regex here, and a mock whose rule has
 * drifted from the client's is a suite that passes on values the API would
 * reject — which is the only thing a mock must never do.
 *
 * The exact regex the real API applies is not published; `validateRelay` is
 * this repo's reading of "letters, numbers and basic punctuation", and the API
 * stays the authority. A divergence shows up as a 400, which `sendRelay`
 * surfaces verbatim rather than swallowing.
 */
const relay = async (
  request: Request,
  audienceOf: () => MockParty[] | null,
) => {
  const failed = requireSession(request);
  if (failed) return failed;

  const body = (await request.json()) as {
    intent?: string;
    detail?: string;
    note?: string;
  };

  const problem = validateRelay(
    body.intent ?? "",
    body.detail ?? "",
    body.note ?? "",
  );
  if (problem) return envelope("invalid_input", problem.message, 400);

  const audience = audienceOf();
  if (audience === null) {
    return envelope("not_found", "No such departure or booking.", 404);
  }

  /*
    Who is on the manifest: a live booking, never a hold and never a
    cancelled one (yuvoy-api#202). Nobody left is a 409, "deliberately not a
    success: 'sent to 0 people' and 'sent' must not look the same".
  */
  const live = audience.filter(
    (p) => p.bookingId && bookingStateOf(p) !== "cancelled",
  );
  if (live.length === 0) {
    return envelope(
      "nobody_to_tell",
      "Nobody on this departure has a live booking, so there was nobody to tell.",
      409,
    );
  }

  /*
    `recipients` counts people a message is actually going to (yuvoy-api#200),
    by email because this deployment, like production, has no WhatsApp sender.
    Anybody with no reachable address is `notReached`, present only when above
    zero, with its sentence.
  */
  const recipients = live.filter((p) => !p.unreachable).length;
  const notReached = live.length - recipients;
  return HttpResponse.json(
    {
      batchId: `batch_${Math.random().toString(36).slice(2, 10)}`,
      intent: body.intent,
      recipients,
      byChannel: recipients > 0 ? { email: recipients } : {},
      ...(notReached > 0
        ? {
            notReached,
            notReachedNote:
              notReached === 1
                ? "1 person on this departure could not be sent this: we hold no address we can reach them on. Their booking page shows it."
                : `${notReached} people on this departure could not be sent this: we hold no address we can reach them on. Their booking pages show it.`,
          }
        : {}),
    },
    { status: 202 },
  );
};

/**
 * Pausing a listing — `withdraw` and `pause`, one handler under two names, as
 * the API registers them (yuvoy-operator#44, yuvoy-api#157).
 *
 * **Cancels nothing and refunds nothing**, and the response says what is
 * still owed. The `note` is present only when there are bookings to honour,
 * because that is the sentence a client must render verbatim: an operator who
 * assumes pausing cancelled the bookings simply does not turn up.
 *
 * `next` is production's sentence word for word — including that it is STALE:
 * it still says putting a listing back goes through us, which D-032.4 ended.
 * Kept exactly so the screen is tested against what the API actually sends,
 * and the screen does not render it.
 */
const pauseHandler = (path: string) =>
  http.post(url(path), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;
    if (!canManage(sessionUser(request)!)) {
      return envelope(
        "forbidden",
        "only an owner, admin or manager can take a listing off sale",
        403,
      );
    }

    const listing = mockExperiences.find((e) => e.id === String(params.id));
    if (!listing) return envelope("not_found", "no such listing", 404);

    const body = (await request.json()) as {
      reasonCode?: string;
      confirmExperienceId?: string;
    };
    if (!body.reasonCode) {
      return envelope(
        "invalid_reason_code",
        "why are you taking this off sale?",
        400,
      );
    }
    if (body.confirmExperienceId !== listing.id) {
      return envelope(
        "confirmation_required",
        "taking a listing off sale stops every new booking on it. Send confirmExperienceId to go ahead.",
        400,
      );
    }
    /*
      A draft is already selling nothing — the API's own answer, which is
      `already_off_sale` rather than a separate refusal.
    */
    if (listing.publicationState === "draft" || listing.status === "draft") {
      return envelope(
        "already_off_sale",
        "this listing is still a draft, so it is not on sale to anybody yet",
        409,
      );
    }
    if (listing.status === "withdrawn") {
      return envelope("already_off_sale", "this listing is off sale", 409);
    }

    listing.status = "withdrawn";
    listing.publicationState = "withdrawn";

    /*
      Bookings that still stand. `exp_offsale` is the pause walkthrough's own
      listing and carries some, because the sentence about what pausing did
      NOT do is the whole point of the response.
    */
    const bookingsToHonour =
      listing.id === "exp_offsale" || listing.id === "exp_dive" ? 3 : 0;
    return HttpResponse.json({
      state: "withdrawn",
      upcomingDepartures: listing.upcomingDepartures ?? 0,
      bookingsToHonour,
      guestsToHonour: bookingsToHonour * 2,
      ...(bookingsToHonour > 0
        ? {
            note: "This listing is off sale: nobody new can book it. The 3 bookings you have already taken are unchanged. You still need to run those departures, or call each one off yourself.",
          }
        : {}),
      /*
        The API's sentence, word for word, from `withdrawnNext` in
        yuvoy-api's `internal/handler/operator_listing_copy.go`.

        It used to say "ask us to put it back ... we check it before travellers
        see it again", which D-032.4 made false: resuming is the operator's own
        button and is immediate. The portal suppressed it for that reason and
        both the wording and the suppression are gone.

        The mock then drifted a second time: it carried a sentence with the
        right meaning and the wrong words, so the e2e passed against a mock
        that disagreed with production (yuvoy-operator#61). Nothing was wrong
        on screen, because the portal prints `next` verbatim, which is exactly
        what made the drift invisible.
      */
      next: "It is off sale. Resume on the listing puts it back straight away. Nobody at Yuvoy needs to check it first.",
    });
  });

/**
 * Resuming a paused listing — `resume` and `relist`, one handler under two
 * names (yuvoy-operator#44, D-032.4). Immediate: no queue and no admin.
 *
 * The API's rules, modelled rather than waved through:
 *   - already published, or awaiting its first approval → idempotent, the
 *     state as it is, nothing written;
 *   - anything else that is not paused → `409 not_withdrawn`;
 *   - a mandatory field still empty → `400` naming it in `details.missing`,
 *     "so you find out while the form is open".
 *
 * `next` is CHOSEN BY WHAT IS TRUE since yuvoy-api#167. It used to be an
 * unconditional "travellers can book it now", which is false for a listing
 * whose account cannot sell, and the portal suppressed it for that reason.
 *
 * The three sentences are modelled rather than collapsed into one, because the
 * portal now prints whichever arrives verbatim: a mock that always sent the
 * happy one would let the screen ship a claim it never makes.
 */
const resumeHandler = (path: string) =>
  http.post(url(path), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;
    if (!canManage(sessionUser(request)!)) {
      return envelope(
        "forbidden",
        "only an owner, admin or manager can put a listing back on sale",
        403,
      );
    }

    const listing = mockExperiences.find((e) => e.id === String(params.id));
    if (!listing) return envelope("not_found", "no such listing", 404);

    const state = listing.publicationState ?? "draft";

    /*
      Which of the three is true. `sellable === false` is the case the old
      unconditional sentence lied about: a listing that is published and still
      unsellable, because something on the account stops sales — a lapsed
      insurance document, a standing that is not LIVE. Eligibility is
      re-derived on every read, so publishing never settles it.
    */
    const sentenceFor = (now: string) =>
      now === "in_review"
        ? "It has not been approved yet, so it is still with us. It goes on sale once a person has checked it."
        : listing.sellable === false
          ? "It is back on your listings, but travellers cannot book it yet. Something on your account is stopping sales. The Business screen says what."
          : "It is back on sale. Travellers can see it and book it now.";

    if (state === "published" || state === "in_review") {
      return HttpResponse.json({ state, next: sentenceFor(state) });
    }
    if (state !== "withdrawn") {
      return envelope("not_withdrawn", "this listing is not off sale", 409);
    }
    if (listing.publishBlockers?.length) {
      return HttpResponse.json(
        {
          error: {
            code: "invalid_input",
            message:
              "we still need a few things before this can go back on sale",
            details: { missing: listing.publishBlockers },
          },
        },
        { status: 400 },
      );
    }

    listing.publicationState = "published";
    listing.status = "live";
    return HttpResponse.json({
      state: "published",
      next: sentenceFor("published"),
    });
  });

export const handlers = [
  ...authHandlers({
    url,
    requireSession,
    envelope,
    sessionUser,
    sessionTokenFor,
    canManage,
    accountFor,
    accountWithFiles,
    payoutsHeldFor,
    unreadTotals,
    OFFBOARDED_PHONE,
    CODE_ATTEMPT_LIMIT,
    team: () => team,
    signups: () => signups,
    codeAttempts: () => codeAttempts,
  }),

  ...teamHandlers({
    url,
    requireSession,
    requireInviter,
    requireWritable,
    envelope,
    sessionUser,
    publicMember,
    sessionTokenFor,
    team: () => team,
    setTeam: (next) => {
      team = next;
    },
  }),

  /* ------------------------------------------------------------ media --- */

  ...profileHandlers({
    url,
    requireSession,
    requireManager,
    envelope,
    sessionUser,
    isLiveBusiness,
    fileForReview,
    profileResponse,
    switchesFor,
    applySwitches,
    profile: () => profile,
    setProfile: (next) => {
      profile = next;
    },
    filedCredentials: () => filedCredentials,
    team: () => team,
  }),

  ...documentFileHandlers({
    url,
    requireSession,
    envelope,
    sessionUser,
    credentialOf,
    documentIntents: () => documentIntents,
    documentFiles: () => documentFiles,
  }),

  ...storyHandlers({
    url,
    requireSession,
    requireWritable,
    requireManager,
    envelope,
    sessionUser,
    isLiveBusiness,
    fileForReview,
    imageIntent,
    storyResponse,
    storyPhotoJson,
    mockLogoUrl,
    story: () => story,
    currentLogo: () => logo,
    setLogo: (next) => {
      logo = next;
    },
  }),

  ...photoHandlers({
    url,
    requireSession,
    envelope,
    FIXTURE_POSTER,
    mockExperiences: () => mockExperiences,
    photoIntents: () => photoIntents,
    photoIntentsById: () => photoIntentsById,
    mediaAssets: () => mediaAssets,
  }),

  ...experienceHandlers({
    url,
    requireSession,
    requireWritable,
    envelope,
    sessionUser,
    isNewBusiness,
    withPin,
    bookableDatesOf,
    unconfirmedDeparturesOf,
    draftBlockers,
    mockExperiences: () => mockExperiences,
  }),

  ...scheduleHandlers({
    url,
    requireSession,
    requireWritable,
    requireManager,
    envelope,
    withPin,
    allSlots,
    slotDay,
    slotStatusOf,
    departureSeats,
    saleVerdictOf,
    seatsAwaitingConfirmation,
    bookingStateOf,
    bookableDatesOf,
    unconfirmedDeparturesOf,
    situationOf,
    listingQuestions,
    mockExperiences: () => mockExperiences,
    mediaAssets: () => mediaAssets,
    seatsConfirmed: () => seatsConfirmed,
    calledOff: () => calledOff,
    movedTimes: () => movedTimes,
  }),

  /**
   * Save a draft in place — the builder's every step but the schedule and the
   * questions (yuvoy-operator#58 item 7).
   *
   * "On a draft there is no completeness check and no review." So this writes
   * whatever it is given and recomputes `publishBlockers`, which is the field
   * the builder marks its steps from: a mock that stored the fields without
   * recomputing them would leave a step marked unfinished after it was
   * finished, and no test would catch the builder never clearing a mark.
   *
   * **Only a draft.** A submitted listing is what a reviewer is reading and a
   * published one is what travellers are booking against, so both answer `409`.
   */
  http.patch(url("/experiences/:id"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;
    if (!canManage(sessionUser(request)!)) {
      return envelope(
        "forbidden",
        "only an owner, admin or manager can change a listing",
        403,
      );
    }

    const found = mockExperiences.find((e) => e.id === String(params.id));
    if (!found) return envelope("not_found", "No such listing.", 404);
    if (found.status !== "draft") {
      return envelope(
        "conflict",
        "This listing is no longer a draft. Change it through a revision.",
        409,
      );
    }

    const body = (await request.json()) as Record<string, unknown>;

    /*
      The closed set. "Unknown fields are refused", and the refusal names them
      in `details.unknownFields` with `details.allowed` beside it, because a
      client sending a field we renamed should be able to say which one.
    */
    const allowed = [
      "title",
      "summary",
      "description",
      "category",
      "activityType",
      "destination",
      "meetingPoint",
      "meetingLandmark",
      "meetingLat",
      "meetingLng",
      "inclusions",
      "requirements",
      "safetyNotes",
      "screenerKey",
      "durationMinutes",
      "maxPartySize",
      "unitPricePaise",
      "bookingMode",
      "pricingUnit",
    ];
    const unknownFields = Object.keys(body).filter((k) => !allowed.includes(k));
    if (unknownFields.length > 0) {
      return envelope(
        "invalid_input",
        "We do not know one of those fields.",
        400,
        { unknownFields, allowed },
      );
    }

    const badPin = pinRefusal(body);
    if (badPin) return badPin;

    /*
      A destination outside the market, refused exactly as create refuses it.
      It is the single most likely 400 the builder will meet, and the step
      renders the API's own sentence for it.
    */
    if (
      typeof body.destination === "string" &&
      !body.destination.startsWith("andaman/")
    ) {
      return envelope(
        "invalid_input",
        `"${body.destination}" is not a place in your market. Yours all start with "andaman/".`,
        400,
      );
    }

    /*
      A screener that is not current. "Not an enum: a screener is a row, added
      or retired on medical advice rather than by a release", so the refusal
      names the keys that ARE current rather than a fixed list.
    */
    if (body.screenerKey && String(body.screenerKey) !== "diving_rstc") {
      return envelope(
        "invalid_input",
        "That health check is not one we run.",
        400,
        { screenerKey: ["diving_rstc"] },
      );
    }

    for (const key of allowed) {
      if (!(key in body)) continue;
      const value = body[key];
      /*
        An empty optional is stored as absent, as the API stores it: "an absent
        key and an empty string mean the same thing". Storing "" would clear a
        blocker with a value nobody typed.
      */
      (found as Record<string, unknown>)[key] =
        value === "" ? undefined : value;
    }

    if (typeof body.pricingUnit === "string" && body.pricingUnit) {
      found.pricingUnitStated = true;
    }
    found.publishBlockers = draftBlockers(found);
    found.sellable =
      typeof found.unitPricePaise === "number" && found.unitPricePaise > 0;

    return HttpResponse.json(withPin(found));
  }),

  /**
   * Discard a draft nobody has seen (yuvoy-operator#112, yuvoy-api#249), as
   * the contract has it: OWNER, ADMIN or MANAGER, "the same as `PATCH` on this
   * listing"; `204` and it is gone, with the departures saved on it; `404` for
   * one that is not here; and `409 conflict` "once a listing has been sent to
   * us", which is a `review` on the row (`POST .../submit` writes one) or a
   * listing that is past draft. The words are the handler's (`DeleteDraft` at
   * fb9245e).
   *
   * Refused while suspended, like `PATCH`: it is not on the list of writes a
   * suspended business may still make.
   */
  http.delete(url("/experiences/:id"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;
    if (!canManage(sessionUser(request)!)) {
      return envelope(
        "forbidden",
        "only an owner, admin or manager can delete a listing",
        403,
      );
    }

    const id = String(params.id);
    const found = mockExperiences.find((e) => e.id === id);
    if (!found) return envelope("not_found", "no such listing", 404);
    if ((found.publicationState ?? found.status) !== "draft" || found.review) {
      return envelope(
        "conflict",
        "only a draft can be deleted. This listing has already been sent to us",
        409,
      );
    }

    mockExperiences = mockExperiences.filter((e) => e.id !== id);
    // `availability_slots` cascade from `experiences`, and so do its questions.
    createdSlots = createdSlots.filter((slot) => slot.experienceId !== id);
    delete listingQuestions[id];
    return new HttpResponse(null, { status: 204 });
  }),

  /**
   * Send a listing to a person at Yuvoy — yuvoy-operator#58 items 4 and 7.
   *
   * The submit gate demands everything mandatory EXCEPT `activityType` and
   * `pricingUnit`, which is the contract's own asymmetry and the reason the
   * Review step disables its button over two fields the server would accept.
   * Modelled rather than smoothed over: a mock that refused them too would hide
   * the gap the builder exists to cover.
   *
   * "A double tap is safe: an `in_review` listing answers `200`."
   */
  http.post(url("/experiences/:id/submit"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;
    if (!canManage(sessionUser(request)!)) {
      return envelope(
        "forbidden",
        "only an owner, admin or manager can send a listing for review",
        403,
      );
    }

    const found = mockExperiences.find((e) => e.id === String(params.id));
    if (!found) return envelope("not_found", "No such listing.", 404);
    if (found.status === "in_review") {
      return HttpResponse.json({ id: found.id, status: "in_review" });
    }
    if (found.status !== "draft" && found.status !== "changes_rejected") {
      return envelope("conflict", "This listing is no longer a draft.", 409);
    }

    const missing = draftBlockers(found).filter(
      (key) => key !== "activityType" && key !== "pricingUnit",
    );
    if (missing.length > 0) {
      return envelope("invalid_input", "Something is still missing.", 400, {
        missing,
      });
    }

    found.status = "in_review";
    // A first submission moves the listing itself into review (yuvoy-api
    // `SubmitDraft`), which its departures then say.
    if (found.publicationState === "draft")
      found.publicationState = "in_review";
    found.review = { state: "submitted", since: new Date().toISOString() };
    found.sentBack = undefined;
    return HttpResponse.json({ id: found.id, status: "in_review" });
  }),

  ...listingHandlers({
    url,
    requireSession,
    requireWritable,
    envelope,
    sessionUser,
    canManage,
    contactRefusal,
    choiceOptionsOf,
    withPin,
    pinRefusal,
    LISTING_FIELDS,
    OPERATOR_DIRECT,
    MATERIAL_FIELDS,
    pauseHandler,
    resumeHandler,
    listingQuestions,
    mockExperiences: () => mockExperiences,
  }),

  ...mediaHandlers({
    url,
    requireSession,
    requireWritable,
    envelope,
    sessionUser,
    isNewBusiness,
    situationOf,
    uploadIntent,
    mediaAssets: () => mediaAssets,
    uploadIntents: () => uploadIntents,
    mockExperiences: () => mockExperiences,
  }),

  /**
   * Change what somebody can do. The role is REPLACED, not added to.
   *
   * Modelled as a replacement rather than a merge because that is the one
   * thing about this endpoint a client could get wrong invisibly: a mock that
   * appended would let a picker ship that quietly grants more than the person
   * choosing it believes.
   */
  http.put(url("/team/:id/role"), async ({ request, params }) => {
    const { refusal, member } = requireAccessManager(
      request,
      String(params.id),
    );
    if (refusal) return refusal;

    const body = (await request.json()) as { role?: string };
    const role = body.role ?? "";
    /*
      All FOUR. `OWNER` used to land in the 400 here on "`OWNER` cannot be
      given"; the enum is now `[OWNER, ADMIN, MANAGER, STAFF]` and "an OWNER or an
      ADMIN may make somebody already on the team an owner" (D31).
    */
    if (!["OWNER", "ADMIN", "MANAGER", "STAFF"].includes(role)) {
      return envelope("invalid_input", "OWNER, ADMIN, MANAGER or STAFF.", 400);
    }
    /*
      Demoting the last active owner-or-admin is the refusal, not touching an
      owner's row at all. The old rule — "an owner's role is not changed here" —
      refused a change the API now makes, and an owner handing the business on had
      no way through the portal.
    */
    if (role !== "OWNER" && role !== "ADMIN" && isLastSenior(member!)) {
      return envelope(
        "cannot_change_access",
        "That would leave the business with no owner and no admin.",
        409,
      );
    }

    member!.roles = [role];
    // In the real API their sessions end here. There is no session state to
    // revoke in this mock; the replacement is what a client can observe.
    return new HttpResponse(null, { status: 204 });
  }),

  /**
   * Pause a login. The row, the role and the history stay.
   *
   * A held member keeps coming back from `GET /team` with `state: "suspended"`
   * — the mock keeps them in the list for exactly that reason. One that
   * removed them would let a screen ship that makes a hold look like a
   * removal, which is the confusion this endpoint exists to remove.
   */
  http.post(url("/team/:id/hold"), async ({ request, params }) => {
    const { refusal, member } = requireAccessManager(
      request,
      String(params.id),
    );
    if (refusal) return refusal;

    if (member!.pending || member!.state === "suspended") {
      // "Not on this team, or not currently working."
      return envelope("not_found", "Not currently working.", 404);
    }
    if (isLastSenior(member!)) {
      return envelope(
        "cannot_change_access",
        "You cannot pause the last owner or admin. Somebody has to be able to let people in.",
        409,
      );
    }

    member!.state = "suspended";
    return new HttpResponse(null, { status: 204 });
  }),

  /** Give held access back, with the role they had. No session is minted. */
  http.post(url("/team/:id/restore"), async ({ request, params }) => {
    const { refusal, member } = requireAccessManager(
      request,
      String(params.id),
    );
    if (refusal) return refusal;

    if (member!.pending || member!.state !== "suspended") {
      // "Not on this team, or not on hold."
      return envelope("not_found", "Not on hold.", 404);
    }

    member!.state = "active";
    return new HttpResponse(null, { status: 204 });
  }),

  /*
    "OWNER **or** ADMIN, was OWNER-only" (yuvoy-api#109). The seniority clause
    comes with it, and it is now one clause rather than two: an admin may not
    remove an OWNER, and may remove another admin.

    The 409 is `cannot_change_access`. `cannot_remove` is gone from the contract
    and this mock no longer sends it — a mock that did would keep the portal's
    dead branch alive and passing (yuvoy-operator#51 item 4).
  */
  http.delete(url("/team/:id"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const myRoles = sessionUser(request)!.roles;
    if (!myRoles.includes("OWNER") && !myRoles.includes("ADMIN")) {
      return envelope(
        "forbidden",
        "Only an owner or an admin can do that.",
        403,
      );
    }

    const id = String(params.id);
    const member = team.find((m) => m.id === id);
    if (!member) return envelope("not_found", "No such member.", 404);

    if (!myRoles.includes("OWNER") && member.roles.includes("OWNER")) {
      return envelope("forbidden", "An admin cannot remove an owner.", 403);
    }

    if (!member.pending) {
      if (member.id === sessionUser(request)!.id) {
        return envelope(
          "cannot_change_access",
          "You cannot remove yourself.",
          409,
        );
      }
      if (isLastSenior(member)) {
        return envelope(
          "cannot_change_access",
          "You cannot remove the last owner or admin. A business with neither has nobody who can let anybody back in.",
          409,
        );
      }
    }

    /*
      Removed outright. In the real API "their sessions are revoked in the same
      transaction" — there is no session state to revoke in this mock, but the
      removal is immediate here for the same reason it is there: a row that
      lingers is a client that ships believing removal is eventual.
    */
    team = team.filter((m) => m.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),

  ...dayHandlers({
    url,
    requireSession,
    requireWritable,
    envelope,
    sessionUser,
    canManage,
    isNewBusiness,
    allSlots,
    slotDay,
    slotStatusOf,
    saleVerdictOf,
    departureSeats,
    bookingStateOf,
    bookingCashOf,
    cashToGiveBackOf,
    unreadOf,
    attendance: () => attendance,
    calledOff: () => calledOff,
    createdSlots: () => createdSlots,
    mockExperiences: () => mockExperiences,
  }),
  ...bookingHandlers({
    url,
    requireSession,
    isNewBusiness,
    bookingMoney,
    bookingStateOf,
    bookingCashOf,
    bookingCancellationOf,
    answered: () => answered,
  }),

  ...conversationHandlers({
    url,
    requireSession,
    envelope,
    sessionUser,
    isNewBusiness,
    threadFor,
    bookingOf,
    threadRows,
    contactDetailIn,
    contactKindWords,
    IDEMPOTENCY_KEY,
    messageKeys,
    threads: () => threads,
  }),

  ...bookingActionHandlers({
    url,
    requireManager,
    requireSession,
    requireWritable,
    envelope,
    isNewBusiness,
    bookingMoney,
    bookingStateOf,
    bookingCashOf,
    bookingCancellationOf,
    cashReturnOf,
    cancelled: () => cancelled,
    cashReturned: () => cashReturned,
    cashTaken: () => cashTaken,
    answered: () => answered,
  }),

  ...moneyHandlers({
    url,
    requireManager,
    requireSession,
    envelope,
    sessionUser,
    isNewBusiness,
    ownsNoStatements,
    changesFor,
    sha256Hex,
    stoppedChanges: () => stoppedChanges,
  }),
  ...bankChangeHandlers({
    url,
    requireSession,
    requireOwner,
    requireWritable,
    envelope,
    sessionUser,
    businessOf,
    changesFor,
    openBankChanges,
    team: () => team,
    isSteppedUp: () => steppedUp,
    stepUp: () => {
      steppedUp = true;
    },
    bankChanges: () => bankChanges,
    stoppedChanges: () => stoppedChanges,
  }),

  ...capacityHandlers({
    url,
    requireManager,
    requireSession,
    requireWritable,
    envelope,
    allSlots,
    closedByAny,
    slotDay,
    blackouts: () => blackouts,
    calledOff: () => calledOff,
    capacity: () => capacity,
    seatsConfirmed: () => seatsConfirmed,
  }),
  ...departureHandlers({
    url,
    requireManager,
    requireSession,
    requireWritable,
    envelope,
    allSlots,
    departureSeats,
    partyOf,
    bookingStateOf,
    cashToGiveBackOf,
    arrivalTime,
    relay,
    RFC3339,
    capacity: () => capacity,
    offlineSold: () => offlineSold,
    offlineEntries: () => offlineEntries,
    calledOff: () => calledOff,
    attendance: () => attendance,
  }),

  ...checkInHandlers({
    url,
    requireSession,
    envelope,
    partyOf,
    bookingStateOf,
    attendance: () => attendance,
    cashTaken: () => cashTaken,
  }),

  /* ------------------------------------------- listing claims (#388) --- */
  ...claimHandlers({
    url,
    sessionUser,
    businessOf,
    requireSession,
    requireWritable,
    listFailsFor: WIDE_READ_FAILS_ID,
    everyStateFor: BANK_UNCONFIRMED_ID,
  }),
];
