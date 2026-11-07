/**
 * The account standings and the special identities' ids, moved out of
 * fixtures.ts (yuvoy-operator#178), which re-exports them by name.
 */
import { marketDay, todayAt } from "./fixtures-base";

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
/** The host refuses their clips once they are up: `422 media_refused`. */
export const REFUSED_ID = "usr_upload_refused";
/** `GET /slots` refuses their wide range, and answers the fortnight. */
export const WIDE_READ_FAILS_ID = "usr_wide_read_fails";
export const FAILING_ID = "usr_api_failing";
/** A business with nothing on it yet: Home's start-selling checklist. */
export const NEW_BUSINESS_ID = "usr_new_business";
/** A new bank account that is live, and not yet paid to: the second hold. */
export const BANK_UNCONFIRMED_ID = "usr_bank_unconfirmed";
