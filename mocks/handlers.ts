import { http, HttpResponse } from "msw";
import { apiBaseUrl } from "../src/lib/api/server-client";
import { marketDate } from "../src/lib/format/market-time";
import {
  MOCK_TUS_PORT,
  mockPhotoArrived,
  resetMockPhotos,
  createMockUpload,
  mockUploadDone,
  resetMockUploads,
} from "./tus-server";
import { validateRelay } from "../src/lib/day/relay-types";
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
  EARNINGS,
  FAILING_ID,
  OPERATOR,
  OTHER_MEMBERS,
  LIVE_OUTSTANDING_ID,
  PROSPECT_ID,
  SUSPENDED_ID,
  REQUESTS,
  SLOTS,
  TEAM,
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

/** OWNER or MANAGER, exactly as `GET /me` defines it. */
const canManage = (member: MockTeamMember) =>
  member.roles.includes("OWNER") || member.roles.includes("MANAGER");

let attendance: Record<string, { outcome: string; arrivedAt?: string }> = {};
/** Wrong sign-in codes per number. The sixth answers 429. */
let codeAttempts: Record<string, number> = {};
const CODE_ATTEMPT_LIMIT = 5;
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
  listing?: { experienceId: string; title: string; state: string };
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
  /*
    The mandatory fields still empty — yuvoy-operator#30 §3. Computed rather
    than stored, so a fixture cannot claim a listing is ready while missing
    something the API would refuse.
  */
  publishBlockers?: string[];
  upcomingDepartures?: number;
  sellable?: boolean;
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

let mockExperiences: MockExperience[] = seedExperiences();

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
  };
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
  editable: boolean;
  submittedAt?: string;
};

function seedProfile(): MockProfile {
  return {
    displayName: BUSINESS_NAME,
    legalName: "Nemo Reef Watersports",
    entityType: "sole_proprietor",
    address: { line1: "Beach 3", locality: "Havelock", country: "IN" },
    // Editable, because the fixture account is still onboarding. The LIVE
    // lock is exercised by `PROFILE_LOCKED_ID` below.
    editable: true,
  };
}

let profile: MockProfile = seedProfile();

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
let blackouts: { from: string; to: string; experienceId?: string }[] = [];

/** A departure's status as the API would answer it now. */
function slotStatusOf(slot: MockSlot): string {
  if (calledOff[slot.id]) return "cancelled";
  if (slot.status !== "open") return slot.status;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: slot.timezone,
  }).format(new Date(slot.startsAt));
  const closed = blackouts.some(
    (b) =>
      day >= b.from &&
      day <= b.to &&
      (!b.experienceId || b.experienceId === slot.experienceId),
  );
  return closed ? "closed" : "open";
}

/**
 * Whether a departure is on sale, and the API's sentence when it is not — the
 * part of `OperatorSaleBlock` (yuvoy-api `catalog/operator_sale.go`) the
 * fixtures can reach, in its order and with its words.
 *
 * Including its one wrong sentence: a called-off departure is
 * `departure_closed` there too, with "Anybody already booked on it is
 * unaffected". Modelled on purpose, so the screen's refusal to print that
 * about a call-off is exercised rather than assumed.
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
  if (slotStatusOf(slot) !== "open") {
    return notOnSale(
      "departure_closed",
      "This departure is closed. Anybody already booked on it is unaffected.",
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
  return { onSale: true };
}

/** Reset between tests so one case cannot make the next pass. */
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
  stoppedChanges = [];
  team = TEAM.map((m) => ({ ...m }));
  signups = [];
  uploadIntents = {};
  mediaAssets = seedMediaAssets();
  profile = seedProfile();
  filedCredentials = {};
  mockExperiences = seedExperiences();
  createdSlots = [];
  cashTaken = {};
  story = seedStory();
  resetMockUploads();
  resetMockPhotos();
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
  return { ...profile, missing };
}

