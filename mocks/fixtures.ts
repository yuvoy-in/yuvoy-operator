/**
 * Fixtures for the operator portal.
 *
 * Times are anchored to "today in Asia/Kolkata" at fixed clock times rather
 * than to fixed dates. O10 is the screen for TODAY: a fixture pinned to
 * 18 August renders an empty day on every other day of the year, and an empty
 * screen is the one thing a manifest fixture must never be.
 */

import { OPERATOR, todayAt } from "./fixtures-base";

export {
  OPERATOR,
  todayAt,
  earlierToday,
  type MockParty,
  type MockSlot,
  DEV_CODE,
} from "./fixtures-base";
export { SLOTS } from "./fixtures-slots";
export { type MockRequest, REQUESTS } from "./fixtures-requests";
export {
  SETTLEMENT_SENT,
  SETTLEMENT_APPROVED,
  SETTLEMENT_OWED_BACK,
  STATEMENT_CSV,
  COMMISSION_OWED,
  COMMISSION_PAY_TO,
  COMMISSION_STATEMENTS,
  CHANGE_REQUESTS,
  BANK_UNCONFIRMED_CHANGES,
} from "./fixtures-money";
export {
  ACCOUNT_LIVE,
  ACCOUNT_PROSPECT,
  ACCOUNT_AWAITING,
  ACCOUNT_LIVE_OUTSTANDING,
  SUSPENDED_ID,
  ACCOUNT_SUSPENDED,
  PROSPECT_ID,
  AWAITING_ID,
  LIVE_OUTSTANDING_ID,
  DROPPING_ID,
  CONTENDED_ID,
  REFUSED_ID,
  WIDE_READ_FAILS_ID,
  FAILING_ID,
  NEW_BUSINESS_ID,
  BANK_UNCONFIRMED_ID,
} from "./fixtures-accounts";
export {
  type MockMessage,
  type MockThread,
  MESSAGE_THREADS,
} from "./fixtures-threads";

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
      The video host refuses every clip they upload: once the bytes are up,
      confirming answers `422 media_refused`, the same on every later call
      (yuvoy-api#286). A final answer the uploader had never been given, so it
      said "Try again shortly" and kept the dead upload's slot, and the next
      clip could not go in (yuvoy-operator#157).
    */
    id: "usr_upload_refused",
    name: "Refuse Test",
    roles: ["OWNER"],
    state: "active",
    phone: "+919000000120",
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
  {
    /*
      A live business whose new bank account has gone live, and whose payouts
      the run still holds until our team updates the bank we pay from:
      `payoutsHeld` `destination_unconfirmed` (yuvoy-api#275,
      yuvoy-operator#156). Its own business, so no other test's bank change
      can move its hold.
    */
    id: "usr_bank_unconfirmed",
    name: "Meera Pillai",
    roles: ["OWNER"],
    state: "active",
    phone: "+919000000119",
  },
];
