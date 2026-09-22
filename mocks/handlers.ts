import { http, HttpResponse } from "msw";
import { apiBaseUrl } from "../src/lib/api/server-client";
import {
  MOCK_TUS_PORT,
  mockPhotoArrived,
  resetMockPhotos,
  mockDocumentArrived,
  resetMockDocuments,
  createMockUpload,
  mockUploadDone,
  resetMockUploads,
} from "./tus-server";
import { validateRelay } from "../src/lib/day/relay-types";
import { deadlineLabel } from "../src/lib/format/market-time";
import {
  ACCOUNT_AWAITING,
  ACCOUNT_LIVE,
  ACCOUNT_LIVE_OUTSTANDING,
  ACCOUNT_PROSPECT,
  AWAITING_ID,
  CHANGE_REQUESTS,
  COMMISSION_OWED,
  DEV_CODE,
  CONTENDED_ID,
  DROPPING_ID,
  BUSINESS_NAME,
  JOIN_TOKEN,
  JOIN_URL,
  LEAVING_PHONE,
  SETTLEMENT_SENT,
  SETTLEMENT_APPROVED,
  SETTLEMENT_OWED_BACK,
  STATEMENT_CSV,
  FAILING_ID,
  OPERATOR,
  OTHER_MEMBERS,
  LIVE_OUTSTANDING_ID,
  PROSPECT_ID,
  SUSPENDED_ID,
  ACCOUNT_SUSPENDED,
  REQUESTS,
  SLOTS,
  TEAM,
  MESSAGE_THREADS,
  type MockMessage,
  type MockThread,
  type MockParty,
  WIDE_READ_FAILS_ID,
  type MockSlot,
  type MockTeamMember,
} from "./fixtures";

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
  return mine === "reef" ? [...raised, ...CHANGE_REQUESTS] : raised;
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

/** OWNER, ADMIN or MANAGER, exactly as `GET /me` defines it. */
const canManage = (member: MockTeamMember) =>
  member.roles.includes("OWNER") || member.roles.includes("MANAGER");

let attendance: Record<string, { outcome: string; arrivedAt?: string }> = {};
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
/** Assets that finished processing, and what has been attested about them. */
type MockMediaAsset = {
  attested: boolean;
  /**
   * `video` or `image` — yuvoy-api#119.
   *
   * Every asset carries one, because the API does. A fixture that left it off
   * would exercise only the unnamed-kind fallback and never the labelling this
   * screen exists for.
   */
  kind: "video" | "image";
  state: string;
  durationSeconds?: number;
  /**
   * The picture for this row, and it is ABSENT far more often than present.
   *
   * "Absent on most clips today" — a poster is only stored once the provider
   * has produced one, and an unpublished clip has no public URL: 270 of 342
   * clips had none when this was written (yuvoy-api#121). For a photograph the
   * picture IS the poster and the API builds the URL at read time, so a
   * photograph has one in every state.
   *
   * The fixture mirrors that distribution rather than giving everything a
   * poster, because a row with no picture is the common case and has to render
   * as something.
   */
  posterUrl?: string;
  listing?: {
    experienceId: string;
    title: string;
    state: string;
    /**
     * Whether this media is that listing's COVER — yuvoy-api#191.
     *
     * On the pairing rather than the asset, because that is where it lives: the
     * same asset can be a cover on one listing and a gallery item on another.
     * `null` is a real value and means "no role is known"; the portal keeps both
     * buttons for it rather than guessing.
     */
    role?: "hero" | "gallery" | null;
  };
  rejection?: { code: string; note?: string };
};

/** A tiny inline picture, so a poster needs no network and no binary fixture. */
const FIXTURE_POSTER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160">' +
      '<rect width="120" height="160" fill="#2f4f43"/></svg>',
  );

/**
 * The operator's listings — one per status the screen has to tell apart.
 *
 * `status` is what a client renders; `publicationState` and `review` are the
 * parts it is derived from, and both are sent so a client that tried to
 * recombine them would get a DIFFERENT answer here than the server's. That is
 * the mistake the contract warns about, and a mock that only sent `status`
 * could not catch it.
 */
type MockExperience = {
  id: string;
  /**
   * A first listing a reviewer sent back — yuvoy-api#180.
   *
   * Distinct from `review.rejectionCode`, which is a rejected EDIT to
   * something already live. This one has never sold, is a draft again, and
   * before the field existed the operator had no way to learn why.
   */
  sentBack?: { rejectionCode: string; rejectionNote: string; at: string };
  slug?: string;
  title: string;
  summary?: string;
  description?: string;
  category?: string;
  destination?: string;
  status: string;
  publicationState?: string;
  bookingMode?: string;
  durationMinutes?: number;
  maxPartySize?: number;
  unitPricePaise?: number | null;
  pricingUnit?: string;
  meetingPoint?: string;
  /*
    The material fields — yuvoy-operator#30 §5. On the wire since the contract
    was written and settable nowhere in this portal until now, which is why
    they were never in this fixture either.
  */
  inclusions?: string[];
  requirements?: string[];
  safetyNotes?: string;
  activityType?: string;
  activityTypeLabel?: string;
  /*
    The waiver, kept rather than discarded - yuvoy-operator#60. The create
    handler took the whole body and stored none of this, so `GET /experiences/
    {id}` answered without a `screenerKey` whether or not one was sent, and a
    test could not tell the fixed form from the broken one.
  */
  screenerKey?: string;
  /**
   * Whether anybody has SAID what the price means — yuvoy-operator#30 §1.
   *
   * `experiences.pricing_unit` is NOT NULL, so `pricingUnit` alone cannot carry
   * the answer: a listing nobody has asked still has a value in that column.
   * The API records the difference separately and reports it as a publish
   * blocker; this is the mock's version of that column.
   */
  pricingUnitStated?: boolean;
  /*
    The mandatory fields still empty — yuvoy-operator#30 §3. Computed rather
    than stored, so a fixture cannot claim a listing is ready while missing
    something the API would refuse.
  */
  publishBlockers?: string[];
  upcomingDepartures?: number;
  sellable?: boolean;
  /**
   * The weekly schedule the hub edits — yuvoy-operator#56 item 8.
   *
   * `repeatsWeekly` is the half that decides whether an empty save is a
   * question: clearing a schedule that exists closes every departure it made,
   * and clearing one that never existed does nothing.
   */
  schedule?: {
    repeatsWeekly: boolean;
    weekly: { weekday: number; startTime: string; seats: number }[];
  };
  review?: {
    state: string;
    since?: string;
    rejectionCode?: string;
    rejectionNote?: string;
  };
};

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

/** One question a listing asks, as the mock stores it. */
type MockQuestion = {
  id: string;
  text: string;
  answerType: string;
  options: string[];
  required: boolean;
};

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

/**
 * The business behind the account — `GET`/`PUT /profile`.
 *
 * Seeded HALF-FILLED on purpose. A complete profile makes the `missing` array
 * empty, and `missing` is the whole reason the contract names field names
 * rather than sending a boolean: "so a form can mark the specific rows." A
 * fixture with nothing outstanding cannot exercise that at all.
 */
type MockProfile = {
  displayName: string;
  legalName?: string;
  entityType?: string;
  gstin?: string;
  address: {
    line1?: string;
    line2?: string;
    locality?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
  submittedAt?: string;
};

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
interface MockStoryPhoto {
  id: string;
  imageId: string;
  position: number;
}

interface MockStory {
  about: string;
  languages: string[];
  photos: MockStoryPhoto[];
}

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
/**
 * Closures, as records rather than as a list of date ranges.
 *
 * They were `{ from, to, experienceId? }` and nothing else, which could not
 * model any of what #45 needs: an id to reopen, a reason to show, a note, the
 * departures a closure holds, or a closure of ONE departure. A calendar reading
 * that list back would have had to infer "closed" from each departure's status
 * all over again — which cannot see a closed day with no departures on it, and
 * can never say why.
 */
interface MockClosure {
  id: string;
  from: string;
  to: string;
  reasonCode: string;
  note?: string;
  experienceId?: string;
  departureId?: string;
  reopenedAt?: string;
  createdAt: string;
  /** Every departure it held when it was made. Fixed at that moment. */
  departureIds: string[];
}
let blackouts: MockClosure[] = [];

/** The market day a departure leaves on, in its OWN zone. */
function slotDay(slot: MockSlot): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: slot.timezone }).format(
    new Date(slot.startsAt),
  );
}