function envelope(code: string, message: string, status: number) {
  return HttpResponse.json({ error: { code, message } }, { status });
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
    A suspended business answers 403 on EVERY endpoint, not only `/me`. The
    session is valid and the person is fine — the contract is explicit that
    those are different things — so this is deliberately not a 401, and
    clearing their cookie would tell them the wrong story entirely.
  */
  if (user.id === SUSPENDED_ID) {
    return envelope(
      "account_not_active",
      "This account cannot trade right now.",
      403,
    );
  }
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
 * `canManage` is "OWNER or MANAGER" and gates capacity, closed dates, earnings
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
 * on an owner or on another admin.
 *
 * Modelled rather than collapsed into `requireInviter`, because the extra
 * clause is the whole difference between the two: an admin who could demote
 * another admin could demote the owner's stand-in and then invite themselves a
 * replacement. A mock that gated these on "owner or admin" alone would let the
 * portal ship a Team screen offering an admin controls the API refuses.
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

  if (
    !roles.includes("OWNER") &&
    (member.roles.includes("OWNER") || member.roles.includes("ADMIN"))
  ) {
    return {
      refusal: envelope(
        "forbidden",
        "An admin cannot change an owner or another admin.",
        403,
      ),
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
 * OWNER or MANAGER — `canManage`, exactly as `GET /me` defines it.
 *
 * Every write that commits seats or money is gated on it in the contract:
 * accept and decline ("STAFF cannot commit seats / answer requests"), seats,
 * closed dates, counter sales and call-off ("Requires OWNER or MANAGER"), and
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
  const outcome = attendance[p.bookingId]?.outcome;
  if (outcome && outcome !== "arrived") return outcome;
  return cashTaken[p.bookingId] ? "confirmed" : p.state;
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
const relay = async (request: Request, recipientsOf: () => number | null) => {
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

  const recipients = recipientsOf();
  if (recipients === null) {
    return envelope("not_found", "No such departure or booking.", 404);
  }

  return HttpResponse.json({
    batchId: `batch_${Math.random().toString(36).slice(2, 10)}`,
    intent: body.intent,
    recipients,
  });
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
    if (!canManage(sessionUser(request)!)) {
      return envelope(
        "forbidden",
        "only an owner or manager can take a listing off sale",
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
            note: "This listing is off sale — nobody new can book it. The 3 bookings you have already taken are unchanged. You still need to run those departures, or call each one off yourself.",
          }
        : {}),
      /*
        The API's sentence, as yuvoy-api#167 rewrote it. It used to say "ask us
        to put it back … we check it before travellers see it again", which
        D-032.4 had made false — resuming is the operator's own button and is
        immediate — and the portal suppressed it for that reason. Both the
        wording and the suppression are gone.
      */
      next: "Put it back on sale yourself whenever you are ready. There is a button for it on this listing, and it takes effect at once.",
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
    if (!canManage(sessionUser(request)!)) {
      return envelope(
        "forbidden",
        "only an owner or manager can put a listing back on sale",
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
        ? "It is back on your listings. This one is still waiting for its first check, so travellers cannot see it yet."
        : listing.sellable === false
          ? "It is back on your listings. Something on your account is stopping sales, so travellers cannot book it yet. Business says what."
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
      email?: string;
    };
    const businessName = (body.businessName ?? "").trim();
    const name = (body.name ?? "").trim();
    const phone = (body.phone ?? "").trim();

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

    const taken = [...team, ...OTHER_MEMBERS, ...signups].some(
      (m) => m.phone === phone,
    );
    if (!taken) {
      signups.push({
        id: `usr_signup_${Math.random().toString(36).slice(2, 10)}`,
        name,
        // The first OWNER of the new business, as the contract says.
        roles: ["OWNER"],
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
    /*
      `account` is per-BUSINESS, not per-user, so it is keyed off the identity
      that stands in for one here. The upload-drop and API-failure identities
      deliberately get NO account block: absent is a real response shape and
      the contract says what it means — "unknown, never everything is fine" —
      so the screen that must not read it as approval has something to be
      tested against.
    */
    const account =
      me.id === PROSPECT_ID || signups.some((sme) => sme.id === me.id)
        ? /*
            A brand-new account is PROSPECT and cannot be booked — that is the
            whole safety property of self-signup, and a mock that handed one
            ACCOUNT_LIVE would let this portal ship the congratulation the API
            never earns.
          */
          ACCOUNT_PROSPECT
        : me.id === AWAITING_ID
          ? ACCOUNT_AWAITING
          : me.id === LIVE_OUTSTANDING_ID
            ? /*
                Live, selling, and still owing us the logo and the registered
                address — yuvoy-operator#38. Branched BEFORE the
                `OTHER_MEMBERS` fallthrough, which hands back no account block
                at all, because this identity exists to render a screen rather
                than to hide one.
              */
              ACCOUNT_LIVE_OUTSTANDING
            : OTHER_MEMBERS.some((o) => o.id === me.id)
              ? undefined
              : ACCOUNT_LIVE;

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
      ...(account ? { account } : {}),
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

    const body = (await request.json()) as {
      phone?: string;
      name?: string;
      role?: string;
    };
    const phone = (body.phone ?? "").trim();
    const name = (body.name ?? "").trim();
    const role = body.role ?? "";

    if (!/^\+[1-9]\d{7,14}$/.test(phone) || name.length < 2) {
      return envelope("invalid_input", "A name and an E.164 number.", 400);
    }

    /*
      A role that does not exist is a different failure from a role that is not
      allowed, and the contract keeps them apart: `invalid_role` is "pick a role
      that exists", while inviting an OWNER folds into the one deliberately
      uninformative `cannot_invite` below.
    */
    if (role !== "MANAGER" && role !== "STAFF" && role !== "OWNER") {
      return envelope("invalid_role", "No such role.", 400);
    }

    /*
      ONE message for every refusal, and the mock keeps it that way on purpose.

      "A number already belonging to any operator is refused with the same
      message as any other failure, so this endpoint cannot be used to find out
      which businesses are on Yuvoy." A mock that distinguished them would let
      this portal ship a branch the real API never takes — and the branch would
      be the enumeration oracle the endpoint exists to avoid being.
    */
    const alreadyHere = team.some((m) => !m.pending && m.phone === phone);
    if (role === "OWNER" || alreadyHere) {
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
      roles: [role],
      state: "invited",
      pending: true,
      phone,
    });

    /*
      `joinUrl` alongside the queued message, because there is no delivery yet
      and "on an island the person doing the inviting is usually standing next
      to the person being invited". The portal used to drop this, which made
      inviting somebody a dead end for the invitee.
    */
    return HttpResponse.json(
      { sent: true, joinUrl: JOIN_URL, devCode: DEV_CODE },
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
    const failed = requireSession(request);
    if (failed) return failed;

    /*
      The LIVE lock. "After that the verified documents were checked against
      the legal name on file, so changing it without anybody looking would make
      the verification meaningless."
    */
    if (!profile.editable) {
      return envelope(
        "details_locked",
        "The account is live; these change by asking us.",
        409,
      );
    }

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

  http.put(url("/story"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

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
      "Only an owner or a manager can change the logo.",
    );
    if (denied) return denied;

    return HttpResponse.json(imageIntent(), { status: 201 });
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

    return HttpResponse.json(imageIntent(), { status: 201 });
  }),

  http.post(url("/story/photos"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

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
    return HttpResponse.json({ experiences: mockExperiences });
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
      status: "draft",
      publicationState: "draft",
      bookingMode: String(body.bookingMode ?? "request"),
      durationMinutes: Number(body.durationMinutes ?? 120),
      maxPartySize: Number(body.maxPartySize ?? 6),
      unitPricePaise,
      pricingUnit: String(body.pricingUnit ?? "per_person"),
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
    mockExperiences.push(created);

    return HttpResponse.json(
      { id: created.id, status: "draft", next: "submit_for_review" },
      { status: 201 },
    );
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

  http.get(url("/media"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    return HttpResponse.json({
      items: Object.entries(mediaAssets).map(([id, asset]) => ({
        id,
        kind: asset.kind,
        state: asset.state,
        // Omitted, never null, when there is none — which is most clips.
        ...(asset.posterUrl ? { posterUrl: asset.posterUrl } : {}),
        durationSeconds: asset.durationSeconds,
        listing: asset.listing,
        rejection: asset.rejection,
        createdAt: new Date().toISOString(),
      })),
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

    const asset = mediaAssets[String(params.id)];
    if (!asset || asset.state !== "approved") {
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
    asset.state = "published";
    asset.listing = {
      experienceId: listing.id,
      title: listing.title,
      state: "published",
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
    if (!["ADMIN", "MANAGER", "STAFF"].includes(role)) {
      // OWNER lands here too, on purpose: "`OWNER` cannot be given."
      return envelope("invalid_input", "ADMIN, MANAGER or STAFF.", 400);
    }
    if (member!.roles.includes("OWNER")) {
      return envelope(
        "cannot_change_access",
        "An owner's role is not changed here.",
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
    const owners = team.filter(
      (m) => !m.pending && m.roles.includes("OWNER"),
    ).length;
    if (member!.roles.includes("OWNER") && owners <= 1) {
      return envelope(
        "cannot_change_access",
        "You cannot pause the last owner.",
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
    comes with it: an admin may not remove an owner or another admin.
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

    if (
      !myRoles.includes("OWNER") &&
      (member.roles.includes("OWNER") || member.roles.includes("ADMIN"))
    ) {
      return envelope(
        "forbidden",
        "An admin cannot remove an owner or another admin.",
        403,
      );
    }

    if (!member.pending) {
      if (member.id === sessionUser(request)!.id) {
        return envelope("cannot_remove", "You cannot remove yourself.", 409);
      }
      const owners = team.filter(
        (m) => !m.pending && m.roles.includes("OWNER"),
      ).length;
      if (member.roles.includes("OWNER") && owners <= 1) {
        return envelope(
          "cannot_remove",
          "You cannot remove the last owner.",
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
      UTC days, as the API reads them: `from` is UTC midnight and `to` runs to
      the next one (yuvoy-api `operator_platform.go`). This used to filter on
      the MARKET's day, which is kinder than production — a screen asking for
      "today" was handed a 05:00 IST departure here that the API would have
      left out. Faithful now, so it is `listSlots` widening the window that
      keeps those boats on the screen, and a regression there shows.

      Created departures are read back like any other. A mock whose reads
      ignore its writes proves the message rendered and nothing about the row.
    */
    const startMs = from ? Date.parse(`${from}T00:00:00Z`) : -Infinity;
    const endMs = to ? Date.parse(`${to}T00:00:00Z`) + 86_400_000 : Infinity;
    const inRange = [...SLOTS, ...createdSlots].filter((s) => {
      const t = Date.parse(s.startsAt);
      return t >= startMs && t < endMs;
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
    });
  }),

  http.get(url("/slots/:id/manifest"), async ({ request, params }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const slot = SLOTS.find((s) => s.id === String(params.id));
    // Missing and "belongs to somebody else" are one answer, by design.
    if (!slot) return envelope("not_found", "No such departure.", 404);

    const parties = slot.parties.map((p) => {
      const recorded = attendance[p.bookingId];
      /*
        `cash` is held back. `Manifest.parties[]` carries none in the contract,
        and a mock that sent it would let the manifest ship reading a field the
        real API has never sent — the screen joins `GET /bookings` instead
        (yuvoy-operator#40 §1).
      */
      const { cash: _cash, ...party } = p;
      void _cash;
      return {
        ...party,
        state: p.bookingId ? bookingStateOf(p) : p.state,
        arrived: recorded ? true : p.arrived,
        arrivedAt: recorded?.arrivedAt ?? p.arrivedAt,
      };
    });

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
  http.get(url("/bookings"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const u = new URL(request.url);
    const from = u.searchParams.get("from");
    const to = u.searchParams.get("to");
    /*
      UTC DAYS, as the API reads them — `from` is UTC midnight and `to` runs
      to the next one (`internal/handler/operator.go`), not the market's
      calendar. This filtered on the market day, which is kinder than the API:
      a 05:00 IST departure is 23:30 UTC the evening before, and a client that
      asked for its market day would find it here and miss it in production.
    */
    const lo = from ? Date.parse(`${from}T00:00:00Z`) : -Infinity;
    const hi = to ? Date.parse(`${to}T00:00:00Z`) + 86_400_000 : Infinity;
    const inWindow = (startsAt: string) => {
      const t = Date.parse(startsAt);
      return t >= lo && t < hi;
    };

    const captured = SLOTS.flatMap((slot) =>
      inWindow(slot.startsAt)
        ? slot.parties
            .filter((p) => p.bookingId)
            .map((p) => ({
              id: p.bookingId,
              reference: p.reference,
              state: bookingStateOf(p),
              guests: p.guests,
              experience: slot.title,
              slot: { startsAt: slot.startsAt, timezone: slot.timezone },
              contact: { name: p.name },
              createdAt: new Date(
                new Date(slot.startsAt).getTime() - 3 * 86_400_000,
              ).toISOString(),
              money: bookingMoney(p),
              // Present only on a cash booking — "branch on the key existing".
              ...(p.cash ? { cash: bookingCashOf(p) } : {}),
            }))
        : [],
    );

    const awaiting = REQUESTS.filter(
      (r) => !answered[r.id] && inWindow(r.startsAt),
    ).map((r) => ({
      id: r.id,
      state: "pending_request",
      guests: r.guests,
      experience: r.experience,
      slot: { startsAt: r.startsAt, timezone: r.timezone },
      contact: { name: r.contactName },
      createdAt: r.requestedAt,
    }));

    return HttpResponse.json({ items: [...captured, ...awaiting] });
  }),

  /**
   * One booking — yuvoy-operator#34.
   *
   * Built from the same two sources the list is, so the detail screen cannot
   * show something the row it was opened from did not.
   *
   * A booking that is not this operator's answers **404, never 403**: the API
   * says why in as many words — "a 403 confirms the booking exists, which is
   * exactly what somebody probing ids wants to learn" — and a mock that
   * answered 403 would let a client ship a branch the real API never takes.
   */
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
          ...(party.cash ? { cash: bookingCashOf(party) } : {}),
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
    return HttpResponse.json({
      id,
      state: "active",
      // The traveller now holds seats with a clock on them and must pay.
      holdExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
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

  http.get(url("/earnings"), async ({ request }) => {
    const failed = requireManager(request, "Requires OWNER or MANAGER.");
    if (failed) return failed;

    const u = new URL(request.url);
    const from = u.searchParams.get("from") ?? undefined;
    const to = u.searchParams.get("to") ?? undefined;

    /*
      Last month is settled; this month is still provisional. Two states from
      one endpoint, so the screen's "this can still move" warning is exercised
      on the case where it matters and absent on the case where it does not.
    */
    /*
      "Over" in the market's calendar, by date string, never `new Date(to)`:
      that parses a bare date as UTC midnight, which arrives at 05:30 IST — so
      from half past five on the last morning of every month "This month"
      rendered as "Paid. The money has left our side" while the month was
      still running, and the earnings e2e went red for the rest of the day.
      The same class of bug the day screen had (369267c), one file over.
    */
    const isPast = Boolean(from && to && to < marketDate(new Date()));
    return HttpResponse.json({
      from,
      to,
      ...EARNINGS,
      state: isPast ? "settled" : EARNINGS.state,
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
    const failed = requireManager(request, "Requires OWNER or MANAGER.");
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
        commissionPaise: 0,
        lines: [],
      });
    }

    return HttpResponse.json(COMMISSION_OWED);
  }),

  http.get(url("/change-requests"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const live = [...bankChanges, ...CHANGE_REQUESTS].map((r) =>
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

    if (!steppedUp) {
      return envelope("step_up_required", "Ask for a code first.", 403);
    }
    if (!sessionUser(request)!.roles.includes("OWNER")) {
      return envelope("forbidden", "Only the owner can change this.", 403);
    }

    const open = [...bankChanges, ...CHANGE_REQUESTS].filter(
      (r) =>
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
    const all = [...bankChanges, ...CHANGE_REQUESTS] as {
      id?: string;
      state?: string;
    }[];
    const found = all.find((r) => r.id === id);
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
    const failed = requireManager(request, "Requires OWNER or MANAGER.");
    if (failed) return failed;

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
    const failed = requireManager(request, "Requires OWNER or MANAGER.");
    if (failed) return failed;

    const body = (await request.json()) as {
      from?: string;
      to?: string;
      reasonCode?: string;
      experienceId?: string;
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
    const inRange = [...SLOTS, ...createdSlots].filter((s) => {
      if (calledOff[s.id] || s.status === "cancelled") return false;
      if (body.experienceId && s.experienceId !== body.experienceId) {
        return false;
      }
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: s.timezone,
      }).format(new Date(s.startsAt));
      return day >= body.from! && day <= body.to!;
    });
    const existingBookings = inRange.reduce((n, s) => n + s.parties.length, 0);
    blackouts.push({
      from: body.from,
      to: body.to,
      ...(body.experienceId ? { experienceId: body.experienceId } : {}),
    });

    return HttpResponse.json({
      closed: true,
      existingBookings,
      ...(existingBookings > 0
        ? {
            note: "The bookings you already have still stand — including anyone mid-checkout, whose hold predates the closure and can still complete. Run them, or call each departure off individually.",
          }
        : {}),
    });
  }),

  http.post(url("/slots/:id/offline-sales"), async ({ request, params }) => {
    const failed = requireManager(request, "Requires OWNER or MANAGER.");
    if (failed) return failed;

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
    relay(request, () => (partyOf(String(params.id)) ? 1 : null)),
  ),

  http.post(url("/slots/:id/relay"), async ({ request, params }) =>
    relay(request, () => {
      const slot = SLOTS.find((s) => s.id === String(params.id));
      if (!slot) return null;
      // Only confirmed bookings are reachable; a live hold has no booking to
      // message, which is why a relay can legitimately reach zero people.
      return slot.parties.filter((p) => p.bookingId).length;
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

    calledOff[id] = body.reasonCode;

    const confirmed = slot.parties.filter((p) => p.bookingId);
    const holds = slot.parties.filter((p) => !p.bookingId);

    return HttpResponse.json({
      slotId: id,
      reasonCode: body.reasonCode,
      bookingsCancelled: confirmed.length,
      guestsAffected: confirmed.reduce((n, p) => n + p.guests, 0),
      // Full refunds regardless of the cancellation policy: those tiers price
      // a traveller changing their mind, and nobody changed their mind here.
      refundedPaise: confirmed.reduce((n, p) => n + p.guests * 450000, 0),
      holdsReleased: holds.length,
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