/** Every departure this operator has, fixtures and ones a test added. */
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
  if (slot.bookingMode === "allotment" && seats - sold <= 0) {
    return notOnSale("departure_full", "Every seat on this departure is sold.");
  }
  if (seatsAwaitingConfirmation(slot)) {
    return notOnSale(
      "departure_seats_unconfirmed",
      "Nobody has confirmed the seats on this departure for two days, so it is not on sale. Confirm them to put it back.",
    );
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
 * own — the issue says so in `Do not build`. A permissive mock would let the
 * portal ship with the refusal never once rendered, which is exactly how this
 * repo ended up with a `requireOperator()` that threw to an error boundary
 * that did not exist.
 *
 * The date exception is the subtle half and it is in the contract: "except the
 * digits of a date written like 14.09.2026 or 2026-09-14". An operator saying
 * when to turn up must not be told they typed a phone number.
 */
function contactDetailIn(text: string): "phone" | "email" | "link" | null {
  // Email first: an address contains something the link rule would also match.
  if (/[^\s@]+@[^\s@]+\.[^\s@]{2,}/.test(text)) return "email";
  if (/(^|\s)(https?:\/\/|www\.)/i.test(text)) return "link";
  if (/\b[a-z0-9][a-z0-9-]*\.(com|in|net|org|io|co|me)\b/i.test(text))
    return "link";

  const withoutDates = text
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ")
    .replace(/\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/g, " ");
  // Seven or more digits "counted through the spaces, dashes, brackets and
  // dots between them".
  if (/\d(?:[\s().-]*\d){6,}/.test(withoutDates)) return "phone";
  return null;
}

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
        slot: { startsAt: slot.startsAt, timezone: slot.timezone },
      };
    }
  }
  return null;
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
  if (me.id === LIVE_OUTSTANDING_ID) {
    /*
      Live, selling, and still owing us the logo and the registered address
      (yuvoy-operator#38). Checked BEFORE the `OTHER_MEMBERS` fallthrough,
      which hands back no account block at all, because this identity exists
      to render a screen rather than to hide one.
    */
    return ACCOUNT_LIVE_OUTSTANDING;
  }
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
  codeAttempts = {};
  answered = {};
  calledOff = {};
  capacity = {};
  offlineSold = {};
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
    review rather than refused. The contract still describes the old lock
    (yuvoy-api#222).
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
  const { phone, ...rest } = member;
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
  /* -------------------------------------------------------------- auth --- */

  /**
   * O1 — an operator creates their own account.
   *
   * **The response is identical for a number that already has an account**,
   * and this mock keeps it that way. A mock that 409'd a duplicate would let
   * the portal ship a branch the real API never takes — and that branch would
   * be the "is this phone a Yuvoy operator" oracle the endpoint is carefully
   * not. So a duplicate creates nothing and answers exactly like a success.
   *
   * No session is minted, exactly as with `/team/accept`: they sign in through
   * the ordinary flow afterwards.
   */
  http.post(url("/auth/signup"), async ({ request }) => {
    const body = (await request.json()) as {
      businessName?: string;
      name?: string;
      phone?: string;
      relationship?: string;
      email?: string;
    };
    const businessName = (body.businessName ?? "").trim();
    const name = (body.name ?? "").trim();
    const phone = (body.phone ?? "").trim();
    /*
      "Optional. Absent means `own`, which is what every sign-up meant before the
      question was asked." The mock honours that rather than requiring it, so a
      client that stops sending the field is not silently broken by the mock
      being stricter than the API.
    */
    const relationship = body.relationship ?? "own";

    if (
      businessName.length < 2 ||
      name.length < 2 ||
      !/^\+[1-9]\d{7,14}$/.test(phone)
    ) {
      return envelope(
        "invalid_input",
        "A business name, a person and an E.164 number.",
        400,
      );
    }

    /*
      "Anything else is refused with `400`, BEFORE the number is looked at, so the
      refusal says nothing about whether the number has an account." The order
      matters as much as the refusal: checking the phone first would make this a
      way to ask whether a number is registered.
    */
    if (relationship !== "own" && relationship !== "run") {
      return envelope("invalid_input", "Own it, or run it for the owner.", 400);
    }

    const taken = [...team, ...OTHER_MEMBERS, ...signups].some(
      (m) => m.phone === phone,
    );
    if (!taken) {
      signups.push({
        id: `usr_signup_${Math.random().toString(36).slice(2, 10)}`,
        name,
        /*
          "`own` makes them its OWNER. `run` makes them its ADMIN, and the
          business has no owner until they invite one" (D15). The whole point of
          asking the question, so the mock is what makes the answer observable:
          `GET /me` is where a test can see which one it got.
        */
        roles: [relationship === "run" ? "ADMIN" : "OWNER"],
        state: "active",
        phone,
      });
    }

    return HttpResponse.json({ next: "sign_in" }, { status: 202 });
  }),

  // Answers identically for a number we know and one we do not. The mock keeps
  // that property on purpose: a mock that 404s an unknown number would let a
  // client ship a branch the real API never takes.
  http.post(url("/auth/otp"), async () =>
    HttpResponse.json(
      { sent: true, expiresIn: 300, devCode: DEV_CODE },
      { status: 202 },
    ),
  ),

  http.post(url("/auth/session"), async ({ request }) => {
    const body = (await request.json()) as { phone?: string; code?: string };
    const phone = (body.phone ?? "").trim();
    /*
      An OFFBOARDED account, which "cannot sign in or use a session"
      (`AccountNotActive`). The right code for the right number, refused
      anyway, with the API's own sentence: the person is fine and the account
      is not. No identity stood in for it, so the sign-in screen's answer to it
      had never run, and it was "try again shortly" (yuvoy-operator#91).
    */
    if (phone === OFFBOARDED_PHONE && body.code === DEV_CODE) {
      return envelope(
        "account_not_active",
        "this account cannot take bookings right now. Talk to us",
        403,
      );
    }
    /*
      Over-attempted, as the contract declares. Five wrong codes and the
      number is throttled — a 429, distinct from the one 401 every wrong,
      expired or used code shares, because "wait a minute" is a different
      next step from "ask for a new one". The mock never modelled it, so the
      client shipped without its 429 branch ever running.
    */
    if ((codeAttempts[phone] ?? 0) >= CODE_ATTEMPT_LIMIT) {
      return envelope(
        "rate_limited",
        "Too many attempts. Wait a minute and try again.",
        429,
      );
    }
    const member = [...team, ...OTHER_MEMBERS, ...signups].find(
      (m) => !m.pending && m.phone === phone,
    );
    /*
      A wrong code and a number nobody on the account owns answer identically.
      `POST /auth/otp` above already refuses to distinguish known numbers from
      unknown ones; a session endpoint that then said "no such user" would give
      back the directory the OTP endpoint carefully withholds.
    */
    if (body.code !== DEV_CODE || !member) {
      codeAttempts[phone] = (codeAttempts[phone] ?? 0) + 1;
      return envelope("unauthorized", "That code did not work.", 401);
    }
    delete codeAttempts[phone];
    return HttpResponse.json(
      {
        token: sessionTokenFor(member.id),
        operatorId: OPERATOR.operatorId,
        expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
      { status: 201 },
    );
  }),

  http.delete(
    url("/auth/session"),
    async () => new HttpResponse(null, { status: 204 }),
  ),

  http.get(url("/me"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const me = sessionUser(request)!;
    const account = accountFor(me);

    return HttpResponse.json({
      id: me.id,
      name: me.name,
      roles: me.roles,
      operatorId: OPERATOR.operatorId,
      /*
        Per-BUSINESS, like `operatorId` beside it — every colleague signed into
        the same account sees the same slug. Always present: `operators.slug`
        is `not null unique`.
      */
      slug: OPERATOR.slug,
      commissionRateBps: OPERATOR.commissionRateBps,
      canManage: canManage(me),
      ...(account ? { account: accountWithFiles(account) } : {}),
    });
  }),

  /* ------------------------------------------------------------- team --- */

  /**
   * What the response actually carries.
   *
   * `phone` is stripped here rather than never stored: the API knows the
   * number — it is how the invitation was sent, and how "a number already
   * belonging to any operator" is refused — and simply does not return it. A
   * mock that returned one would let this portal ship a screen showing a
   * number the real API never sends.
   */
  http.get(url("/team"), async ({ request }) => {
    // Session only. `GET /team` has no role gate in the contract — every role
    // may see who is on the account. The WRITES differ from each other now:
    // inviting is OWNER or ADMIN, removing is still OWNER only.
    const failed = requireSession(request);
    if (failed) return failed;

    /*
      "Present only for a caller who can invite." Modelled rather than sent to
      everybody, because the portal renders the link on exactly that signal —
      a mock that always sent it would let a staff member's screen offer a join
      link and nothing would catch it.
    */
    const roles = sessionUser(request)!.roles;
    const canInvite = roles.includes("OWNER") || roles.includes("ADMIN");

    return HttpResponse.json({
      team: team.map(publicMember),
      ...(canInvite
        ? {
            joinUrl: JOIN_URL,
            joinNote:
              "Send this to anybody you have added. The same link works for all of them, and only for a number you have already invited.",
          }
        : {}),
    });
  }),

  http.post(url("/team"), async ({ request }) => {
    const failed = requireInviter(request);
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;

    const body = (await request.json()) as {
      phone?: string;
      name?: string;
      email?: string;
      role?: string;
    };
    const phone = (body.phone ?? "").trim();
    const name = (body.name ?? "").trim();
    const role = body.role ?? "";
    // Trimmed and lowered, as the API does before it checks the shape.
    const email = (body.email ?? "").trim().toLowerCase();

    /*
      One code, two fields, and `details` says which: the API answers
      `invalid_input` with `{ phone: … }` or `{ email: … }`, and the portal puts
      the sentence on the field it names. The messages are the API's own, lower
      case and all, so the screen's capitalising is exercised.
    */
    if (!/^\+[1-9]\d{7,14}$/.test(phone) || name.length < 2) {
      return envelope(
        "invalid_input",
        "we need their number with the country code",
        400,
        { phone: "for example +919000000101" },
      );
    }
    if (
      email !== "" &&
      (email.length > 254 || !/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(email))
    ) {
      return envelope(
        "invalid_input",
        "that email address does not look right",
        400,
        { email: "for example ramesh@example.com" },
      );
    }

    /*
      `invalid_role` is "pick a role that EXISTS", and `role` may be left out,
      which is STAFF. The four are all valid input; what varies is what they get.
    */
    if (role !== "" && !["OWNER", "ADMIN", "MANAGER", "STAFF"].includes(role)) {
      return envelope("invalid_role", "No such role.", 400);
    }

    /*
      **Everybody joins as STAFF, except an owner** (D15).

      An invitation for ADMIN or MANAGER is "sent, not refused. The response says
      `role: STAFF` and carries a `note` saying so, because a portal built before
      D15 still offers those roles and the person inviting must be told what will
      actually happen."

      Modelled rather than refused, because the difference is invisible unless the
      mock does it: a portal that asked for ADMIN and read back its own request
      would tell an owner they had appointed a stand-in who is in fact staff.
    */
    const granted = role === "OWNER" ? "OWNER" : "STAFF";
    const note =
      role === "ADMIN" || role === "MANAGER"
        ? `They join as staff. You can make them ${role === "ADMIN" ? "an admin" : "a manager"} from their row once they have joined.`
        : undefined;

    /*
      ONE message for every refusal, and the mock keeps it that way on purpose.

      "A number already belonging to any operator is refused with the same
      message as any other failure, so this endpoint cannot be used to find out
      which businesses are on Yuvoy." A mock that distinguished them would let
      this portal ship a branch the real API never takes — and the branch would
      be the enumeration oracle the endpoint exists to avoid being.

      Inviting an OWNER is no longer one of those failures. "An ADMIN may invite
      an owner as well as an OWNER may", because a business whose first person
      runs it has none until somebody invites one.
    */
    const alreadyHere = team.some((m) => !m.pending && m.phone === phone);
    if (alreadyHere) {
      return envelope(
        "cannot_invite",
        "We could not send that invitation.",
        409,
      );
    }

    /*
      "Re-inviting the same number replaces the open invitation rather than
      adding one, so a revoked invite is not undone by an older code still
      lying around."
    */
    team = team.filter((m) => !(m.pending && m.phone === phone));
    team.push({
      id: `inv_${Math.random().toString(36).slice(2, 10)}`,
      name,
      // What accepting will make them, which is not always what was asked for.
      roles: [granted],
      state: "invited",
      pending: true,
      phone,
    });

    /*
      `sent` read back, not asserted (yuvoy-api 67e3213, yuvoy-operator#91).

      There is no WhatsApp sender, so the only thing that can carry an
      invitation is the email address, and with none the message is written
      suppressed: `sent: false`, and a `note` saying to pass the link on. The
      API's own words, and the same override it makes: a role it did not grant
      as asked replaces the note, because that is the sentence the inviter
      must not miss. It asserted `true` for every invitation before, which is
      how an owner came to believe a colleague had been told.
    */
    const sent = email !== "";
    const notSent =
      "We could not send that invitation to them. Give them the join link and the code yourself, or add them again with an email address.";

    /*
      `joinUrl` alongside the queued message, because "on an island the person
      doing the inviting is usually standing next to the person being
      invited". The portal used to drop this, which made inviting somebody a
      dead end for the invitee.
    */
    return HttpResponse.json(
      {
        sent,
        role: granted,
        ...(note ? { note } : sent ? {} : { note: notSent }),
        joinUrl: JOIN_URL,
        devCode: DEV_CODE,
      },
      { status: 202 },
    );
  }),

  /*
    Unauthenticated by design — `security: []` in the contract, because
    accepting an invitation is what somebody does BEFORE they have an account.

    It now DOES mint a session (yuvoy-api#109): "the code they have just proved
    is the same proof a session needs, so this answers with one — the same
    `StartSession` call sign-in makes". Which means the field name changed too:
    `accepted` is gone and `joined` replaced it, on a 201 rather than a 200.
    That is a breaking change and the mock models it exactly, because a mock
    still answering `accepted` would let the portal keep reading a field the
    API no longer sends.
  */
  http.post(url("/team/accept"), async ({ request }) => {
    const body = (await request.json()) as { phone?: string; code?: string };
    const phone = (body.phone ?? "").trim();

    const invite = team.find((m) => m.pending && m.phone === phone);
    if (!invite || body.code !== DEV_CODE) {
      // Wrong code, expired, used, and no invitation for that number all
      // answer 401 with one message — the same rule sign-in follows.
      return envelope("unauthorized", "That code did not work.", 401);
    }

    /*
      The id changes, because it was the INVITATION's id and is now a user's.
      Modelled rather than glossed: a client holding the old id and calling
      DELETE gets a 404, which is exactly what the real API would do.
    */
    invite.id = `usr_${Math.random().toString(36).slice(2, 10)}`;
    invite.pending = false;
    invite.state = "active";

    return HttpResponse.json(
      {
        joined: true,
        token: sessionTokenFor(invite.id),
        user: { id: invite.id, name: invite.name, roles: invite.roles },
        operatorId: OPERATOR.operatorId,
        next: "portal",
      },
      { status: 201 },
    );
  }),

  /* --------------------------------------------------- join by link ----- */

  /**
   * One link per business, not one per invitation.
   *
   * Unauthenticated on purpose: "somebody who is not yet a user has to see who
   * is asking before handing over a phone number." It says which business and
   * nothing else — whoever opened the link has not identified themselves yet.
   */
  http.get(url("/join/:token"), async ({ params }) => {
    if (String(params.token) !== JOIN_TOKEN) {
      return envelope("not_found", "Not a link we recognise.", 404);
    }
    return HttpResponse.json({
      businessName: BUSINESS_NAME,
      next: "code",
    });
  }),

  /**
   * A number nobody invited is refused BEFORE anything is sent.
   *
   * "That this reveals whether a number was invited is deliberate: the
   * alternative is a page that fires one-time codes at any phone somebody
   * types." The mock keeps that property rather than answering identically for
   * known and unknown numbers, because a client built against the softer
   * behaviour would ship a screen that never says the useful thing.
   */
  http.post(url("/join/:token/code"), async ({ request, params }) => {
    if (String(params.token) !== JOIN_TOKEN) {
      return envelope("not_found", "Not a link we recognise.", 404);
    }
    const body = (await request.json()) as { phone?: string };
    const phone = (body.phone ?? "").trim();

    const invite = team.find((m) => m.pending && m.phone === phone);
    if (!invite) {
      return envelope(
        "not_found",
        `No invitation for that number at ${BUSINESS_NAME}. Ask its owner or an admin to add it.`,
        404,
      );
    }

    /*
      One fixture number already works elsewhere, so the "this takes you off
      another business" path is reachable. Without it that panel — and the
      `confirmLeaving` it gates — would never render in any test.
    */
    const leaving =
      phone === LEAVING_PHONE ? "Havelock Water Sports" : undefined;

    return HttpResponse.json(
      {
        sent: true,
        businessName: BUSINESS_NAME,
        role: invite.roles[0] ?? "STAFF",
        name: invite.name,
        ...(leaving
          ? {
              leavingBusiness: leaving,
              note: `One number works with one business at a time. Joining ${BUSINESS_NAME} ends your access to ${leaving} straight away, including on any device already signed in.`,
            }
          : {}),
        devCode: DEV_CODE,
      },
      { status: 202 },
    );
  }),

  http.post(url("/join/:token/accept"), async ({ request, params }) => {
    if (String(params.token) !== JOIN_TOKEN) {
      return envelope("not_found", "Not a link we recognise.", 404);
    }
    const body = (await request.json()) as {
      phone?: string;
      code?: string;
      confirmLeaving?: boolean;
    };
    const phone = (body.phone ?? "").trim();

    const invite = team.find((m) => m.pending && m.phone === phone);
    if (!invite) {
      return envelope("not_found", "No invitation for that number.", 404);
    }
    if (body.code !== DEV_CODE) {
      return envelope("unauthorized", "That code did not work.", 401);
    }

    /*
      The 409 that is not a failure. Modelled rather than skipped: it is the
      authoritative "ask them first", and a client that only handled the
      advisory `leavingBusiness` from the code step would send an unconfirmed
      accept and show an error for it.
    */
    if (phone === LEAVING_PHONE && !body.confirmLeaving) {
      return envelope(
        "confirmation_required",
        "This number works with another business. Confirm to leave it.",
        409,
      );
    }

    // The id changes, because it was the INVITATION's id and is now a user's.
    invite.id = `usr_${Math.random().toString(36).slice(2, 10)}`;
    invite.pending = false;
    invite.state = "active";

    /*
      The session, same as `/team/accept` (yuvoy-api#109). Both doors into a
      team now agree about what accepting gets you — which is the whole reason
      the API added it to both rather than one.
    */
    return HttpResponse.json(
      {
        joined: true,
        token: sessionTokenFor(invite.id),
        user: { id: invite.id, name: invite.name, roles: invite.roles },
        operatorId: OPERATOR.operatorId,
        next: "portal",
      },
      { status: 201 },
    );
  }),

  /* ------------------------------------------------------------ media --- */

  /* -------------------------------------------------- profile & documents - */

  /**
   * The business behind the account.
   *
   * `missing` is DERIVED here rather than stored, the same way the API derives
   * it: a stored list is a second copy of the truth that goes stale the moment
   * somebody fills a field in. The names match the PUT's own field names, so a
   * form can mark the row it is about to ask for.
   */
  http.get(url("/profile"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    return HttpResponse.json(profileResponse());
  }),

  /**
   * Save the whole document.
   *
   * Modelled as a REPLACE, not a merge — "a whole document, not a patch of
   * single fields … partial writes would leave it half-saved in ways the
   * completeness check then has to reason about." A mock that merged would let
   * a client ship a form that omits a field and never notice it was cleared.
   */
  http.put(url("/profile"), async ({ request }) => {
    const failed = requireManager(
      request,
      "only an owner, admin or manager can change the business details",
    );
    if (failed) return failed;

    const body = (await request.json()) as Record<string, string | undefined>;
    const required = [
      "legalName",
      "entityType",
      "addressLine1",
      "locality",
      "region",
      "postalCode",
    ];
    for (const field of required) {
      if (!String(body[field] ?? "").trim()) {
        return envelope("invalid_input", `${field} is required.`, 400);
      }
    }
    const ENTITIES = [
      "sole_proprietor",
      "partnership",
      "llp",
      "private_limited",
      "society",
      "trust",
    ];
    if (!ENTITIES.includes(String(body.entityType))) {
      return envelope("invalid_input", "Not an entity type we know.", 400);
    }
    // 15 characters, or absent. The checksum is the server's business.
    if (body.gstin !== undefined && String(body.gstin).trim().length !== 15) {
      return envelope("invalid_input", "A GSTIN is 15 characters.", 400);
    }

    /*
      A LIVE business's change is RECORDED FOR REVIEW, not applied (D-032.3):
      the verified documents were checked against the name and address on
      file. 202 with no details, exactly as the API answers, and after the
      validation above, which the API also runs first. Nothing on file
      changes, so `GET /profile` goes on answering with the old details, and
      the change is listed on `GET /change-requests` as `profile`, pending. The `409
      details_locked` this replaced is no longer returned (yuvoy-api#222).
    */
    if (isLiveBusiness(sessionUser(request)!)) {
      fileForReview(request, "profile", "Registered name and address");
      return HttpResponse.json(
        {
          state: "in_review",
          next: "We check a change to your registered name or address, because your verified documents were checked against what is on file. Your current details stay in place until we do.",
        },
        { status: 202 },
      );
    }

    profile = {
      ...profile,
      legalName: body.legalName,
      entityType: body.entityType,
      gstin: body.gstin,
      address: {
        line1: body.addressLine1,
        line2: body.addressLine2,
        locality: body.locality,
        region: body.region,
        postalCode: body.postalCode,
        country: body.country ?? "IN",
      },
      submittedAt: new Date().toISOString(),
    };

    return HttpResponse.json(profileResponse());
  }),

  /**
   * File a document.
   *
   * **Always lands `pending`**, whatever the request says. "The state is fixed
   * server-side … a self-service path to `verified` would make the credential
   * gate decorative." A mock that honoured a client-supplied state would let
   * exactly that ship.
   *
   * Sending the same kind twice replaces rather than stacks, which the screen
   * warns about before the tap.
   */
  http.post(url("/credentials"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const body = (await request.json()) as Record<string, string | undefined>;
    const type = String(body.type ?? "");
    const KINDS = [
      "directorate_registration",
      "instructor_cert",
      "oxygen",
      "equipment",
      "boat",
      "insurance",
      "bank",
      "gst",
    ];
    if (!KINDS.includes(type)) {
      return envelope("invalid_input", "Not a document kind we know.", 400);
    }

    // Replaces, never stacks.
    filedCredentials[type] = { state: "pending", expiresOn: body.expiresOn };

    return HttpResponse.json(
      { type, state: "pending", next: "we_check_it" },
      { status: 201 },
    );
  }),

  /* ------------------------------------------------- notifications ------ */

  http.get(url("/me/notifications"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    return HttpResponse.json(switchesFor(sessionUser(request)!));
  }),

  http.put(url("/me/notifications"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const me = sessionUser(request)!;
    const body = (await request.json()) as {
      switches?: { group?: string; on?: unknown }[];
    };
    const refusal = applySwitches(me, me, body.switches);
    return refusal ?? HttpResponse.json(switchesFor(me));
  }),

  http.get(url("/team/:id/notifications"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    /*
      OWNER or ADMIN, and NOT `canManage` — the narrowest gate on these routes.
      "An owner and an admin control everybody's switches, and each person
      controls their own." A MANAGER has `canManage` and is refused here, which
      is why the mock cannot reuse `requireManager`.
    */
    const roles = sessionUser(request)!.roles;
    if (!roles.includes("OWNER") && !roles.includes("ADMIN")) {
      return envelope(
        "forbidden",
        "Only an owner or an admin can see somebody else's notifications.",
        403,
      );
    }
    const target = team.find((m) => m.id === String(params.id) && !m.pending);
    // A pending row is an invitation, not a person, and answers 404 like any
    // other id that names nobody.
    if (!target) return envelope("not_found", "No such member.", 404);
    return HttpResponse.json(switchesFor(target));
  }),

  http.put(url("/team/:id/notifications"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const me = sessionUser(request)!;
    if (!me.roles.includes("OWNER") && !me.roles.includes("ADMIN")) {
      return envelope(
        "forbidden",
        "Only an owner or an admin can change somebody else's notifications.",
        403,
      );
    }
    const target = team.find((m) => m.id === String(params.id) && !m.pending);
    if (!target) return envelope("not_found", "No such member.", 404);

    const body = (await request.json()) as {
      switches?: { group?: string; on?: unknown }[];
    };
    const refusal = applySwitches(me, target, body.switches);
    return refusal ?? HttpResponse.json(switchesFor(target));
  }),

  /* ------------------------------------------------- document files ----- */

  /**
   * Sign a URL for the file behind a document — yuvoy-operator#46 item 3.
   *
   * "Only a pending document takes a file", which is the refusal the portal
   * withholds the control for; modelled anyway, because the control is withheld
   * on a render and the decision can change between that and the tap.
   */
  http.post(
    url("/credentials/:id/upload-intents"),
    async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      /*
        A service with no documents store, which is production today: every
        upload intent answers `503 documents_unavailable` before anything else
        is looked at (yuvoy-operator#93). Stood in for by the business waiting
        on our review, the one identity whose pending document no upload test
        needs to reach the bucket.
      */
      if (sessionUser(request)?.id === AWAITING_ID) {
        return envelope(
          "documents_unavailable",
          "we cannot take documents just yet",
          503,
        );
      }
      /*
        NOT `requireWritable`. A suspended business may still send a document
        (#50), and refusing here would hold an operator at a state they are
        being asked to clear.
      */

      const credentialId = String(params.id);
      const body = (await request.json()) as {
        filename?: string;
        contentType?: string;
        sizeBytes?: number;
      };

      const KINDS = ["application/pdf", "image/jpeg", "image/png"];
      if (!KINDS.includes(String(body.contentType))) {
        return envelope("invalid_input", "PDF, JPEG or PNG.", 400);
      }
      if (
        !Number.isInteger(body.sizeBytes) ||
        (body.sizeBytes ?? 0) <= 0 ||
        (body.sizeBytes ?? 0) > 10 * 1024 * 1024
      ) {
        return envelope("invalid_input", "Up to 10 MB.", 400);
      }

      /*
        A document already verified or rejected is locked, whether it was so
        when the page rendered or became so while the operator was picking a
        file: "a new file behind it would change the evidence under a decision
        nobody re-made."
      */
      const credential = credentialOf(credentialId);
      if (credential && credential.state !== "pending") {
        return envelope(
          "document_locked",
          "This document has already been checked, so its file cannot change. File it again to send a different one.",
          409,
        );
      }

      const intentId = `int_${Math.random().toString(36).slice(2, 10)}`;
      documentIntents[intentId] = {
        credentialId,
        filename: String(body.filename ?? "document"),
        contentType: String(body.contentType),
        sizeBytes: Number(body.sizeBytes),
      };

      return HttpResponse.json(
        {
          intentId,
          /*
            A DIFFERENT ORIGIN, as production is: "the file never passes through
            this API". MSW runs in the Next process here, so a same-origin URL
            would be intercepted and the browser's cross-origin upload — the
            one the CSP's `connect-src` actually governs — would never happen.
          */
          uploadUrl: `http://127.0.0.1:${MOCK_TUS_PORT}/documents/${intentId}`,
          method: "PUT",
          /*
            Signed headers, sent back "exactly as given". The metadata is what
            `complete` looks for to know a URL minted here signed this file.
          */
          headers: {
            "Content-Type": String(body.contentType),
            "x-amz-meta-intent": intentId,
            "x-amz-meta-credential": credentialId,
          },
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          maxBytes: 10 * 1024 * 1024,
          next: "send_the_file",
        },
        { status: 201 },
      );
    },
  ),

  /**
   * Ask the bucket what actually arrived — yuvoy-operator#46 item 3.
   *
   * Every refusal here is modelled, because each is a different next step on
   * screen and none of them would ever run against a mock that took the
   * browser's word: the file that never arrived, the intent already used, and
   * the file that is not the size it declared.
   */
  http.post(
    url("/credentials/:id/upload-intents/:intentId/complete"),
    async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      const credentialId = String(params.id);
      const intentId = String(params.intentId);
      const intent = documentIntents[intentId];
      if (!intent || intent.credentialId !== credentialId) {
        return envelope("not_found", "No such upload.", 404);
      }
      if (intent.closed) {
        return envelope(
          "upload_closed",
          "That upload was refused or replaced. Start a new one.",
          409,
        );
      }

      const arrived = mockDocumentArrived(intentId);
      if (!arrived) {
        // "The file has not reached the bucket yet, so send it first."
        return envelope(
          "upload_not_arrived",
          "The file has not reached us yet.",
          409,
        );
      }
      if (arrived.bytes !== intent.sizeBytes) {
        /*
          Closed, and the retention sweep deletes it: "a file this refuses is
          closed … start a new upload to send another." So the intent cannot be
          completed a second time, which is what makes `upload_closed` reachable.
        */
        intent.closed = true;
        return HttpResponse.json(
          {
            error: {
              code: "document_refused",
              message: "That file is not the size it said it was.",
              details: { reason: "size_mismatch" },
            },
          },
          { status: 400 },
        );
      }

      const replacedPrevious = Boolean(documentFiles[credentialId]);
      documentFiles[credentialId] = {
        filename: intent.filename,
        sizeBytes: intent.sizeBytes,
        contentType: intent.contentType,
      };

      /*
        "Called again after it succeeded, it answers the same thing again." The
        intent is NOT closed here, so a retry on a dropped response is answered
        rather than refused.
      */
      return HttpResponse.json({
        credentialId,
        hasFile: true,
        filename: intent.filename,
        sizeBytes: intent.sizeBytes,
        contentType: intent.contentType,
        replacedPrevious,
        next: "we_check_it",
      });
    },
  ),

  /* ------------------------------------------------------------ story --- */

  /**
   * The business's own story — yuvoy-operator#41. The API's shapes, and its
   * lower-case sentences, so the screen's reading of both is exercised.
   */
  http.get(url("/story"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    return HttpResponse.json(storyResponse());
  }),

  /**
   * What travellers said (yuvoy-api#185). Nothing has been published, which
   * agrees with the `stats.rating` above: "published reviews only, so
   * `summary` and `stats.rating` always agree". Unmocked, the Reviews tab had
   * only ever said it did not load.
   */
  http.get(url("/reviews"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    return HttpResponse.json({
      summary: {
        averageRating: null,
        count: 0,
        tags: {
          guide: 0,
          safety: 0,
          value: 0,
          organisation: 0,
          punctuality: 0,
          equipment: 0,
        },
      },
      items: [],
      complete: true,
    });
  }),

  http.put(url("/story"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    /*
      `403 account_suspended`, which this write declares: a suspended business
      reads its story and its clips and may not change them (yuvoy-operator#90
      f13). Modelled so the portal's answer to it runs.
    */
    const shut = requireWritable(request);
    if (shut) return shut;

    const body = (await request.json().catch(() => null)) as {
      about?: unknown;
      languages?: unknown;
    } | null;
    if (!body || typeof body !== "object") {
      return envelope("invalid_input", "we could not read that", 400);
    }

    /*
      The API's order and the API's arithmetic: trim, then Go's `len`, which
      counts bytes. A mock that counted characters would pass a paragraph
      production refuses, and the screen's own count would never meet it.
    */
    const about = typeof body.about === "string" ? body.about.trim() : "";
    const size = new TextEncoder().encode(about).length;
    if (about !== "" && (size < 40 || size > 600)) {
      return envelope(
        "invalid_input",
        "we cannot use that: tell them 40 to 600 characters about the business",
        400,
      );
    }
    const languages = Array.isArray(body.languages)
      ? body.languages.map((l) => String(l))
      : [];
    // Counted BEFORE blanks and repeats go — the API's own order.
    if (languages.length > 8) {
      return envelope(
        "invalid_input",
        "we cannot use that: at most eight languages",
        400,
      );
    }
    const seen = new Set<string>();
    story.about = about;
    story.languages = languages
      .map((l) => l.trim())
      .filter((l) => {
        if (!l || seen.has(l)) return false;
        seen.add(l);
        return true;
      });
    return HttpResponse.json(storyResponse());
  }),

  /**
   * The LOGO's upload slot. Owner and manager only, because a logo is the
   * business's mark.
   *
   * A story photograph used to ride this one, on the issue's original
   * instruction. It is gated differently and that gate is modelled here, so a
   * portal that went back to using it for photographs would fail a staff
   * member's test rather than a staff member (yuvoy-operator#41).
   */
  http.post(url("/logo/upload-intents"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const denied = requireManager(
      request,
      "Only an owner, admin or manager can change the logo.",
    );
    if (denied) return denied;

    return HttpResponse.json(imageIntent(), { status: 201 });
  }),

  /**
   * The mark in use. `logoUrl` absent when there is none, as the contract
   * says; never the pending one, which is not up yet.
   */
  http.get(url("/logo"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    if (!logo) return HttpResponse.json({});
    return HttpResponse.json({
      imageId: logo.imageId,
      logoUrl: mockLogoUrl(logo.imageId),
      uploadedAt: logo.uploadedAt,
    });
  }),

  /**
   * Set the logo, the way the API does (`operator_logo.go` at e7291e3):
   *
   *   - OWNER, ADMIN or MANAGER only.
   *   - The HOST is asked whether the file arrived, not the browser: an id the
   *     mock image host never received is a 400.
   *   - A LIVE business's new mark is RECORDED FOR REVIEW: `202 { state:
   *     "in_review", next }` and deliberately no `logoUrl`, because the old
   *     logo is still the live one (D-032.3). `GET /logo` goes on answering
   *     with the old mark, and the new one is listed on `GET
   *     /change-requests` as `logo`, pending. Declared under `GET /logo` in
   *     the contract rather than here (yuvoy-api#222).
   *   - Anybody else's is applied: `200 { logoUrl }`.
   */
  http.put(url("/logo"), async ({ request }) => {
    const denied = requireManager(
      request,
      "only an owner, admin or manager can change the logo",
    );
    if (denied) return denied;

    const body = (await request.json().catch(() => ({}))) as {
      imageId?: unknown;
    };
    const imageId = typeof body.imageId === "string" ? body.imageId.trim() : "";
    if (!imageId) return envelope("invalid_input", "which image?", 400);
    if (!mockPhotoArrived(imageId)) {
      return envelope(
        "invalid_input",
        "that upload has not arrived. Post the file to the upload URL first",
        400,
      );
    }

    if (isLiveBusiness(sessionUser(request)!)) {
      fileForReview(request, "logo", "New logo");
      return HttpResponse.json(
        {
          state: "in_review",
          next: "We look at a new logo before it appears on your reels and listings. Your current one stays up until we do.",
        },
        { status: 202 },
      );
    }

    logo = { imageId, uploadedAt: new Date().toISOString() };
    return HttpResponse.json({ logoUrl: mockLogoUrl(imageId) });
  }),

  /**
   * The STORY's own upload slot — yuvoy-api#161.
   *
   * Open to every operator role, which is the same set that may edit the
   * story. Session only, and deliberately no `requireManage`: that difference
   * from the logo's slot above is the whole reason this endpoint exists.
   */
  http.post(url("/story/photos/upload-intents"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    /*
      `403 account_suspended`, which this write declares: a suspended business
      reads its story and its clips and may not change them (yuvoy-operator#90
      f13). Modelled so the portal's answer to it runs.
    */
    const shut = requireWritable(request);
    if (shut) return shut;

    return HttpResponse.json(imageIntent(), { status: 201 });
  }),

  http.post(url("/story/photos"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    /*
      `403 account_suspended`, which this write declares: a suspended business
      reads its story and its clips and may not change them (yuvoy-operator#90
      f13). Modelled so the portal's answer to it runs.
    */
    const shut = requireWritable(request);
    if (shut) return shut;

    const body = (await request.json().catch(() => ({}))) as {
      imageId?: unknown;
    };
    const imageId = typeof body.imageId === "string" ? body.imageId.trim() : "";
    if (!imageId) {
      return envelope("invalid_input", "we could not read that image", 400);
    }

    /*
      Already theirs? The same photograph back, BEFORE looking for a slot —
      otherwise "a double tap on a wet phone would be told the gallery is
      full". And, like the API, nothing here asks the host whether the file
      arrived; that is the uploader's job until the API does it.
    */
    const existing = story.photos.find((p) => p.imageId === imageId);
    if (existing) {
      return HttpResponse.json(storyPhotoJson(existing), { status: 201 });
    }

    // The lowest free slot, so removing the third and adding one fills it.
    const taken = new Set(story.photos.map((p) => p.position));
    const position = [1, 2, 3, 4, 5].find((n) => !taken.has(n));
    if (position === undefined) {
      return envelope(
        "conflict",
        "you already have five photographs — remove one first",
        409,
      );
    }

    const photo: MockStoryPhoto = {
      id: `sph_${Math.random().toString(36).slice(2, 10)}`,
      imageId,
      position,
    };
    story.photos = [...story.photos, photo].sort(
      (a, b) => a.position - b.position,
    );
    return HttpResponse.json(storyPhotoJson(photo), { status: 201 });
  }),

  http.delete(url("/story/photos/:id"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    /*
      `403 account_suspended`, which this write declares: a suspended business
      reads its story and its clips and may not change them (yuvoy-operator#90
      f13). Modelled so the portal's answer to it runs.
    */
    const shut = requireWritable(request);
    if (shut) return shut;

    // Another business's photograph answers exactly as one that does not
    // exist; here there is only one business, so absent is the whole test.
    const id = String(params.id);
    if (!story.photos.some((p) => p.id === id)) {
      return envelope("not_found", "we could not find that photograph", 404);
    }
    story.photos = story.photos.filter((p) => p.id !== id);
    return new HttpResponse(null, { status: 204 });
  }),

  /* ------------------------------------------------------ photographs --- */

  /**
   * A slot to upload a photograph into.
   *
   * **No single-slot quota**, unlike the clip intent: the contract declares no
   * `409` here, so an operator adding a row of photographs is not fighting
   * their own uploads. A mock that borrowed the clip's slot rule would make
   * the screen build a queue nobody asked for.
   *
   * `maxBytes` is 5 MB where the host allows 10 — ours, deliberately, because
   * "a 10 MB photograph on a listing costs the traveller the download on
   * island 4G". The client reads it off this response rather than hardcoding.
   */
  http.post(url("/media/photo-intents"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    /*
      `experienceId` is REQUIRED here, unlike the clip route — migration 0058.
      Modelled rather than waved through: a mock that accepts a body the API
      refuses lets a client ship without ever sending the field, and the first
      anybody would learn of it is a 400 in production.

      A listing that is not this operator's answers 404, indistinguishable
      from one that does not exist.
    */
    const body = (await request.json().catch(() => ({}))) as {
      experienceId?: string;
      role?: string;
    };
    const experienceId = String(body.experienceId ?? "");
    if (!experienceId) {
      return envelope("invalid_input", "Name the listing first.", 400);
    }
    if (!mockExperiences.some((e) => e.id === experienceId)) {
      return envelope("not_found", "No such listing.", 404);
    }
    if (body.role && body.role !== "hero" && body.role !== "gallery") {
      return envelope("invalid_input", "role is hero or gallery.", 400);
    }

    /*
      Keyed by the BUSINESS, not the user. The 404 this protects is about one
      operator finishing another's upload, and every fixture user here belongs
      to the same business — so the check is modelled against the one operator
      id the mock has rather than invented per user.
    */
    const imageId = `img_${Math.random().toString(36).slice(2, 10)}`;
    const intentId = `pin_${Math.random().toString(36).slice(2, 10)}`;
    photoIntents[imageId] = { operatorId: OPERATOR.operatorId };
    photoIntentsById[intentId] = { imageId };

    return HttpResponse.json(
      {
        // The row recording WHICH LISTING this upload is for. It is what
        // carries the listing across the upload; `imageId` names none.
        intentId,
        imageId,
        // A DIFFERENT ORIGIN. Bytes never pass through this API.
        uploadUrl: `http://127.0.0.1:${MOCK_TUS_PORT}/photos/${imageId}`,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        maxBytes: 5 * 1024 * 1024,
        next: "upload_then_complete",
      },
      { status: 201 },
    );
  }),

  /**
   * Confirm the photograph arrived — by asking the HOST, not the client.
   *
   * "The host is asked whether the file arrived and who it belongs to; the
   * client is not believed about either." Both halves are modelled:
   *
   *   - the file must actually be at the mock image host (`mockPhotoArrived`),
   *     or this answers `400` — a browser that says it finished cannot mint a
   *     media asset out of a failed upload;
   *   - an id minted for another operator answers `404`, the SAME as one that
   *     does not exist, because "telling somebody that image exists but is not
   *     yours confirms it exists."
   */
  http.post(url("/media/photo-intents/complete"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    /*
      "One of the two. `intentId` is the form to use: it names the row carrying
      which listing this photograph is for." `imageId` is the compatibility
      form the contract keeps permanently, for a photograph minted before the
      listing was chosen at upload.
    */
    const completeBody = (await request.json()) as {
      imageId?: string;
      intentId?: string;
    };
    const imageId = String(
      completeBody.intentId
        ? (photoIntentsById[completeBody.intentId]?.imageId ?? "")
        : (completeBody.imageId ?? ""),
    );

    const slot = photoIntents[imageId];
    const mine = slot && slot.operatorId === OPERATOR.operatorId;
    if (!slot || !mine) {
      return envelope("not_found", "No such upload.", 404);
    }

    if (!mockPhotoArrived(imageId)) {
      return envelope(
        "invalid_input",
        "The upload has not arrived at the host yet.",
        400,
      );
    }

    /*
      From here it is an ordinary media asset — it "appears in `GET /media`
      like any other". `ready` rather than `attested`: the rights attestation
      is the operator's next act, exactly as it is for a clip, and a mock that
      skipped it would let a screen ship that skips it too.
    */
    const mediaAssetId = `med_${Math.random().toString(36).slice(2, 10)}`;
    mediaAssets[mediaAssetId] = {
      attested: false,
      kind: "image",
      state: "ready",
      // A photograph HAS a picture from the moment it arrives: the API builds
      // the URL from configuration at read time rather than storing one, so
      // there is no state in which an image row is missing its own picture.
      posterUrl: FIXTURE_POSTER,
    };
    delete photoIntents[imageId];

    return HttpResponse.json({ mediaAssetId, next: "attest_rights" });
  }),

  /* ------------------------------------------------------- vocabulary ---- */

  /**
   * What may go in a listing's category and destination — yuvoy-api#113.
   *
   * Scoped to the operator's own market with no market parameter, exactly as
   * the contract describes: "destinations from another market are refused on
   * create, so offering them would be offering a choice that cannot work."
   *
   * Every key here is one `POST /experiences` accepts, and the destinations
   * match the prefix that endpoint validates — a mock offering a value its own
   * create would reject is worse than no mock at all.
   */
  http.get(url("/catalog/vocabulary"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    return HttpResponse.json({
      market: { key: "andaman", name: "Andaman Islands" },
      /*
        The health screeners a listing's `screenerKey` may name — yuvoy-api#180.
        One today, and the set grows by INSERT: "the same read decides which
        keys a listing write accepts, so every key offered here is accepted and
        any other key is a 400."
      */
      screeners: [{ key: "diving_rstc", label: "Diving health check (RSTC)" }],
      categories: [
        { key: "adventure", label: "Adventure" },
        { key: "nature_wildlife", label: "Nature & wildlife" },
        { key: "food_drink", label: "Food & drink" },
        { key: "arts_creativity", label: "Arts & creativity" },
        { key: "learning", label: "Learning" },
        { key: "culture_heritage", label: "Culture & heritage" },
        { key: "wellness", label: "Wellness" },
        { key: "entertainment", label: "Entertainment" },
        { key: "community", label: "Community" },
        { key: "sports", label: "Sports" },
        { key: "local_life", label: "Local life" },
        { key: "events", label: "Events" },
      ],
      /*
        What a listing IS, narrowed per market — yuvoy-operator#30 §2. Each
        carries its parent category, and the pair is enforced by a composite
        foreign key upstream, so a picker MUST filter by the chosen category:
        `scuba` under `food_drink` is a 400.
      */
      activityTypes: [
        { key: "scuba", label: "Scuba diving", category: "adventure" },
        { key: "snorkelling", label: "Snorkelling", category: "adventure" },
        {
          key: "private_charter",
          label: "Private charter",
          category: "adventure",
        },
        {
          key: "birdwatching",
          label: "Birdwatching",
          category: "nature_wildlife",
        },
        {
          key: "mangrove_kayak",
          label: "Mangrove kayaking",
          category: "nature_wildlife",
        },
      ],
      destinations: [
        { key: "andaman/havelock", label: "Havelock (Swaraj Dweep)" },
        { key: "andaman/neil", label: "Neil (Shaheed Dweep)" },
        { key: "andaman/port_blair", label: "Port Blair" },
      ],
    });
  }),

  http.get(url("/experiences"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    /*
      ONE IDENTITY MAKES THIS CALL FAIL — yuvoy-operator#32.

      `/calendar` reads two endpoints: `GET /slots` for the fortnight it edits,
      and this one for the departure picker's listings. The interesting failure
      is not "the API is down", which takes both with it: it is ONE call
      failing while the other works, which is the case that decides whether the
      screen degrades or disappears.

      The refusal used to sit on a ±120-day `GET /slots` read, because that is
      where the listings came from before this issue. The endpoint moved and
      the fixture moved with it; what is being modelled is unchanged.
    */
    if (sessionUser(request)?.id === WIDE_READ_FAILS_ID) {
      return envelope("internal_error", "Something went wrong.", 500);
    }
    return HttpResponse.json({
      experiences: mockExperiences.map((e) => ({
        ...e,
        bookableDatesNext30Days: bookableDatesOf(e),
        departuresNotOnSale: unconfirmedDeparturesOf(e),
        departuresGoingOffSaleSoon: 0,
      })),
    });
  }),

  /**
   * Write a new listing. Lands as a DRAFT and reaches nobody.
   *
   * The defaults are the API's, not the form's — "party size 6, `per_person`,
   * `request` mode, 120 minutes" — so a minimal create here produces the same
   * listing the real one would, and a form that quietly re-sent its own
   * defaults would show up as a difference.
   */
  http.post(url("/experiences"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;

    const body = (await request.json()) as Record<string, unknown>;
    const title = String(body.title ?? "").trim();
    const category = String(body.category ?? "").trim();
    const destination = String(body.destination ?? "").trim();

    if (!title || !category || !destination) {
      return envelope(
        "invalid_input",
        "A title, a category and a destination.",
        400,
      );
    }

    /*
      "A destination key in your own market. One belonging to another market is
      refused." Modelled, because it is the single most likely 400 an operator
      will meet — the portal cannot enumerate destinations, so they type one —
      and the screen renders the API's own sentence for exactly this case.
    */
    if (!destination.startsWith("andaman/")) {
      return envelope(
        "invalid_input",
        `"${destination}" is not a place in your market. Yours all start with "andaman/".`,
        400,
      );
    }

    const slug =
      String(body.slug ?? "").trim() ||
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    if (mockExperiences.some((e) => e.slug === slug)) {
      return envelope("conflict", "That slug is taken.", 409);
    }

    const priceRaw = body.unitPricePaise;
    const unitPricePaise =
      typeof priceRaw === "number" && priceRaw > 0 ? priceRaw : null;

    const created: MockExperience = {
      id: `exp_${Math.random().toString(36).slice(2, 10)}`,
      slug,
      title,
      category,
      destination,
      summary: body.summary ? String(body.summary) : undefined,
      description: body.description ? String(body.description) : undefined,
      /*
        Stored, which it was not. The create form has sent `activityType` since
        yuvoy-operator#30 §2 and this handler dropped it on the floor, so a
        listing created here came back without one and `publishBlockers` named
        it forever. Invisible until the builder started deriving which step to
        open from that list, and then it opened Basics over a field the operator
        had already answered.
      */
      activityType: body.activityType ? String(body.activityType) : undefined,
      status: "draft",
      publicationState: "draft",
      bookingMode: String(body.bookingMode ?? "request"),
      durationMinutes: Number(body.durationMinutes ?? 120),
      maxPartySize: Number(body.maxPartySize ?? 6),
      unitPricePaise,
      pricingUnit: String(body.pricingUnit ?? "per_person"),
      // Stated only when somebody said so. The column has a default; the answer
      // does not.
      pricingUnitStated:
        typeof body.pricingUnit === "string" && !!body.pricingUnit,
      inclusions: Array.isArray(body.inclusions)
        ? (body.inclusions as string[])
        : undefined,
      requirements: Array.isArray(body.requirements)
        ? (body.requirements as string[])
        : undefined,
      safetyNotes: body.safetyNotes ? String(body.safetyNotes) : undefined,
      /*
        Absent and empty are one thing, as they are to the API: "an absent key
        and an empty string mean the same thing", so an omitted key stores
        undefined rather than "".
      */
      screenerKey: body.screenerKey ? String(body.screenerKey) : undefined,
      upcomingDepartures: 0,
      // "A listing without `unitPricePaise` can be saved but cannot be
      // approved, which the response reports as `sellable: false`."
      sellable: unitPricePaise !== null,
    };
    /*
      What it is still missing, from the moment it exists. It was left off, and
      the consequence was invisible until the builder read it: a brand-new draft
      reported nothing outstanding, so reopening it landed on Review with five
      mandatory fields empty.
    */
    created.publishBlockers = draftBlockers(created);
    mockExperiences.push(created);

    return HttpResponse.json(
      { id: created.id, status: "draft", next: "submit_for_review" },
      { status: 201 },
    );
  }),

  /**
   * One listing and everything attached to it — yuvoy-operator#56 item 6.
   *
   * The whole point of the endpoint is that it is ONE request: "building a
   * listing meant fetching the whole calendar and the whole media library to
   * find the handful of rows that belong to it. On island 4G that is three
   * requests and most of a business's data to render one screen."
   */
  http.get(url("/experiences/:id/workspace"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const id = String(params.id);
    const listing = mockExperiences.find((e) => e.id === id);
    // Gone and belonging-to-somebody-else are one answer, as everywhere else.
    if (!listing) return envelope("not_found", "No such listing.", 404);

    /*
      "Its own departures that have NOT YET LEFT, soonest first." A departure
      that has gone is read from `GET /slots` with a date range, so a mock that
      sent them here would let the hub ship a list of boats nobody can act on.
    */
    const departures = allSlots()
      .filter(
        (slot) =>
          slot.experienceId === id && Date.parse(slot.startsAt) > Date.now(),
      )
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      .slice(0, 200)
      .map((slot) => {
        const seats = capacity[slot.id] ?? slot.seats;
        const sold = slot.sold + (offlineSold[slot.id] ?? 0);
        return {
          id: slot.id,
          experienceId: slot.experienceId,
          title: slot.title,
          startsAt: slot.startsAt,
          timezone: slot.timezone,
          seats,
          sold,
          remaining: Math.max(0, seats - sold),
          ...(slot.bookingMode ? { bookingMode: slot.bookingMode } : {}),
          status: slotStatusOf(slot),
          ...saleVerdictOf(slot, seats, sold),
        };
      });

    return HttpResponse.json({
      listing: {
        ...listing,
        // The single listing carries these too (yuvoy-api#205, #211).
        bookableDatesNext30Days: bookableDatesOf(listing),
        departuresNotOnSale: unconfirmedDeparturesOf(listing),
        departuresGoingOffSaleSoon: 0,
      },
      departures,
      /*
        The listing's own media, matched on the NESTED `listing.experienceId`
        that `OperatorMedia` actually carries.
      */
      media: Object.entries(mediaAssets)
        .filter(([, asset]) => asset.listing?.experienceId === id)
        .map(([mediaId, asset]) => ({
          id: mediaId,
          kind: asset.kind,
          state: asset.state,
          ...(asset.posterUrl ? { posterUrl: asset.posterUrl } : {}),
          listing: asset.listing,
          situation: situationOf(asset),
        })),
      /*
        The listing's own questions, "exactly as `GET /experiences/{id}/questions`
        returns it". It was a hardcoded empty list, which meant the builder's
        Questions step could never show a question it had just saved and the
        Review step counted none no matter what was there.
      */
      questions: listingQuestions[id] ?? [],
    });
  }),

  /**
   * Save the whole weekly schedule — yuvoy-operator#56 item 8.
   *
   * Whole, which is what makes an empty save dangerous: a row left out is a row
   * removed. The mock records it so the hub reads back what it saved, and
   * answers the `note` the screen renders verbatim.
   */
  http.put(url("/experiences/:id/schedule"), async ({ request, params }) => {
    const failed = requireManager(request, "Requires OWNER, ADMIN or MANAGER.");
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;

    const listing = mockExperiences.find((e) => e.id === String(params.id));
    if (!listing) return envelope("not_found", "No such listing.", 404);

    const body = (await request.json()) as {
      weekly?: { weekday?: number; startTime?: string; seats?: number }[];
    };
    const weekly = body.weekly ?? [];

    /*
      `details` names the row AND the field — keys like `weekly[2].startTime` —
      so a form can mark that row rather than printing one sentence above seven
      of them. Modelled, because a mock that answered a bare 400 would let the
      portal ship without ever rendering a row problem.
    */
    const details: Record<string, string> = {};
    weekly.forEach((row, i) => {
      if (
        !Number.isInteger(row.weekday) ||
        (row.weekday ?? -1) < 0 ||
        (row.weekday ?? 7) > 6
      ) {
        details[`weekly[${i}].weekday`] = "Sunday to Saturday, as 0 to 6.";
      }
      if (!/^\d{2}:\d{2}$/.test(String(row.startTime))) {
        details[`weekly[${i}].startTime`] = "Times look like 07:00.";
      }
      if (
        !Number.isInteger(row.seats) ||
        (row.seats ?? 0) < 1 ||
        (row.seats ?? 0) > 200
      ) {
        details[`weekly[${i}].seats`] = "Seats are 1 to 200.";
      }
    });
    if (Object.keys(details).length > 0) {
      return HttpResponse.json(
        {
          error: {
            code: "invalid_input",
            message: "Some rows need fixing.",
            details,
          },
        },
        { status: 400 },
      );
    }

    const before = listing.schedule?.weekly.length ?? 0;
    listing.schedule = {
      repeatsWeekly: weekly.length > 0,
      weekly: weekly.map((row) => ({
        weekday: row.weekday!,
        startTime: row.startTime!,
        seats: row.seats!,
      })),
    };

    return HttpResponse.json({
      onSale: listing.sellable !== false,
      note:
        weekly.length === 0
          ? `The weekly schedule is removed. ${before} ${before === 1 ? "departure it made is" : "departures it made are"} closed to new bookings, and the bookings on them stay.`
          : `${weekly.length} ${weekly.length === 1 ? "day" : "days"} a week, from now on.`,
      ...(listing.sellable === false
        ? {
            notOnSaleDetail:
              "This listing is not selling, so none of these departures can be booked yet.",
          }
        : {}),
    });
  }),

  /**
   * Move one departure — yuvoy-operator#56 item 9.
   *
   * All three refusals are modelled, because each is a different sentence on
   * screen and none of them would ever render against a permissive mock: too
   * close to its start, a different day, and a time this listing already has.
   */
  /**
   * Confirm the seats on many departures at once (yuvoy-api#211), as the API
   * answers it: OWNER, ADMIN or MANAGER; market days `from` to `to`, both
   * included, at most 30 days apart; one listing when `experienceId` is sent,
   * and another business's listing answers 404. Safe to send twice: a second
   * call confirms nothing and says 0.
   */
  http.post(url("/slots/confirm-seats"), async ({ request }) => {
    const denied = requireManager(request, "STAFF cannot confirm seats.");
    if (denied) return denied;

    const body = (await request.json().catch(() => ({}))) as {
      from?: unknown;
      to?: unknown;
      experienceId?: unknown;
    };
    const isDay = (v: unknown): v is string =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!isDay(body.from) || !isDay(body.to) || body.to < body.from) {
      return envelope(
        "invalid_input",
        "from and to must be dates, from first",
        400,
      );
    }
    const span =
      (Date.parse(`${body.to}T00:00:00Z`) -
        Date.parse(`${body.from}T00:00:00Z`)) /
      86_400_000;
    if (span > 30) {
      return envelope("invalid_input", "at most 31 days at a time", 400);
    }
    const experienceId =
      typeof body.experienceId === "string" ? body.experienceId : "";
    if (experienceId && !mockExperiences.some((e) => e.id === experienceId)) {
      return envelope("not_found", "we could not find that listing", 404);
    }

    let confirmed = 0;
    for (const slot of allSlots()) {
      if (experienceId && slot.experienceId !== experienceId) continue;
      if (slotStatusOf(slot) !== "open") continue;
      if (Date.parse(slot.startsAt) <= Date.now()) continue;
      const day = slotDay(slot);
      if (day < body.from || day > body.to) continue;
      if (!seatsAwaitingConfirmation(slot)) continue;
      seatsConfirmed[slot.id] = true;
      confirmed += 1;
    }
    return HttpResponse.json({ confirmed });
  }),

  http.patch(url("/slots/:id/time"), async ({ request, params }) => {
    const failed = requireManager(request, "Requires OWNER, ADMIN or MANAGER.");
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;

    const id = String(params.id);
    const slot = allSlots().find((s) => s.id === id);
    if (!slot) return envelope("not_found", "No such departure.", 404);

    const { startsAt } = (await request.json()) as { startsAt?: string };
    const when = Date.parse(String(startsAt));
    if (Number.isNaN(when)) {
      return envelope("invalid_input", "startsAt must be an instant.", 400);
    }

    if (calledOff[id] || Date.parse(slot.startsAt) <= Date.now()) {
      return envelope("departure_started", "It has already left.", 409);
    }
    /*
      "The new time has to be on the same day", compared in the departure's own
      market clock: an instant sent as UTC would read as the previous evening
      for a 05:00 boat, which is exactly the mistake this refusal exists for.
    */
    const dayOf = (iso: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: slot.timezone }).format(
        new Date(iso),
      );
    if (dayOf(String(startsAt)) !== dayOf(slot.startsAt)) {
      return envelope("different_day", "Same day only.", 409);
    }
    const clash = allSlots().some(
      (other) =>
        other.id !== id &&
        other.experienceId === slot.experienceId &&
        Date.parse(other.startsAt) === when,
    );
    if (clash) {
      return envelope("time_taken", "Already a departure at that time.", 409);
    }

    movedTimes[id] = new Date(when).toISOString();
    /*
      `bookingsTold` counts messages actually queued (yuvoy-api#200): a live
      booking we hold a reachable address for. The rest are
      `bookingsNotReached`, present only when above zero.
    */
    const live = slot.parties.filter(
      (p) => p.bookingId && bookingStateOf(p) !== "cancelled",
    );
    const told = live.filter((p) => !p.unreachable).length;
    const notReached = live.length - told;
    return HttpResponse.json({
      id,
      startsAt: movedTimes[id],
      bookingsTold: told,
      ...(notReached > 0 ? { bookingsNotReached: notReached } : {}),
      note: `Moved. ${told} ${told === 1 ? "traveller has" : "travellers have"} been told, and each can cancel for a full refund until it leaves.`,
    });
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

    return HttpResponse.json(found);
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
    found.review = { state: "submitted", since: new Date().toISOString() };
    found.sentBack = undefined;
    return HttpResponse.json({ id: found.id, status: "in_review" });
  }),

  /** The questions a listing asks travellers. */
  http.get(url("/experiences/:id/questions"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const found = mockExperiences.find((e) => e.id === String(params.id));
    if (!found) return envelope("not_found", "No such listing.", 404);
    return HttpResponse.json({ questions: listingQuestions[found.id] ?? [] });
  }),

  /**
   * Replace them. It is the WHOLE list, in order, and it takes effect at once.
   *
   * "A question sent back with its `id` and the same `text`, `answerType` and
   * `options` keeps that id and every answer to it. Changing its `text`,
   * `answerType` or `options` makes it a new question with a new id." Modelled,
   * because a client that re-sent an id with new wording would keep answers
   * against words nobody saw, and only a mock that reissues the id can catch it.
   */
  http.put(url("/experiences/:id/questions"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;
    if (!canManage(sessionUser(request)!)) {
      return envelope(
        "forbidden",
        "only an owner, admin or manager can change the questions",
        403,
      );
    }
    const found = mockExperiences.find((e) => e.id === String(params.id));
    if (!found) return envelope("not_found", "No such listing.", 404);

    const body = (await request.json()) as {
      questions?: Record<string, unknown>[];
    };
    const rows = body.questions ?? [];
    if (rows.length > 10) {
      return envelope("invalid_input", "Ten questions is the most.", 400, {
        questions: ["at most 10"],
      });
    }

    const existing = listingQuestions[found.id] ?? [];
    const saved: MockQuestion[] = [];
    for (const [i, row] of rows.entries()) {
      const text = String(row.text ?? "").trim();
      const answerType = String(row.answerType ?? "");
      if (!text || text.length > 200) {
        return envelope("invalid_input", "A question we can ask.", 400, {
          [`questions[${i}].text`]: ["1 to 200 characters"],
        });
      }
      if (!["short_text", "choice", "yes_no"].includes(answerType)) {
        return envelope("invalid_input", "An answer type we know.", 400, {
          [`questions[${i}].answerType`]: ["short_text, choice or yes_no"],
        });
      }
      const options = Array.isArray(row.options)
        ? (row.options as string[]).map((o) => String(o).trim()).filter(Boolean)
        : [];
      if (answerType === "choice") {
        const unique = new Set(options.map((o) => o.toLowerCase()));
        if (
          options.length < 2 ||
          options.length > 10 ||
          unique.size !== options.length
        ) {
          return envelope(
            "invalid_input",
            "Two to ten different choices.",
            400,
            {
              [`questions[${i}].options`]: ["2 to 10, all different"],
            },
          );
        }
      } else if (options.length > 0) {
        return envelope(
          "invalid_input",
          "Only a choice question has options.",
          400,
          {
            [`questions[${i}].options`]: ["only on a choice question"],
          },
        );
      }

      const sameAsBefore = existing.find(
        (q) =>
          q.id === row.id &&
          q.text === text &&
          q.answerType === answerType &&
          q.options.join("\u0000") === options.join("\u0000"),
      );
      saved.push({
        id: sameAsBefore
          ? sameAsBefore.id
          : `q_${Math.random().toString(36).slice(2, 10)}`,
        text,
        answerType,
        options,
        required: row.required === true,
      });
    }

    listingQuestions[found.id] = saved;
    return HttpResponse.json({ questions: saved });
  }),

  /**
   * What a listing in this category needs the business to hold.
   *
   * `satisfied` is read from the same credential state the account screens use,
   * so the Review step and Verification cannot disagree about whether a
   * document is in place.
   */
  http.get(url("/credential-requirements"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const asked = new URL(request.url);
    const category = asked.searchParams.get("category") ?? "";
    if (!category) {
      return envelope("invalid_input", "A category.", 400);
    }
    /*
      Water categories need the documents a boat needs; everything else needs
      the two every business needs. Not a real taxonomy, and not pretending to
      be: what the screen has to render is a list with both states in it.
    */
    const water = category === "adventure" || category === "nature_wildlife";
    const types = water
      ? ["directorate_registration", "insurance", "boat", "oxygen"]
      : ["directorate_registration", "insurance"];
    return HttpResponse.json({
      category,
      ...(asked.searchParams.get("activityType")
        ? { activityType: asked.searchParams.get("activityType") }
        : {}),
      documents: types.map((type) => ({
        type,
        satisfied: type !== "boat" && type !== "oxygen",
      })),
    });
  }),

  http.get(url("/experiences/:id"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const found = mockExperiences.find((e) => e.id === String(params.id));
    // Gone and belonging-to-somebody-else are one answer, as everywhere else.
    if (!found) return envelope("not_found", "No such listing.", 404);
    return HttpResponse.json(found);
  }),

  /**
   * Propose a change — **never a write to the live listing.**
   *
   * The mock moves `status` and leaves the listing's own fields alone, which
   * is the behaviour a screen would otherwise get wrong: a client that
   * expected its edit to appear immediately would look broken against the real
   * API and correct against a mock that applied it.
   *
   * A draft becomes `in_review`. A published listing becomes
   * `live_changes_in_review` and KEEPS SELLING — "bookings already made are
   * unaffected either way; their terms were snapshotted at checkout".
   */
  /*
    Pausing and resuming a listing — yuvoy-operator#30 §6, #44. Each is one
    handler under two names, as the API registers it; see the factories above.
  */
  pauseHandler("/experiences/:id/withdraw"),
  pauseHandler("/experiences/:id/pause"),
  resumeHandler("/experiences/:id/resume"),
  resumeHandler("/experiences/:id/relist"),

  http.post(url("/experiences/:id/revisions"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const listing = mockExperiences.find((e) => e.id === String(params.id));
    if (!listing) return envelope("not_found", "No such listing.", 404);

    const body = (await request.json()) as Record<string, unknown>;
    if (!body || Object.keys(body).length === 0) {
      return envelope("invalid_input", "Nothing to change.", 400);
    }

    if (
      listing.status === "in_review" ||
      listing.status === "live_changes_in_review"
    ) {
      return envelope(
        "conflict",
        "There is already a change with us on this listing.",
        409,
      );
    }

    listing.status =
      listing.publicationState === "published"
        ? "live_changes_in_review"
        : "in_review";
    listing.review = { state: "submitted", since: new Date().toISOString() };

    return HttpResponse.json(
      { state: "submitted", next: "wait_for_review" },
      { status: 201 },
    );
  }),

  /*
    Paged, as the API pages it since yuvoy-api#204: `limit` (1 to 200, 50 when
    absent or unreadable) and an opaque `cursor` in, `complete` and
    `nextCursor` out. A cursor this list did not issue is a 400. The cursor
    here is an offset in a costume, which is fine for a mock and exactly what
    a client must never construct itself.
  */
  http.get(url("/media"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const query = new URL(request.url).searchParams;
    const asked = Number(query.get("limit"));
    const limit =
      Number.isInteger(asked) && asked > 0 ? Math.min(asked, 200) : 50;
    const cursor = query.get("cursor");
    let offset = 0;
    if (cursor !== null) {
      const match = /^mc_(\d+)$/.exec(cursor);
      if (!match) {
        return envelope("invalid_input", "that cursor is not ours", 400);
      }
      offset = Number(match[1]);
    }

    const all = Object.entries(mediaAssets).map(([id, asset]) => ({
      id,
      kind: asset.kind,
      state: asset.state,
      // Omitted, never null, when there is none, which is most clips.
      ...(asset.posterUrl ? { posterUrl: asset.posterUrl } : {}),
      durationSeconds: asset.durationSeconds,
      listing: asset.listing,
      rejection: asset.rejection,
      situation: situationOf(asset),
      createdAt: new Date().toISOString(),
    }));
    const items = all.slice(offset, offset + limit);
    const next = offset + limit;
    return HttpResponse.json({
      items,
      complete: next >= all.length,
      ...(next < all.length ? { nextCursor: `mc_${next}` } : {}),
    });
  }),

  /**
   * An upload slot — or the one already in flight, handed back.
   *
   * The `uploadUrl` points at a DIFFERENT ORIGIN, because in production it
   * does: "bytes never pass through this API", the browser talks straight to
   * the video provider, and that is the one request in this portal MSW cannot
   * intercept. `mocks/tus-server.ts` is that origin.
   *
   * **Asking again while an upload is in flight resumes it** — yuvoy-api#66 §3,
   * PR #85. The same `intentId`, over the same tus resource, with a fresh URL:
   * not a 409, and deliberately not a new slot, because a new slot would also
   * stop the 409 while silently abandoning the bytes the provider already
   * holds. The mock returns the SAME id for the same reason the API's own
   * tests assert it — handing back a different one would make a reload look
   * recovered while the bytes it recovered belonged to nothing.
   *
   * The 409 is still declared in the contract and is still modelled, on one
   * fixture identity, because one reachable cause is left: a second person at
   * the same business, if the quota is per operator rather than per user.
   * That question is open on yuvoy-api#66 and `/reels`' copy hedges to match.
   */
  http.post(url("/media/upload-intents"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const me = sessionUser(request)!;

    if (me.id === CONTENDED_ID) {
      /*
        A colleague at this business got there first, so there is nothing of
        OURS to resume — the only 409 the endpoint can still produce, and only
        if the quota is per operator rather than per user. Refused on the first
        ask rather than the second, because that is what "somebody else already
        has it" means; a 409 that only arrives after you have held the slot
        yourself is modelling a different thing.
      */
      return envelope(
        "conflict",
        "An upload is already in progress for this operator.",
        409,
      );
    }

    const body = (await request.json()) as { sizeBytes?: number };
    if (
      !Number.isInteger(body.sizeBytes) ||
      (body.sizeBytes ?? 0) <= 0 ||
      (body.sizeBytes ?? 0) > 200 * 1024 * 1024
    ) {
      return envelope("invalid_input", "A valid file size is required.", 400);
    }

    const open = uploadIntents[me.id];
    if (open && !open.confirmedAt) {
      return uploadIntent(open.id, open.uploadId, open.sizeBytes);
    }

    const id = `upi_${Math.random().toString(36).slice(2, 10)}`;
    /*
      A dropping upload for one fixture identity, so the resume path is
      exercised end to end rather than only in unit tests. A resumable uploader
      that has never been interrupted is an uploader whose resume path has
      never run.
    */
    const uploadId = `${id}${me.id === DROPPING_ID ? "-drop" : ""}`;
    /*
      Opened AT the size just asked for, as production does — "tus fixes the
      upload length when the slot is created". That is what makes a `HEAD`
      report no `Upload-Defer-Length`, which is what tells the client not to
      declare a length it would be refused for.
    */
    createMockUpload(uploadId, body.sizeBytes!);
    uploadIntents[me.id] = { id, uploadId, sizeBytes: body.sizeBytes! };

    return uploadIntent(id, uploadId, body.sizeBytes!);
  }),

  /**
   * "A hint that it is worth polling, nothing more — the client's claim is
   * never trusted. What decides is whether the provider has an asset."
   *
   * So this checks the tus server's real offset rather than believing the
   * caller: a client that says it finished at 40% is told to keep waiting, and
   * a portal built against a mock that took its word would ship a flow that
   * marks half-uploaded clips ready.
   */
  http.post(
    url("/media/upload-intents/:id/complete"),
    async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      const me = sessionUser(request)!;

      const intent = uploadIntents[me.id];
      if (!intent || intent.id !== String(params.id)) {
        return envelope("not_found", "No such upload.", 404);
      }

      if (!mockUploadDone(intent.uploadId)) {
        // Not an error: still processing, from the caller's point of view.
        return HttpResponse.json({ ready: false }, { status: 202 });
      }

      /*
        One poll of latency before ready, because 202 is the normal first
        answer and a client that only ever sees 200 has never rendered its own
        waiting state.
      */
      if (!intent.confirmedAt) {
        intent.confirmedAt = Date.now();
        return HttpResponse.json({ ready: false }, { status: 202 });
      }

      const mediaAssetId = `med_${intent.id.slice(4)}`;
      /*
        No `posterUrl`, deliberately. A clip has no still until the provider
        has produced one and no public URL until it is published — so the row
        an operator sees immediately after uploading is precisely the
        no-preview case, and the screen has to render it as something.
      */
      mediaAssets[mediaAssetId] = {
        attested: false,
        kind: "video",
        state: "ready",
      };
      return HttpResponse.json({ ready: true, mediaAssetId });
    },
  ),

  http.post(url("/media/:id/rights"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    /*
      `403 account_suspended`, which this write declares: a suspended business
      reads its story and its clips and may not change them (yuvoy-operator#90
      f13). Modelled so the portal's answer to it runs.
    */
    const shut = requireWritable(request);
    if (shut) return shut;

    const asset = mediaAssets[String(params.id)];
    if (!asset) return envelope("not_found", "No such clip.", 404);

    const body = (await request.json()) as Record<string, unknown>;

    /*
      The contract's required four, enforced. `peopleConsentConfirmed` is
      checked for being a BOOLEAN rather than for being truthy: "never
      defaulted and never omitted" means an absent field is a 400, and a mock
      that accepted `undefined` would let the client ship a quiet `false`.
    */
    if (
      typeof body.statementVersion !== "number" ||
      typeof body.peopleConsentConfirmed !== "boolean" ||
      typeof body.rightsType !== "string"
    ) {
      return envelope("invalid_input", "Missing an attestation field.", 400);
    }
    if (!/^[a-f0-9]{64}$/.test(String(body.statementSha256 ?? ""))) {
      return envelope(
        "invalid_input",
        "statementSha256 must be 64 lower-case hex characters.",
        400,
      );
    }

    asset.attested = true;
    asset.state = "attested";
    return HttpResponse.json(
      {
        attestationId: `att_${Math.random().toString(36).slice(2, 10)}`,
        state: "queued_for_review",
        note: "A person at Yuvoy checks this before the clip can appear anywhere.",
      },
      { status: 201 },
    );
  }),

  http.post(url("/media/:id/withdraw"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    /*
      `403 account_suspended`, which this write declares: a suspended business
      reads its story and its clips and may not change them (yuvoy-operator#90
      f13). Modelled so the portal's answer to it runs.
    */
    const shut = requireWritable(request);
    if (shut) return shut;

    const id = String(params.id);
    const body = (await request.json()) as { reason?: string };
    const REASONS = [
      "operator_request",
      "people_in_it_objected",
      "no_longer_accurate",
      "rights_lapsed",
    ];
    if (!REASONS.includes(body.reason ?? "")) {
      return envelope("invalid_input", "That is not a withdrawal reason.", 400);
    }

    const asset = mediaAssets[id];
    if (!asset) return envelope("not_found", "No such clip.", 404);

    /*
      "Asking twice succeeds: somebody requesting a clip come down that is
      already down should be told it is down, not told they did something
      wrong." Modelled, because a client built against a mock that 409s the
      second attempt would grow an error path the API does not have — and it
      would fire on the wet-hands double tap this portal is designed around.
    */
    asset.state = "withdrawn";
    return HttpResponse.json({
      withdrawn: true,
      note: "It is off Yuvoy now. The original is deleted at the video provider shortly afterwards.",
    });
  }),

  http.post(url("/media/:id/publish"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    /*
      `403 account_suspended`, which this write declares: a suspended business
      reads its story and its clips and may not change them (yuvoy-operator#90
      f13). Modelled so the portal's answer to it runs.
    */
    const shut = requireWritable(request);
    if (shut) return shut;

    const asset = mediaAssets[String(params.id)];
    /*
      `published` is allowed as well as `approved`, since yuvoy-api#191: "`role`
      is also how an existing pairing's role is changed", and an already
      published item is exactly what a role change acts on. The guard refused
      it, which made every promotion and demotion answer 404 and the portal say
      "this one is not approved yet" about a reel a traveller could see.
    */
    if (!asset || (asset.state !== "approved" && asset.state !== "published")) {
      return envelope("not_found", "No approved clip.", 404);
    }
    const body = (await request.json()) as {
      experienceId?: string;
      role?: string;
    };
    const listing = mockExperiences.find(
      (item) => item.id === body.experienceId,
    );
    if (!listing || !["hero", "gallery"].includes(body.role ?? "gallery")) {
      return envelope("not_found", "No such listing.", 404);
    }
    const wanted = (body.role ?? "gallery") as "hero" | "gallery";

    /*
      ONE PAIRING PER LISTING, and `role` changes it rather than adding a second
      — yuvoy-api#191. Publishing with the role it already has changes nothing.

      `hero` while a DIFFERENT item is the cover is `409 hero_taken`, and the
      refused request changes nothing. Modelled because it is the refusal the
      sheet has a sentence for, and a mock that let two heroes exist would make
      that sentence unreachable.
    */
    if (wanted === "hero") {
      const currentCover = Object.entries(mediaAssets).find(
        ([otherId, other]) =>
          otherId !== String(params.id) &&
          other.listing?.experienceId === listing.id &&
          other.listing?.role === "hero",
      );
      if (currentCover) {
        return envelope(
          "hero_taken",
          "This listing already has a cover. Make that one a gallery item first, then try again.",
          409,
          { role: "hero" },
        );
      }
    }

    asset.state = "published";
    asset.listing = {
      experienceId: listing.id,
      title: listing.title,
      state: "published",
      /*
        Demoting the cover leaves the listing with NO cover: "this reads
        `gallery` afterwards and the listing has no cover until another item is
        published as `hero`." Nothing is promoted in its place, which is the
        half an operator has to be warned about before they tap.
      */
      role: wanted,
    };
    return new HttpResponse(null, { status: 204 });
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

  /* --------------------------------------------------------- the day ----- */

  /**
   * Create departures — the one thing the capacity screen could not do.
   *
   * Two behaviours are modelled rather than stubbed, because the screen is
   * built around both:
   *
   * 1. **The cross product.** A range and a list of times make one departure
   *    per combination, filtered by `weekdays` where given. That is what makes
   *    an untouched date field expensive, and it is what the form's live count
   *    is checked against.
   * 2. **Idempotence.** "Dates that already have a departure at that time are
   *    left alone, so `created: 0` is a legitimate answer and not a failure."
   *    A mock that created duplicates would let this portal ship a receipt for
   *    a state the API never produces.
   *
   * A listing that is not this operator's answers **404, never 403** — the
   * contract chose that so a refusal cannot confirm the listing exists.
   */
  http.post(url("/slots"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;
    const me = sessionUser(request)!;
    if (!canManage(me)) {
      return envelope("forbidden", "STAFF cannot add departures.", 403);
    }

    const body = (await request.json()) as {
      experienceId?: string;
      fromDate?: string;
      toDate?: string;
      times?: string[];
      weekdays?: number[];
      seats?: number;
      capacity?: number;
      durationMinutes?: number;
      cutoffHours?: number;
    };

    const listing = [...SLOTS, ...createdSlots].find(
      (s) => s.experienceId === body.experienceId,
    );
    if (!listing) return envelope("not_found", "No such listing.", 404);

    const times = (body.times ?? []).filter((t) => /^\d{2}:\d{2}$/.test(t));
    const seats = body.seats ?? 0;
    if (!body.fromDate || !times.length || seats < 1) {
      return envelope(
        "bad_request",
        "A date, a time and seats are needed.",
        400,
      );
    }

    const from = Date.parse(`${body.fromDate}T00:00:00Z`);
    const to = Date.parse(`${body.toDate || body.fromDate}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      return envelope("bad_request", "That date range runs backwards.", 400);
    }

    const wanted = new Set(body.weekdays ?? []);
    const existing = new Set(
      [...SLOTS, ...createdSlots]
        .filter((s) => s.experienceId === body.experienceId)
        .map((s) => `${s.startsAt}`),
    );

    let created = 0;
    for (let t = from; t <= to; t += 86_400_000) {
      const d = new Date(t);
      if (wanted.size && !wanted.has(d.getUTCDay())) continue;
      const day = d.toISOString().slice(0, 10);
      for (const time of times) {
        // The market is +05:30 and every fixture departure is stored that way.
        const startsAt = `${day}T${time}:00+05:30`;
        if (existing.has(startsAt)) continue;
        existing.add(startsAt);
        created += 1;
        createdSlots.push({
          id: `slot_new_${createdSlots.length}_${day.replace(/-/g, "")}_${time.replace(":", "")}`,
          experienceId: listing.experienceId,
          title: listing.title,
          startsAt,
          timezone: listing.timezone,
          seats,
          sold: 0,
          remaining: seats,
          bookingMode: listing.bookingMode,
          status: "open",
          meetingPoint: listing.meetingPoint,
          parties: [],
          seatsSoldOffline: 0,
        });
      }
    }

    /*
      Whether those departures actually sell — yuvoy-operator#30 §4.

      Departures on a draft listing stay creatable, deliberately ("a calendar
      you cannot fill in before the listing is approved is not a calendar").
      What was wrong was the silence: the screen said "they are on sale from
      now" unconditionally. The mock answers from the listing's real status, so
      the false claim is reachable in a test rather than only in production.
    */
    const owner = mockExperiences.find((e) => e.id === body.experienceId);
    const onSale = owner ? owner.status === "live" : true;

    return HttpResponse.json(
      {
        created,
        onSale,
        ...(onSale
          ? {}
          : {
              notOnSaleReason:
                owner?.status === "draft"
                  ? "listing_draft"
                  : "listing_unpriced",
              notOnSaleDetail:
                "These are on your calendar, but the activity is still a draft — nobody can book them until it is approved.",
            }),
        note:
          created === 0
            ? "Every one of those already had a departure at that time."
            : "They are on sale now.",
      },
      { status: 201 },
    );
  }),

  http.get(url("/slots"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const u = new URL(request.url);
    const from = u.searchParams.get("from");
    const to = u.searchParams.get("to");

    /*
      MARKET days, inclusive, as the contract now reads them: "the first day to
      include, in the market's clock" on both ends (yuvoy-operator#45 item 6).

      This filtered on UTC days, faithfully, because that is what the API did —
      `from` was UTC midnight and `to` ran to the next one — and it is why
      `listSlots` widened its window by a day either side and threw the extra
      back. Both halves have gone: the range asked for is the range meant, and a
      04:00 IST departure lists under its own day rather than the evening
      before.

      Created departures are read back like any other. A mock whose reads ignore
      its writes proves the message rendered and nothing about the row.
    */
    const inRange = allSlots().filter((s) => {
      const day = slotDay(s);
      return (!from || day >= from) && (!to || day <= to);
    });

    /*
      What was WRITTEN is what is read back. For its first month this handler
      returned the fixture's numbers whatever the session had done to them, so
      every revalidate-after-write showed the pre-write state: "Now offering
      6." beside a row still saying "11 left", a called-off departure still
      open on /today. A mock whose reads ignore its writes is a suite that
      proves the message rendered and nothing about the screen.
    */
    return HttpResponse.json({
      items: inRange.map((s) => {
        const seats = capacity[s.id] ?? s.seats;
        const sold = s.sold + (offlineSold[s.id] ?? 0);
        return {
          id: s.id,
          experienceId: s.experienceId,
          title: s.title,
          startsAt: s.startsAt,
          timezone: s.timezone,
          seats,
          sold,
          remaining: Math.max(0, seats - sold),
          // Omitted when the fixture omits it. One departure has no mode on
          // purpose: the screen must say nothing rather than assume held seats.
          ...(s.bookingMode ? { bookingMode: s.bookingMode } : {}),
          status: slotStatusOf(s),
          ...saleVerdictOf(s, seats, sold),
        };
      }),
      /*
        Told rather than left out. `GET /slots` is paged in the contract and
        `listSlots` walks it until this says so; a mock omitting it would let a
        client ship that stops at the first page and never notice.
      */
      complete: true,
    });
  }),

  http.get(url("/slots/:id/manifest"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const slot = SLOTS.find((s) => s.id === String(params.id));
    // Missing and "belongs to somebody else" are one answer, by design.
    if (!slot) return envelope("not_found", "No such departure.", 404);

    /*
      Who is on the boat, as the API reads it (yuvoy-api#204): nobody on a
      departure that was called off, and never a cancelled booking. "`parties`
      is who is on the boat, and somebody cancelled is not."
    */
    const wasCalledOff = Boolean(calledOff[slot.id] || slot.calledOff);
    const onBoard = wasCalledOff
      ? []
      : slot.parties.filter(
          (p) => !p.bookingId || bookingStateOf(p) !== "cancelled",
        );

    const parties = onBoard.map((p) => {
      const recorded = attendance[p.bookingId];
      /*
        `cash` is sent on a party that pays at the counter, the same object
        `GET /bookings` sends, and on nobody else (yuvoy-api#204). It used to
        be held back here, when the contract carried none and the screen
        joined `GET /bookings` instead. `unreachable` is this mock's own and
        never leaves it.
      */
      const { cash: _cash, unreachable: _unreachable, ...party } = p;
      void _cash;
      void _unreachable;
      const cash = p.bookingId ? bookingCashOf(p) : undefined;
      return {
        ...party,
        state: p.bookingId ? bookingStateOf(p) : p.state,
        arrived: recorded ? true : p.arrived,
        arrivedAt: recorded?.arrivedAt ?? p.arrivedAt,
        ...(cash ? { cash } : {}),
      };
    });

    const giveBack = cashToGiveBackOf(slot);

    const guests = parties.reduce((n, p) => n + p.guests, 0);

    return HttpResponse.json({
      slotId: slot.id,
      experience: slot.title,
      startsAt: slot.startsAt,
      timezone: slot.timezone,
      meetingPoint: slot.meetingPoint,
      status: calledOff[slot.id] ? "cancelled" : slot.status,
      ...(calledOff[slot.id]
        ? { calledOff: { reasonCode: calledOff[slot.id] } }
        : slot.calledOff
          ? { calledOff: slot.calledOff }
          : {}),
      parties,
      ...(giveBack ? { cashToGiveBack: giveBack } : {}),
      totals: {
        parties: parties.length,
        guests,
        arrived: parties.filter((p) => p.arrived).length,
        seatsSold: slot.sold,
        // Counter sales recorded this session count, as they would.
        seatsSoldOffline:
          (slot.seatsSoldOffline ?? 0) + (offlineSold[slot.id] ?? 0),
      },
    });
  }),

  /* ------------------------------------------------------------ bookings - */

  /**
   * The bookings, with what each contributed.
   *
   * Derived from the same `SLOTS` the manifest reads and the same `REQUESTS`
   * the queue reads, so a booking cannot appear here and nowhere else.
   * Selected on the SLOT's `startsAt`, as the contract says — when the trip
   * runs, not when it was made — which is the reason the screen must never
   * sum this list against `/earnings`.
   *
   * Money sits on captured rows only. An unanswered seat request is a
   * `pending_request` booking that has moved nothing, so it comes back with
   * no `money` at all — "absent, not zeroed" — which is the branch the screen
   * renders as "no money has moved". A live hold is not a booking and is not
   * here.
   */
  /**
   * The bookings list, with views, search, filters, counts and a cursor —
   * yuvoy-operator#57 (yuvoy-api#185).
   *
   * Every one of those is modelled rather than ignored, because the whole point
   * of the change is that the SERVER answers them: a mock that returned
   * everything and let the portal filter would let this screen ship counting
   * the rows it happened to load, which is the bug #57 exists to remove.
   */
  http.get(url("/bookings"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const u = new URL(request.url);
    const from = u.searchParams.get("from");
    const to = u.searchParams.get("to");
    const view = u.searchParams.get("view");
    const q = (u.searchParams.get("q") ?? "").trim();
    const experienceId = u.searchParams.get("experienceId");

    if (view !== null && !["upcoming", "past", "cancelled"].includes(view)) {
      return HttpResponse.json(
        {
          error: {
            code: "invalid_input",
            message: "view must be upcoming, past or cancelled",
            details: { view: "must be upcoming, past or cancelled" },
          },
        },
        { status: 400 },
      );
    }
    if (q.length > 60) {
      return HttpResponse.json(
        {
          error: {
            code: "invalid_input",
            message: "q is at most 60 characters",
            details: { q: "at most 60 characters" },
          },
        },
        { status: 400 },
      );
    }

    /*
      MARKET days, inclusive, as the contract now reads them: "the first day to
      include, in the market's clock" (yuvoy-operator#45 item 6). Each
      departure's OWN zone, never a fixed one.
    */
    const inWindow = (startsAt: string, timezone: string) => {
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
      }).format(new Date(startsAt));
      return (!from || day >= from) && (!to || day <= to);
    };

    /*
      "Any part of the guest's name, or any part of the reference with or
      without `YV-`, case ignored." A request has no reference, which is why
      `counts.requests` and the portal's own request filter both match by name
      alone.
    */
    const needle = q.toLowerCase();
    const matchesQ = (name: string, reference?: string) => {
      if (!needle) return true;
      if (name.toLowerCase().includes(needle)) return true;
      if (!reference) return false;
      const ref = reference.toLowerCase();
      return ref.includes(needle) || ref.replace("yv-", "").includes(needle);
    };

    const captured = SLOTS.flatMap((slot) =>
      inWindow(slot.startsAt, slot.timezone) &&
      (!experienceId || slot.experienceId === experienceId)
        ? slot.parties
            .filter((p) => p.bookingId && matchesQ(p.name, p.reference))
            .map((p) => ({
              id: p.bookingId,
              reference: p.reference,
              state: bookingStateOf(p),
              guests: p.guests,
              experience: slot.title,
              // Every row carries it, so a listing filter built from
              // `GET /experiences` lines up with these rows.
              experienceId: slot.experienceId,
              slot: { startsAt: slot.startsAt, timezone: slot.timezone },
              contact: { name: p.name },
              createdAt: new Date(
                new Date(slot.startsAt).getTime() - 3 * 86_400_000,
              ).toISOString(),
              money: bookingMoney(p),
              // Present only on a cash booking — "branch on the key existing".
              ...(p.cash ? { cash: bookingCashOf(p) } : {}),
              ...(bookingCancellationOf(p)
                ? { cancellation: bookingCancellationOf(p) }
                : {}),
            }))
        : [],
    );

    const awaiting = REQUESTS.filter(
      (r) =>
        !answered[r.id] &&
        inWindow(r.startsAt, r.timezone) &&
        (!experienceId || r.experienceId === experienceId) &&
        // By NAME alone: a request has no reference to match against.
        matchesQ(r.contactName),
    );

    /*
      Which view a booking is in, first match wins, exactly as the contract's
      table has it. A trip earlier today stays `upcoming` "until the market's
      day ends or it is marked", which is why the day is compared rather than
      the instant.
    */
    const todayMarket = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date());
    const viewOf = (b: (typeof captured)[number]) => {
      const state = String(b.state);
      if (state === "cancelled" || state === "declined") return "cancelled";
      if (state === "completed" || state === "no_show") return "past";
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: b.slot.timezone,
      }).format(new Date(b.slot.startsAt));
      return day < todayMarket ? "past" : "upcoming";
    };

    /*
      "`counts` are totals, not the size of this page. They honour `q`,
      `experienceId`, `from` and `to`, and ignore `view`, `state`, `limit` and
      `cursor`, so the pills stay put while you switch between them."
    */
    const counts = {
      requests: awaiting.length,
      upcoming: captured.filter((b) => viewOf(b) === "upcoming").length,
      past: captured.filter((b) => viewOf(b) === "past").length,
      cancelled: captured.filter((b) => viewOf(b) === "cancelled").length,
    };

    const when = (b: (typeof captured)[number]) => Date.parse(b.slot.startsAt);
    let rows = captured;
    if (view) {
      // "Upcoming soonest trip first; past and cancelled most recent first."
      rows = captured
        .filter((b) => viewOf(b) === view)
        .sort((a, b) =>
          view === "upcoming" ? when(a) - when(b) : when(b) - when(a),
        );
    } else {
      /*
        No view: every booking, soonest trip first, "as this list always was".
        The open requests come too, because that is what the older callers read.
      */
      rows = [...captured].sort((a, b) => when(a) - when(b));
    }

    const items: Record<string, unknown>[] = view
      ? [...rows]
      : [
          ...rows,
          ...awaiting.map((r) => ({
            id: r.id,
            state: "pending_request",
            guests: r.guests,
            experience: r.experience,
            experienceId: r.experienceId,
            slot: { startsAt: r.startsAt, timezone: r.timezone },
            contact: { name: r.contactName },
            createdAt: r.requestedAt,
          })),
        ];

    const limitRaw = Number(u.searchParams.get("limit"));
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0
        ? Math.min(limitRaw, 200)
        : 100;
    const cursor = u.searchParams.get("cursor");
    let start = 0;
    if (cursor !== null) {
      /*
        "A cursor this list did not issue is a `400`, and so is a cursor from
        one view sent with another." The view is encoded into the cursor for
        exactly that: a client carrying a page across a pill change would
        otherwise silently show the wrong rows.
      */
      const [cursorView, offset] = cursor.split(":");
      if (cursorView !== (view ?? "") || !Number.isInteger(Number(offset))) {
        return HttpResponse.json(
          {
            error: {
              code: "invalid_input",
              message: "cursor was issued for another list",
              details: { cursor: "issued for another list" },
            },
          },
          { status: 400 },
        );
      }
      start = Number(offset);
    }
    const page = items.slice(start, start + limit);
    const end = start + page.length;

    return HttpResponse.json({
      items: page,
      complete: end >= items.length,
      ...(end < items.length ? { nextCursor: `${view ?? ""}:${end}` } : {}),
      counts,
    });
  }),

  /* ------------------------------------------------ conversations ------- */

  http.get(url("/bookings/:id/messages"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const id = String(params.id);
    const thread = threadFor(id);
    /*
      A booking with no conversation is an EMPTY one, not a 404 — nobody has
      written in it yet, and the composer belongs there. Only a booking that is
      not this operator's is missing, and that is what `bookingOf` decides.
    */
    if (!bookingOf(id)) return envelope("not_found", "No such booking.", 404);

    const all = thread?.messages ?? [];
    const limitRaw = Number(new URL(request.url).searchParams.get("limit"));
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const cursor = new URL(request.url).searchParams.get("cursor");

    /*
      The cursor is the index one past the oldest message already sent, so
      paging walks BACKWARDS through a list stored oldest-first. Opaque to the
      client by contract, and this is a mock, so a number is honest enough —
      what matters is that a cursor this conversation did not issue is a 400,
      which is the branch a client that constructs one would hit.
    */
    let end = all.length;
    if (cursor !== null) {
      const parsed = Number(cursor);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > all.length) {
        return envelope("invalid_input", "Not a cursor we issued.", 400);
      }
      end = parsed;
    }
    const start = Math.max(0, end - limit);
    const page = all.slice(start, end);

    const closed = thread?.closedReason;
    return HttpResponse.json({
      messages: page,
      complete: start === 0,
      ...(start > 0 ? { nextCursor: String(start) } : {}),
      unreadCount: thread?.unread ?? 0,
      canWrite: !closed,
      ...(closed ? { closedReason: closed } : {}),
      /*
        Absent on a cancelled or declined booking, by the contract: there is no
        moment writing stops on its own, because it has already stopped.
      */
      ...(closed
        ? {}
        : {
            writableUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          }),
    });
  }),

  http.post(url("/bookings/:id/messages"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    /*
      NOT `requireWritable`. "It still works while the business is suspended"
      (#50): a suspended business must still be able to answer the travellers it
      already has, and a mock that refused would let the portal hide the composer
      from exactly the operator who most needs it.

      And no role gate: "any role can write: whoever is holding the phone answers
      the question."
    */

    const id = String(params.id);
    if (!bookingOf(id)) return envelope("not_found", "No such booking.", 404);

    const thread = threadFor(id);
    if (thread?.closedReason) {
      return HttpResponse.json(
        {
          error: {
            code: "messages_closed",
            message:
              thread.closedReason === "cancelled"
                ? "This booking was cancelled, so no more messages can be sent."
                : thread.closedReason === "declined"
                  ? "This booking was declined, so no more messages can be sent."
                  : "Messages for this trip are closed.",
            details: { reason: thread.closedReason },
          },
        },
        { status: 409 },
      );
    }

    const body = (await request.json()) as { text?: string };
    const text = (body.text ?? "").trim();

    if (text.length === 0) {
      return HttpResponse.json(
        {
          error: {
            code: "invalid_input",
            message: "Write something first.",
            details: { text: "required" },
          },
        },
        { status: 400 },
      );
    }
    if (text.length > 1000) {
      return HttpResponse.json(
        {
          error: {
            code: "invalid_input",
            message: "That is longer than 1000 characters. Shorten it.",
            details: { text: "too long" },
          },
        },
        { status: 400 },
      );
    }

    const kind = contactDetailIn(text);
    if (kind) {
      /*
        The message names the KIND and never repeats any of the text — "nothing
        is stored, and the refusal names the kind without repeating any of it".
        A refusal that echoed the number back would put it on a screen, which is
        the thing the rule exists to prevent.
      */
      return HttpResponse.json(
        {
          error: {
            code: "invalid_input",
            message:
              kind === "phone"
                ? "Messages cannot contain a phone number. Travellers reach you through Yuvoy, and this keeps it that way."
                : kind === "email"
                  ? "Messages cannot contain an email address. Travellers reach you through Yuvoy, and this keeps it that way."
                  : "Messages cannot contain a link. Travellers reach you through Yuvoy, and this keeps it that way.",
            details: { text: "contact details", contactDetail: kind },
          },
        },
        { status: 400 },
      );
    }

    const message: MockMessage = {
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
      from: "operator",
      // "Signed with the name of whoever is signed in."
      senderName: sessionUser(request)!.name,
      text,
      sentAt: new Date().toISOString(),
    };
    if (thread) {
      thread.messages.push(message);
    } else {
      threads.push({ bookingId: id, messages: [message], unread: 0 });
    }
    return HttpResponse.json(message, { status: 201 });
  }),

  http.post(url("/bookings/:id/messages/read"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const id = String(params.id);
    const thread = threadFor(id);
    if (!thread) return envelope("not_found", "No such conversation.", 404);

    const { upTo } = (await request.json()) as { upTo?: string };
    const at = thread.messages.findIndex((m) => m.id === upTo);
    /*
      "No such booking for this operator, or that message is not in its
      conversation. Deliberately indistinguishable." One answer, and the mock
      does not tell them apart either.
    */
    if (at < 0) return envelope("not_found", "No such message.", 404);

    /*
      The marker moves to this message "and so to everything before it", and
      NEVER back. What stays unread is the traveller's messages after it — which
      is the whole reason the endpoint is named by a message rather than being
      "all of it, now": one that arrived while somebody read stays unread.
    */
    const after = thread.messages
      .slice(at + 1)
      .filter((m) => m.from === "traveller").length;
    thread.unread = Math.min(thread.unread, after);
    return HttpResponse.json({ unreadCount: thread.unread });
  }),

  http.get(url("/message-threads"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const rows = threads
      .map((t) => {
        const booking = bookingOf(t.bookingId);
        const last = t.messages.at(-1);
        if (!booking || !last) return null;
        return {
          bookingId: t.bookingId,
          reference: booking.reference,
          experience: booking.experience,
          slot: booking.slot,
          lastMessageAt: last.sentAt,
          lastFrom: last.from,
          unreadCount: t.unread,
        };
      })
      .filter((r) => r !== null)
      // "The one with the latest message first."
      .sort(
        (a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt),
      );

    const params = new URL(request.url).searchParams;
    const limitRaw = Number(params.get("limit"));
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const cursor = params.get("cursor");
    let start = 0;
    if (cursor !== null) {
      const parsed = Number(cursor);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > rows.length) {
        return envelope("invalid_input", "Not a cursor we issued.", 400);
      }
      start = parsed;
    }
    const page = rows.slice(start, start + limit);
    const end = start + page.length;

    return HttpResponse.json({
      threads: page,
      // "Told rather than inferred", so the client never has to guess from a
      // page's length whether a full one was the last.
      complete: end >= rows.length,
      ...(end < rows.length ? { nextCursor: String(end) } : {}),
    });
  }),

  /*
    Cancelling ONE booking — yuvoy-operator#43 item 4.

    Every refusal is modelled, because each one is a different sentence on the
    screen and none of them would ever render against a permissive mock: the
    reference typed back, the role, the departure that has left, the booking
    that already ended, and the retry that must not refund twice.
  */
  http.post(url("/bookings/:id/cancel"), async ({ request, params }) => {
    const failed = requireManager(request, "STAFF cannot cancel a booking.");
    if (failed) return failed;
    /*
      NOT `requireWritable`. A suspended business must still be able to tell a
      traveller their trip is off (#50), and refusing here would strand the
      traveller rather than the operator.
    */

    const id = String(params.id);
    let found: { party: MockParty; slot: MockSlot } | null = null;
    for (const slot of SLOTS) {
      const party = slot.parties.find((p) => p.bookingId === id);
      if (party) found = { party, slot };
    }
    // "Another business's booking answers `404` BEFORE its reference is
    // compared" — so a wrong id can never be used to learn a reference.
    if (!found) return envelope("not_found", "No such booking.", 404);

    const body = (await request.json()) as {
      reasonCode?: string;
      note?: string;
      confirmReference?: string;
    };

    if (
      ![
        "weather",
        "equipment",
        "staffing",
        "safety",
        "insufficient_numbers",
      ].includes(body.reasonCode ?? "")
    ) {
      return envelope(
        "invalid_reason_code",
        "Pick a reason from the list.",
        400,
      );
    }
    if ((body.note ?? "").length > 500) {
      return envelope(
        "invalid_input",
        "That note is longer than 500 characters.",
        400,
      );
    }

    /*
      "Letter case and surrounding spaces are ignored." Modelled, because the
      alternative is a portal that uppercases on the client to be safe and a
      real API that did not need it.
    */
    const typed = (body.confirmReference ?? "").trim().toUpperCase();
    if (typed !== found.party.reference.toUpperCase()) {
      return envelope(
        "confirmation_required",
        "That is not this booking's reference.",
        400,
      );
    }

    if (cancelled[id]) {
      return envelope(
        "already_cancelled",
        "This booking is already cancelled.",
        409,
      );
    }

    const state = bookingStateOf(found.party);
    if (state !== "confirmed" && state !== "paid_pending_ops") {
      return envelope(
        "booking_ended",
        "This booking was declined, completed or marked a no-show.",
        409,
      );
    }
    if (Date.parse(found.slot.startsAt) <= Date.now()) {
      return envelope("departure_started", "That departure has left.", 409);
    }

    /*
      A cash booking captured nothing online, so nothing is refunded and the
      response says the money is with the business. That sentence is the only
      thing standing between an operator and a traveller who was never handed
      their cash back.
    */
    const money = bookingMoney(found.party);
    const refundedPaise = found.party.cash ? 0 : (money?.grossPaise ?? 0);
    const held = cashTaken[id];

    cancelled[id] = {
      at: new Date().toISOString(),
      reasonCode: body.reasonCode!,
      refundedPaise,
    };

    return HttpResponse.json({
      bookingId: id,
      reference: found.party.reference,
      state: "cancelled",
      reasonCode: body.reasonCode,
      refundedPaise,
      seatsReleased: found.party.guests,
      ...(held
        ? {
            cashToGiveBackPaise: held.collectedPaise,
            note: "You have this traveller's cash. Give it back to them, then record it here.",
          }
        : {}),
    });
  }),

  http.post(url("/bookings/:id/cash-returned"), async ({ request, params }) => {
    const failed = requireManager(
      request,
      "STAFF cannot record giving the cash back.",
    );
    if (failed) return failed;

    const id = String(params.id);
    let party: MockParty | null = null;
    for (const slot of SLOTS) {
      const hit = slot.parties.find((p) => p.bookingId === id);
      if (hit) party = hit;
    }
    if (!party) return envelope("not_found", "No such booking.", 404);

    if (cashReturned[id]) {
      /*
        "A retry answers `409 cash_already_returned` and changes nothing." The
        common way to arrive here is a second tap on one bar of signal, and a
        mock that recorded twice would let the portal ship a screen that says a
        traveller was handed money twice.
      */
      return envelope(
        "cash_already_returned",
        "You already recorded giving this cash back.",
        409,
      );
    }

    /*
      Read through the same two functions `GET /bookings/{id}` reads through,
      not from the portal's own write log.

      This checked `cancelled[id]` and `cashTaken[id]` at first, which only know
      about what happened through the portal in this process. A booking that
      arrives already cancelled with its cash already taken — the fixture for a
      called-off departure, and the only shape this endpoint exists for — was
      therefore answered "this booking is not cancelled".
    */
    const effectiveCash = bookingCashOf(party);
    const takenPaise = effectiveCash?.collected
      ? (effectiveCash.collectedPaise ?? effectiveCash.collectPaise)
      : undefined;

    if (
      bookingStateOf(party) !== "cancelled" ||
      !party.cash ||
      takenPaise === undefined
    ) {
      // Three cases, one code, and "the message says which".
      return envelope(
        "nothing_to_give_back",
        !party.cash
          ? "This booking was paid online, so there is nothing of yours to give back."
          : bookingStateOf(party) !== "cancelled"
            ? "This booking is not cancelled."
            : "No cash is recorded as taken on this booking.",
        409,
      );
    }

    const record = {
      returnedAt: new Date().toISOString(),
      returnedPaise: takenPaise,
    };
    cashReturned[id] = record;
    return HttpResponse.json({
      bookingId: id,
      reference: party.reference,
      ...record,
    });
  }),

  http.get(url("/bookings/:id"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const id = String(params.id);

    for (const slot of SLOTS) {
      const party = slot.parties.find((p) => p.bookingId === id);
      if (party) {
        return HttpResponse.json({
          id: party.bookingId,
          reference: party.reference,
          state: bookingStateOf(party),
          guests: party.guests,
          experience: slot.title,
          slot: { startsAt: slot.startsAt, timezone: slot.timezone },
          contact: { name: party.name },
          createdAt: new Date(
            new Date(slot.startsAt).getTime() - 3 * 86_400_000,
          ).toISOString(),
          money: bookingMoney(party),
          ...(party.cash
            ? {
                cash: { ...bookingCashOf(party), ...cashReturnOf(party) },
              }
            : {}),
          ...(bookingCancellationOf(party)
            ? { cancellation: bookingCancellationOf(party) }
            : {}),
          ...(party.screening ? { screening: party.screening } : {}),
          ...(party.questions ? { questions: party.questions } : {}),
        });
      }
    }

    const req = REQUESTS.find((r) => r.id === id);
    if (req) {
      return HttpResponse.json({
        id: req.id,
        state: "pending_request",
        guests: req.guests,
        experience: req.experience,
        slot: { startsAt: req.startsAt, timezone: req.timezone },
        contact: { name: req.contactName },
        createdAt: req.requestedAt,
      });
    }

    return HttpResponse.json(
      { error: { code: "not_found", message: "no such booking" } },
      { status: 404 },
    );
  }),

  /* ------------------------------------------------------------ requests - */

  http.get(url("/requests"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    // Answered requests leave the queue. Ordered soonest-to-expire, which is
    // the endpoint's own order and the whole shape of the screen.
    return HttpResponse.json({
      requests: REQUESTS.filter((r) => !answered[r.id]).sort(
        (a, b) => a.minutesToAnswer - b.minutesToAnswer,
      ),
    });
  }),

  http.post(url("/requests/:id/accept"), async ({ request, params }) => {
    const failed = requireManager(request, "STAFF cannot commit seats.");
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;

    const id = String(params.id);
    const open = REQUESTS.find((r) => r.id === id);
    if (!open) return envelope("not_found", "No such request.", 404);

    // Already answered, or out of time. One code for both, as the contract has
    // it — the operator's next move is the same either way: look again.
    if (answered[id]) {
      return envelope("request_not_open", "Already answered.", 409);
    }

    /*
      The ceiling is enforced here rather than assumed. A mock that grants
      anything lets a client ship without the disabled state, and the first
      time an operator meets it is on a dock with a full boat.
    */
    if (open.guests > open.seatsGrantable) {
      return envelope(
        "grant_ceiling_exceeded",
        "That would put more people on the departure than it holds.",
        409,
      );
    }

    answered[id] = "active";
    /*
      The traveller now holds seats with a clock on them and must pay: twelve
      hours, capped at the departure's booking cutoff (yuvoy-api#203), which an
      hour before it leaves stands in for here. Never less than ten minutes, so
      a run late at night still gets a hold in the future.
    */
    const cutoff = Date.parse(open.startsAt) - 60 * 60_000;
    const holdExpiresAt = new Date(
      Math.max(
        Math.min(Date.now() + 12 * 60 * 60_000, cutoff),
        Date.now() + 10 * 60_000,
      ),
    ).toISOString();
    /*
      `toldBy` and `receipt`, as the API writes them: queued by email because
      there is no WhatsApp sender, and the whole sentence with the pay-by time
      in market time, the day included when it is not today.
    */
    const told = ["email"];
    const seats = `${open.guests} ${open.guests === 1 ? "seat" : "seats"}`;
    return HttpResponse.json({
      id,
      state: "active",
      holdExpiresAt,
      toldBy: told,
      receipt: `They are holding ${seats} and still have to pay. We are letting them know by email. If they have not paid by ${deadlineLabel(holdExpiresAt, open.timezone, Date.now())}, the seats come back to you.`,
    });
  }),

  http.post(url("/requests/:id/decline"), async ({ request, params }) => {
    const failed = requireManager(request, "STAFF cannot answer requests.");
    if (failed) return failed;

    const id = String(params.id);
    if (!REQUESTS.some((r) => r.id === id)) {
      return envelope("not_found", "No such request.", 404);
    }
    if (answered[id]) {
      return envelope("request_not_open", "Already answered.", 409);
    }

    const { reasonCode } = (await request.json()) as { reasonCode?: string };
    if (!reasonCode) {
      return envelope("bad_request", "reasonCode is required.", 400);
    }

    answered[id] = "released";
    return HttpResponse.json({ id, state: "released", holdExpiresAt: null });
  }),

  /* -------------------------------------------------------------- money - */

  /*
    SETTLEMENTS — yuvoy-operator#47.

    `GET /earnings` and its month picker are gone: a calendar month was never
    the unit money moves in, so every figure it derived was one no transfer ever
    matched. These four fixtures are shaped to exercise the cases that are
    easy to get wrong rather than the happy one.

    `nextSettlement` carries a CORRECTION, because a settlement whose
    adjustment is zero never shows the row that explains why the rows do not add
    up to the total.

    `pipeline` and `paidAtCounter` are non-zero and deliberately NOT summable
    into anything: the contract says the pipeline "is never part of anything
    earned", and a fixture of zeros would let a screen add them in and still
    look right.
  */
  http.get(url("/settlements/overview"), async ({ request }) => {
    const failed = requireManager(request, "Requires OWNER, ADMIN or MANAGER.");
    if (failed) return failed;

    return HttpResponse.json({
      nextSettlement: {
        periodStart: "2026-09-07",
        periodEnd: "2026-09-13",
        settlesFrom: "2026-09-14",
        bookings: 6,
        grossPaise: 5400000,
        commissionPaise: 810000,
        refundsPaise: 450000,
        adjustmentsPaise: -125000,
        netPaise: 4015000,
      },
      pipeline: {
        bookings: 4,
        grossPaise: 3600000,
        commissionPaise: 540000,
        refundsPaise: 0,
        netPaise: 3060000,
      },
      paidAtCounter: {
        bookings: 3,
        farePaise: 2700000,
        commissionPaise: 405000,
        netPaise: 2295000,
        // The same held and unrecorded figures `/commission-owed` sends, so
        // Earnings and Cash agree, as the contract promises.
        heldBookings: COMMISSION_OWED.heldBookings,
        heldCollectedPaise: COMMISSION_OWED.heldCollectedPaise,
        unrecordedBookings: COMMISSION_OWED.unrecordedBookings,
        unrecordedFarePaise: COMMISSION_OWED.unrecordedFarePaise,
        unrecordedLines: COMMISSION_OWED.unrecordedLines,
      },
      seasonToDate: {
        from: "2026-04-01",
        settlements: 18,
        bookings: 214,
        grossPaise: 192600000,
        commissionPaise: 28890000,
        refundsPaise: 7200000,
        adjustmentsPaise: -340000,
        netPaise: 156170000,
      },
    });
  }),

  /*
    Past weeks, one of each state, most recent first.

    `complete: true` and no cursor: paging is exercised by the unit tests rather
    than by a fixture that would make every e2e read two pages.

    The oldest week is NEGATIVE. A correction larger than what a week pays makes
    the net below zero, and the contract says that week "is not paid until
    somebody at Yuvoy decides how to recover it". A fixture without one would
    let a screen render an absolute value and pass.
  */
  http.get(url("/settlements"), async ({ request }) => {
    const failed = requireManager(request, "Requires OWNER, ADMIN or MANAGER.");
    if (failed) return failed;

    return HttpResponse.json({
      items: [SETTLEMENT_SENT, SETTLEMENT_APPROVED, SETTLEMENT_OWED_BACK],
      complete: true,
      nextCursor: null,
    });
  }),

  http.get(url("/settlements/:id"), async ({ request, params }) => {
    const failed = requireManager(request, "Requires OWNER, ADMIN or MANAGER.");
    if (failed) return failed;

    const found = [
      SETTLEMENT_SENT,
      SETTLEMENT_APPROVED,
      SETTLEMENT_OWED_BACK,
    ].find((x) => x.id === params.id);
    if (!found) return envelope("not_found", "No such settlement.", 404);

    return HttpResponse.json({
      ...found,
      /*
        Two lines, and their nets deliberately do NOT add up to the
        settlement's: the difference is exactly `adjustmentsPaise`, which is on
        the settlement and on no line. That gap is the thing the screen has to
        explain, so the fixture has to contain it.

        The second line is a cancelled booking the operator kept money on: a
        commission of 0, because we take none on a booking that did not happen.
      */
      lines: [
        {
          bookingId: "bk_stl_1",
          reference: "YV-7KJ2MQ",
          tripDate: "2026-09-09",
          guests: 2,
          grossPaise: 3600000,
          commissionPaise: 540000,
          refundedPaise: 0,
          netPaise: 3060000,
        },
        {
          bookingId: "bk_stl_2",
          reference: "YV-9PL4XR",
          tripDate: "2026-09-11",
          guests: 1,
          grossPaise: 1800000,
          commissionPaise: 0,
          refundedPaise: 900000,
          netPaise: 900000,
        },
      ],
    });
  }),

  /*
    The statement, with the header that lets an operator prove they hold the
    same file we do. The sha256 is COMPUTED from the body rather than
    hardcoded, so the fixture cannot drift out of agreement with itself and
    silently make the integrity check look broken.
  */
  http.get(url("/settlements/:id/statement"), async ({ request, params }) => {
    const failed = requireManager(request, "Requires OWNER, ADMIN or MANAGER.");
    if (failed) return failed;

    if (params.id !== SETTLEMENT_SENT.id) {
      return envelope("not_settled", "This payout has not been sent yet.", 409);
    }

    const csv = STATEMENT_CSV;
    const digest = await sha256Hex(csv);
    return new HttpResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "X-Payout-Sha256": digest,
        "Content-Disposition": `attachment; filename="yuvoy-statement-${SETTLEMENT_SENT.periodStart}-to-${SETTLEMENT_SENT.periodEnd}.csv"`,
      },
    });
  }),

  /*
    WHAT IS OWED ON CASH — yuvoy-operator#40 §2.

    Three completed cash trips, because the screen's whole argument is that
    every line is checkable — a single-line fixture would let the list be
    rendered as a total and still pass. The third line carries a SHORTFALL:
    the operator took less than the fare, and our share is owed on the fare
    regardless ("a discount you gave is yours to have given"), which is the
    one row on this screen whose arithmetic looks wrong until it is explained.

    The MANAGER identity owes nothing, which is the zero case — real, common,
    and a sentence rather than a table of ₹0.
  */
  http.get(url("/commission-owed"), async ({ request }) => {
    const failed = requireManager(request, "Requires OWNER, ADMIN or MANAGER.");
    if (failed) return failed;

    /*
      Dev Kapoor (MANAGER) owes nothing; the owner owes for three trips. Keyed
      on identity because that is how every other branch in these mocks varies
      — this repo has no scenario switch — and it buys the zero case a real
      screen to be rendered on. `bookings: 0` is not an error and not a
      spinner, and it is common: every cash trip settled, or none taken yet.
    */
    if (sessionUser(request)!.id === "usr_manager_dev") {
      return HttpResponse.json({
        bookings: 0,
        farePaise: 0,
        collectedPaise: 0,
        commissionPaise: 0,
        lines: [],
        heldBookings: 0,
        heldFarePaise: 0,
        heldCollectedPaise: 0,
        heldCommissionPaise: 0,
        heldLines: [],
        unrecordedBookings: 0,
        unrecordedFarePaise: 0,
        unrecordedLines: [],
      });
    }

    return HttpResponse.json(COMMISSION_OWED);
  }),

  /*
    One business's changes, and only that business's.

    `CHANGE_REQUESTS` is Reef Divers' history and `bankChanges` records who
    raised each one, so a signup identity sees an empty list until it raises
    something of its own. Before this, every identity in the mock saw Reef
    Divers' open change — which made a brand-new account's Payout screen say
    "there is already a change in progress" before it had ever had a bank
    account, and made any test on a second identity depend on whether another
    spec had raised one first.

    `raisedFor` is stripped on the way out: it is bookkeeping this mock needs
    and not a field the API sends.
  */
  http.get(url("/change-requests"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const live = changesFor(request).map((r) =>
      stoppedChanges.includes(String((r as { id?: string }).id))
        ? { ...r, state: "withdrawn" }
        : r,
    );
    return HttpResponse.json({ requests: live });
  }),

  /* --------------------------------------------------------- step up ---- */

  http.post(url("/auth/step-up"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    /*
      `sent: false` when there is NOBODY to send it to — yuvoy-operator#46
      item 4.

      "A business with no active owner, whose first person runs it (D15), has
      nobody to send it to. The code goes to no number, `sent` is `false`, and
      no session there can be elevated until an owner has joined."

      Modelled by looking at the team, because the portal had been returning
      `sent: true` whatever the API said — so somebody at such a business was
      handed a code field and left typing into it. A mock that always sent one
      would have kept that invisible.
    */
    const me = sessionUser(request)!;
    /*
      Whose business, and therefore whose owners. An identity created through
      `POST /auth/signup` is a business of its own with exactly one person on
      it, so asking Reef Divers' team about it would answer for somebody else's
      shop — and the one business that can have no owner is precisely the solo
      one whose first person answered "I run it for the owner".
    */
    const onReef = team.some((m) => m.id === me.id);
    const hasActiveOwner = onReef
      ? team.some(
          (m) =>
            !m.pending && m.state !== "suspended" && m.roles.includes("OWNER"),
        )
      : me.roles.includes("OWNER");
    if (!hasActiveOwner) {
      return HttpResponse.json({ sent: false }, { status: 202 });
    }

    // Sent to the OWNER's number whoever asks. The mock does not model a
    // second user, but it does model that asking is not the same as receiving.
    return HttpResponse.json(
      { sent: true, expiresIn: 600, devCode: DEV_CODE },
      { status: 202 },
    );
  }),

  http.post(url("/auth/step-up/verify"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const { code } = (await request.json()) as { code?: string };
    if (code !== DEV_CODE) {
      // Wrong, expired and used all answer the same way.
      return envelope("unauthorized", "That code did not work.", 401);
    }
    steppedUp = true;
    return HttpResponse.json({ elevated: true, expiresIn: 600 });
  }),

  /* ------------------------------------------------------ bank change --- */

  http.post(url("/change-requests/bank"), async ({ request }) => {
    /*
      The gates are enforced, not assumed. A mock that raises a change without
      step-up would let the client ship without the code step — and the first
      time anybody found out would be in production, on the one flow where the
      whole design is the gate.

      **Both** gates, since 6 September. The contract has always said the 403
      is "also returned to anyone who is not the OWNER" and this mock checked
      only the step-up, so the client's own OWNER gate on the bank form had
      never once been exercised against a refusal — the same hole the 2
      September audit found across the manager-only writes.

      The role is checked FIRST: somebody who may not do this at all should be
      refused for who they are, not sent to fetch a code that will not help.
      Note that requesting the code is deliberately open to anybody — "the code
      goes to the OWNER's number whoever asks" — so this is the only place the
      role can be refused.

      This is now the ONLY genuinely OWNER-only endpoint in the contract:
      `POST /change-requests/{id}/cancel` widened to OWNER or ADMIN, and so did
      all four team writes.
    */
    const failed = requireOwner(request);
    if (failed) return failed;

    /*
      Raising a change is refused while suspended; stopping one is not
      (yuvoy-operator#50). After the role gate, for the reason the role gate is
      first: somebody who may not do this at all should be refused for who they
      are rather than for the state of the business.
    */
    const shut = requireWritable(request);
    if (shut) return shut;

    if (!steppedUp) {
      return envelope("step_up_required", "Ask for a code first.", 403);
    }
    if (!sessionUser(request)!.roles.includes("OWNER")) {
      return envelope("forbidden", "Only the owner can change this.", 403);
    }

    /*
      Open BANK changes only. The list also carries logo and details changes
      waiting for review (the same table, another `kind`), and one of those in
      flight says nothing about where the money goes: counting it refused
      every bank change raised after a live business sent a new logo.
    */
    const open = changesFor(request).filter(
      (r) =>
        (r as { kind?: string }).kind === "bank" &&
        !stoppedChanges.includes(String((r as { id?: string }).id)) &&
        ["objection_window", "pending", "cooling", "approved"].includes(
          String((r as { state?: string }).state),
        ),
    );
    if (open.length > 0) {
      // "Two open bank changes would mean the second approval silently decides
      // which account wins."
      return envelope(
        "change_already_in_progress",
        "Cancel the open one first.",
        409,
      );
    }

    const body = (await request.json()) as {
      accountHolder?: string;
      accountNumber?: string;
      ifsc?: string;
      bankName?: string;
    };
    const account = (body.accountNumber ?? "").replace(/\s/g, "");
    if (!/^\d{9,18}$/.test(account)) {
      return envelope(
        "invalid_input",
        "accountNumber must be 9-18 digits.",
        400,
      );
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test((body.ifsc ?? "").toUpperCase())) {
      return envelope("invalid_input", "ifsc is malformed.", 400);
    }

    const id = `chg_${Math.random().toString(36).slice(2, 10)}`;
    const objectionUntil = new Date(Date.now() + 24 * 3600_000).toISOString();
    // Masked. Only the last four digits are ever stored.
    const summary = `${body.bankName || "Bank"} ••••${account.slice(-4)} · ${(body.ifsc ?? "").toUpperCase()}`;

    bankChanges.unshift({
      // Whose it is. See `changesFor`.
      raisedFor: businessOf(request),
      id,
      kind: "bank",
      state: "objection_window",
      summary,
      requestedAt: new Date().toISOString(),
      objectionUntil,
      coolingUntil: null,
    });

    return HttpResponse.json(
      {
        id,
        state: "objection_window",
        summary,
        objectionUntil,
        whatHappensNext:
          "We have messaged the owner. You can stop this for the next 24 hours. After that a person at Yuvoy reviews it, and it goes live 24 hours after they approve — still stoppable the whole time.",
      },
      { status: 202 },
    );
  }),

  http.post(url("/change-requests/:id/cancel"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const id = String(params.id);
    /*
      Scoped to the caller's own business. Another business's change is a `404`,
      never a `403` — "a row belonging to another operator answers 404, never
      403. A 403 would confirm the row exists, which is precisely what somebody
      probing ids wants to learn."
    */
    const found = (
      changesFor(request) as { id?: string; state?: string }[]
    ).find((r) => r.id === id);
    if (!found) return envelope("not_found", "No such change.", 404);

    if (stoppedChanges.includes(id) || found.state === "applied") {
      /*
        Distinguished from 404 on purpose: "we cannot find it" and "it already
        happened" mean very different things to somebody who has just realised
        their account was compromised.
      */
      return envelope(
        "change_already_decided",
        "It has already gone through.",
        409,
      );
    }

    /*
      Marked withdrawn rather than removed. A cancelled change is part of the
      account's history — an owner who stopped one needs to be able to show
      that they did, and a record that disappears is the opposite of an audit
      trail. `withdrawn` is in the contract's own state enum for this.
    */
    stoppedChanges.push(id);
    return new HttpResponse(null, { status: 204 });
  }),

  /* ------------------------------------------------------------ capacity - */

  http.patch(url("/slots/:id"), async ({ request, params }) => {
    const failed = requireManager(request, "Requires OWNER, ADMIN or MANAGER.");
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;

    const id = String(params.id);
    const slot = SLOTS.find((s) => s.id === id);
    if (!slot) return envelope("not_found", "No such departure.", 404);

    const { seats } = (await request.json()) as { seats?: number };
    if (
      typeof seats !== "number" ||
      !Number.isInteger(seats) ||
      seats < 0 ||
      seats > 200
    ) {
      return envelope("invalid_input", "seats must be 0 to 200.", 400);
    }

    /*
      The floor is enforced, not assumed. "Not 'should not' — the database
      refuses it, because the alternative is a traveller with a paid booking
      and no seat, discovered at a jetty at six in the morning." Reducing to
      EXACTLY what is sold is allowed: it closes the departure without
      stranding anyone.

      The 409 message is written the way the contract describes — copy telling
      the operator what to do instead — because the client renders it verbatim.
    */
    if (seats < slot.sold) {
      return envelope(
        "conflict",
        `${slot.sold} seats are already sold on this departure. Set it to ${slot.sold} to close it without stranding anyone, or call the departure off.`,
        409,
      );
    }

    capacity[id] = seats;
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(url("/blackouts"), async ({ request }) => {
    const failed = requireManager(request, "Requires OWNER, ADMIN or MANAGER.");
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;

    const body = (await request.json()) as {
      from?: string;
      to?: string;
      reasonCode?: string;
      experienceId?: string;
      note?: string;
    };
    const REASONS = [
      "WEATHER",
      "MAINTENANCE",
      "STAFF",
      "PERSONAL",
      "SEASONAL",
      "OTHER",
    ];
    const shape = /^\d{4}-\d{2}-\d{2}$/;
    if (
      !body.from ||
      !body.to ||
      !shape.test(body.from) ||
      !shape.test(body.to)
    ) {
      return envelope("invalid_input", "from and to must be dates.", 400);
    }
    if (body.to < body.from) {
      return envelope("invalid_input", "to cannot precede from.", 400);
    }
    if (!body.reasonCode || !REASONS.includes(body.reasonCode)) {
      return envelope("invalid_input", "Unknown reasonCode.", 400);
    }

    /*
      Closing dates is NOT cancelling people. The count includes live holds,
      whose bookings predate the closure and can still complete — which is
      exactly the thing an operator assumes did not survive.

      Counted across the range whatever its departures' status, so closing a
      day twice still reports who is owed on it; a called-off departure owes
      nobody. And the closure is RECORDED, so `GET /slots` reads it back the
      way the API does — `closed`, and not on sale — for one listing when the
      body names one, and for every listing when it does not.
    */
    const inRange = allSlots().filter((s) => {
      if (calledOff[s.id] || s.status === "cancelled") return false;
      if (body.experienceId && s.experienceId !== body.experienceId) {
        return false;
      }
      const day = slotDay(s);
      return day >= body.from! && day <= body.to!;
    });
    const existingBookings = inRange.reduce((n, s) => n + s.parties.length, 0);

    /*
      The departures it holds are recorded WITH it, at this moment: "including
      any that another closure had already closed", because reopening "puts back
      exactly those departures". A closure that recomputed its scope later would
      reopen a departure added to the day afterwards, which nobody closed.
    */
    const id = `blk_${Math.random().toString(36).slice(2, 10)}`;
    blackouts.push({
      id,
      from: body.from,
      to: body.to,
      reasonCode: body.reasonCode,
      ...(body.note ? { note: body.note } : {}),
      ...(body.experienceId ? { experienceId: body.experienceId } : {}),
      createdAt: new Date().toISOString(),
      departureIds: inRange.map((s) => s.id),
    });

    return HttpResponse.json({
      id,
      closed: true,
      existingBookings,
      ...(existingBookings > 0
        ? {
            note: "The bookings you already have still stand — including anyone mid-checkout, whose hold predates the closure and can still complete. Run them, or call each departure off individually.",
          }
        : {}),
    });
  }),

  /**
   * Closures read back — yuvoy-operator#45 item 1.
   *
   * "Every closure touching the range, reopened ones included; those carry
   * `reopenedAt`." Reopened ones are sent on purpose: a mock that hid them would
   * let the portal ship without checking `reopenedAt`, and every reopened day
   * would read as closed for the rest of the season.
   */
  http.get(url("/blackouts"), async ({ request }) => {
    // "Any operator user may read it." No role gate, deliberately.
    const failed = requireSession(request);
    if (failed) return failed;

    const params = new URL(request.url).searchParams;
    const from = params.get("from") ?? "";
    const to = params.get("to") ?? "";

    /*
      "Only closures whose last day is on or after `from`" and "whose first day
      is on or before `to`" — overlap, not containment. A closure running from
      last week into next week touches this fortnight and a containment test
      would drop it, which is the one an operator would most want to see.
    */
    const touching = blackouts
      .filter((b) => (!from || b.to >= from) && (!to || b.from <= to))
      .sort((a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id));

    const limitRaw = Number(params.get("limit"));
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const cursor = params.get("cursor");
    let start = 0;
    if (cursor !== null) {
      const parsed = Number(cursor);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > touching.length) {
        return envelope("invalid_input", "Not a cursor we issued.", 400);
      }
      start = parsed;
    }
    const page = touching.slice(start, start + limit);
    const end = start + page.length;

    return HttpResponse.json({
      items: page,
      // "Told rather than inferred … Do not infer the end from a short page."
      complete: end >= touching.length,
      ...(end < touching.length ? { nextCursor: String(end) } : {}),
    });
  }),

  /**
   * Reopen one closure — yuvoy-operator#45 item 2.
   *
   * The two counts are the point. "A departure it holds goes back to open only
   * if it is still closed, has not left yet, and no other closure still in force
   * holds it. **A called-off departure is never reopened.**" A mock that simply
   * dropped the closure and reported success would let the portal ship a screen
   * that says a day is back on sale when half of it is not.
   */
  http.post(url("/blackouts/:id/reopen"), async ({ request, params }) => {
    const failed = requireManager(request, "Requires OWNER, ADMIN or MANAGER.");
    if (failed) return failed;

    const id = String(params.id);
    const closure = blackouts.find((b) => b.id === id);
    if (!closure) return envelope("not_found", "No such closure.", 404);
    if (closure.reopenedAt) {
      return envelope("already_reopened", "This was reopened before.", 409);
    }

    closure.reopenedAt = new Date().toISOString();

    /*
      Counted AFTER the closure is marked reopened, so `closedByAny` sees the
      world as it now is: a departure another closure still holds is counted as
      still closed, which is exactly what `departuresStillClosed` means.
    */
    const held = allSlots().filter((s) => closure.departureIds.includes(s.id));
    let reopened = 0;
    let stillClosed = 0;
    for (const slot of held) {
      // "Its departures that have already left stay closed, because they did
      // pass closed", and a called-off one is never reopened.
      if (calledOff[slot.id] || Date.parse(slot.startsAt) <= Date.now()) {
        continue;
      }
      if (closedByAny(slot)) stillClosed += 1;
      else reopened += 1;
    }

    return HttpResponse.json({
      id,
      reopenedAt: closure.reopenedAt,
      departuresReopened: reopened,
      departuresStillClosed: stillClosed,
      // "Say this out loud. It gives both counts in words."
      note:
        stillClosed > 0
          ? `${reopened === 1 ? "1 departure is" : `${reopened} departures are`} back on sale. ${stillClosed === 1 ? "1 is" : `${stillClosed} are`} still closed by another closure.`
          : `${reopened === 1 ? "1 departure is" : `${reopened} departures are`} back on sale.`,
    });
  }),

  /**
   * Close ONE departure — yuvoy-operator#45 item 4.
   *
   * "It is a closure like a closed date: `GET /blackouts` reads it back with
   * `departureId`, and `POST /blackouts/{id}/reopen` reopens it." So it makes a
   * real closure record rather than flipping a status, which is what lets the
   * calendar offer the way back.
   */
  http.post(url("/slots/:id/close"), async ({ request, params }) => {
    const failed = requireManager(request, "Requires OWNER, ADMIN or MANAGER.");
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;

    const id = String(params.id);
    const slot = allSlots().find((s) => s.id === id);
    if (!slot) return envelope("not_found", "No such departure.", 404);

    const body = (await request.json()) as {
      reasonCode?: string;
      note?: string;
    };
    if (
      !body.reasonCode ||
      ![
        "WEATHER",
        "MAINTENANCE",
        "STAFF",
        "PERSONAL",
        "SEASONAL",
        "OTHER",
      ].includes(body.reasonCode)
    ) {
      return envelope("invalid_input", "Unknown reasonCode.", 400);
    }

    if (calledOff[id] || slot.status === "cancelled") {
      return envelope(
        "already_called_off",
        "This departure was called off, so there is nothing to close.",
        409,
      );
    }
    if (Date.parse(slot.startsAt) <= Date.now()) {
      return envelope("departure_started", "That departure has left.", 409);
    }

    /*
      "Closing a departure that is already closed on its own answers with the
      closure that holds it rather than making a second one." Two closures on
      one departure would need two reopens to undo one act.
    */
    const existing = blackouts.find(
      (b) => b.departureId === id && !b.reopenedAt,
    );
    const closureId =
      existing?.id ?? `blk_${Math.random().toString(36).slice(2, 10)}`;
    if (!existing) {
      const day = slotDay(slot);
      blackouts.push({
        id: closureId,
        from: day,
        to: day,
        reasonCode: body.reasonCode,
        ...(body.note ? { note: body.note } : {}),
        departureId: id,
        createdAt: new Date().toISOString(),
        departureIds: [id],
      });
    }

    const existingBookings = slot.parties.length;
    return HttpResponse.json({
      id: closureId,
      closed: true,
      existingBookings,
      ...(existingBookings > 0
        ? {
            note: "The bookings already on this departure still stand, including anyone mid-checkout. Closing it stops new ones and cancels nobody.",
          }
        : {}),
    });
  }),

  http.post(url("/slots/:id/offline-sales"), async ({ request, params }) => {
    const failed = requireManager(request, "Requires OWNER, ADMIN or MANAGER.");
    if (failed) return failed;
    const shut = requireWritable(request);
    if (shut) return shut;

    const id = String(params.id);
    const slot = SLOTS.find((s) => s.id === id);
    if (!slot) return envelope("not_found", "No such departure.", 404);

    const { seats } = (await request.json()) as { seats?: number };
    if (
      typeof seats !== "number" ||
      !Number.isInteger(seats) ||
      seats < 1 ||
      seats > 200
    ) {
      return envelope("invalid_input", "seats must be 1 to 200.", 400);
    }

    /*
      A REPORT, not a request. Accepted even when it is bad news: "refusing it
      would not un-sell the seats — it would only keep our numbers wrong until
      eleven people and a six-person boat meet at a jetty."
    */
    const offered = capacity[id] ?? slot.seats;
    const previouslyOffline = offlineSold[id] ?? 0;
    offlineSold[id] = previouslyOffline + seats;

    const taken = slot.sold + offlineSold[id];
    const over = taken - offered;

    const result: Record<string, unknown> = {
      seatsRecorded: seats,
      // Never negative: an oversell is an incident, not a number on a screen.
      seatsRemaining: Math.max(0, offered - taken),
      totalSoldOffline: offlineSold[id],
    };

    if (over > 0) {
      // Travellers who paid us now have no seat.
      const stranded = slot.parties.filter((p) => p.bookingId).slice(0, over);
      result.oversold = {
        guests: over,
        bookings: stranded.map((p) => p.reference),
        message: `${over} ${over === 1 ? "guest has" : "guests have"} paid for a seat that no longer exists on this departure.`,
        incidentId: `inc_${id}_${Date.now().toString(36)}`,
      };
    }

    return HttpResponse.json(result);
  }),

  /* --------------------------------------------------------------- relay - */

  http.post(url("/bookings/:id/relay"), async ({ request, params }) =>
    relay(request, () => {
      const found = partyOf(String(params.id));
      return found ? [found.party] : null;
    }),
  ),

  http.post(url("/slots/:id/relay"), async ({ request, params }) =>
    relay(request, () => {
      const slot = SLOTS.find((s) => s.id === String(params.id));
      // A live hold has no booking to message; `relay` keeps only bookings.
      return slot ? slot.parties : null;
    }),
  ),

  /* ------------------------------------------------------------- call off - */

  http.post(url("/slots/:id/call-off"), async ({ request, params }) => {
    const failed = requireManager(
      request,
      "STAFF cannot call off a departure.",
    );
    if (failed) return failed;

    const id = String(params.id);
    const slot = SLOTS.find((s) => s.id === id);
    if (!slot) return envelope("not_found", "No such departure.", 404);

    if (calledOff[id] || slot.status === "cancelled") {
      return envelope(
        "already_called_off",
        "Everybody on it has already been told.",
        409,
      );
    }

    const body = (await request.json()) as {
      reasonCode?: string;
      confirmSlotId?: string;
      note?: string;
    };

    const REASONS = [
      "weather",
      "equipment",
      "staffing",
      "safety",
      "insufficient_numbers",
    ];
    if (!body.reasonCode || !REASONS.includes(body.reasonCode)) {
      return envelope("invalid_input", "Pick a reason.", 400);
    }

    /*
      The confirmation is enforced here, not just in the UI. It is the only
      irreversible action in the portal, and a mock that accepts any string
      would let a client ship without the guard.
    */
    if (body.confirmSlotId !== id) {
      return envelope(
        "invalid_input",
        "confirmSlotId must equal the departure's own id.",
        400,
      );
    }

    const confirmed = slot.parties.filter(
      (p) => p.bookingId && bookingStateOf(p) !== "cancelled",
    );
    const holds = slot.parties.filter((p) => !p.bookingId);

    calledOff[id] = body.reasonCode;
    const giveBack = cashToGiveBackOf(slot);

    return HttpResponse.json({
      slotId: id,
      reasonCode: body.reasonCode,
      bookingsCancelled: confirmed.length,
      guestsAffected: confirmed.reduce((n, p) => n + p.guests, 0),
      /*
        Full refunds regardless of the cancellation policy: those tiers price a
        traveller changing their mind, and nobody changed their mind here. But
        only what was captured ONLINE: a cash booking captured nothing, so it
        adds nothing here and its money is in `cashToGiveBack` instead.
      */
      refundedPaise: confirmed
        .filter((p) => !p.cash)
        .reduce((n, p) => n + p.guests * 450000, 0),
      holdsReleased: holds.length,
      ...(giveBack ? { cashToGiveBack: giveBack } : {}),
    });
  }),

  /* ---------------------------------------------------------- attendance - */

  http.post(url("/bookings/:id/attendance"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const id = String(params.id);
    const found = partyOf(id);
    if (!found) return envelope("not_found", "No such booking.", 404);

    const { outcome } = (await request.json()) as { outcome: string };
    const slot = SLOTS.find((s) => s.id === found.slotId)!;
    const departed = Date.now() >= new Date(slot.startsAt).getTime();

    const existing = attendance[id];
    if (existing && existing.outcome !== "arrived") {
      // Re-settling is refused rather than silently overwritten.
      return envelope(
        "not_on_this_departure",
        "This booking is already settled.",
        409,
      );
    }

    if (outcome === "arrived") {
      // Idempotent: a second tap keeps the first arrival time.
      const arrivedAt = existing?.arrivedAt ?? new Date().toISOString();
      attendance[id] = { outcome: "arrived", arrivedAt };
      return HttpResponse.json({ outcome: "arrived", arrivedAt });
    }

    if (!departed) {
      return envelope(
        "departure_has_not_started",
        "Wait until the trip has set off.",
        409,
      );
    }

    attendance[id] = { outcome, arrivedAt: existing?.arrivedAt };
    return HttpResponse.json({ outcome, arrivedAt: existing?.arrivedAt });
  }),

  /* -------------------------------------------------------------- cash -- */

  /**
   * Taking the cash — yuvoy-operator#40 §1.
   *
   * The API's own rules, in the API's own order (`RecordCashCollected`):
   *
   *   1. not a cash booking → 409, "already paid online";
   *   2. already recorded → the FIRST report, `alreadyRecorded: true`, the
   *      amount never overwritten — checked before the state, so a retry on a
   *      booking that has since been completed still gets its answer;
   *   3. a booking that can no longer take money → 409;
   *   4. more than the fare → 409, refused rather than trimmed.
   *
   * Not role-gated: "whoever is holding the phone at the gangway is who takes
   * the cash." The messages are production's, lower case and all, because the
   * screen renders them.
   */
  http.post(
    url("/bookings/:id/cash-collected"),
    async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      const id = String(params.id);
      const found = partyOf(id);
      if (!found)
        return envelope("not_found", "we could not find that booking", 404);

      const { party } = found;
      if (!party.cash) {
        return envelope(
          "conflict",
          "this booking was already paid online — there is nothing to collect",
          409,
        );
      }

      const fare = party.cash.collectPaise;
      const first =
        cashTaken[id] ??
        (party.cash.collected && party.cash.collectedAt
          ? {
              collectedPaise: party.cash.collectedPaise ?? fare,
              collectedAt: party.cash.collectedAt,
            }
          : undefined);
      if (first) {
        return HttpResponse.json({
          collectedPaise: first.collectedPaise,
          shortfallPaise: fare - first.collectedPaise,
          collectedAt: first.collectedAt,
          state: bookingStateOf(party),
          alreadyRecorded: true,
        });
      }

      const state = bookingStateOf(party);
      if (state !== "paid_pending_ops" && state !== "confirmed") {
        return envelope(
          "conflict",
          `this booking is not on the departure: it is ${state}`,
          409,
        );
      }

      const body = (await request.json().catch(() => ({}))) as {
        collectedPaise?: unknown;
      };
      let amount = fare;
      if (body.collectedPaise !== undefined) {
        if (
          typeof body.collectedPaise !== "number" ||
          !Number.isInteger(body.collectedPaise) ||
          body.collectedPaise < 0
        ) {
          return envelope("invalid_input", "that is not an amount", 400);
        }
        amount = body.collectedPaise;
      }
      if (amount > fare) {
        return envelope(
          "conflict",
          "that is more than the fare for this booking",
          409,
        );
      }

      const collectedAt = new Date().toISOString();
      cashTaken[id] = { collectedPaise: amount, collectedAt };
      return HttpResponse.json({
        collectedPaise: amount,
        shortfallPaise: fare - amount,
        collectedAt,
        state: "confirmed",
        alreadyRecorded: false,
      });
    },
  ),
];
