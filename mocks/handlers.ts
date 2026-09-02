import { http, HttpResponse } from "msw";
import { apiBaseUrl } from "../src/lib/api/server-client";
import {
  MOCK_TUS_PORT,
  createMockUpload,
  mockUploadDone,
  resetMockUploads,
} from "./tus-server";
import { validateRelay } from "../src/lib/day/relay-types";
import {
  CHANGE_REQUESTS,
  DEV_CODE,
  DROPPING_ID,
  EARNINGS,
  FAILING_ID,
  OPERATOR,
  OTHER_MEMBERS,
  SUSPENDED_ID,
  REQUESTS,
  SLOTS,
  TEAM,
  type MockParty,
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
    [...team, ...OTHER_MEMBERS].find((m) => !m.pending && m.id === match[1]) ??
    null
  );
}

/** OWNER or MANAGER, exactly as `GET /me` defines it. */
const canManage = (member: MockTeamMember) =>
  member.roles.includes("OWNER") || member.roles.includes("MANAGER");

let attendance: Record<string, { outcome: string; arrivedAt?: string }> = {};
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
/** Upload intents in flight, by operator. One at a time, as the API enforces. */
let uploadIntents: Record<
  string,
  { id: string; uploadId: string; confirmedAt?: number }
> = {};
/** Assets that finished processing, and what has been attested about them. */
let mediaAssets: Record<string, { attested: boolean; withdrawn?: boolean }> =
  {};

/** Reset between tests so one case cannot make the next pass. */
export function __resetOperatorMocks() {
  attendance = {};
  answered = {};
  calledOff = {};
  capacity = {};
  offlineSold = {};
  steppedUp = false;
  bankChanges = [];
  stoppedChanges = [];
  team = TEAM.map((m) => ({ ...m }));
  uploadIntents = {};
  mediaAssets = {};
  resetMockUploads();
}

function envelope(code: string, message: string, status: number) {
  return HttpResponse.json({ error: { code, message } }, { status });
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

/** The response shape: everything except the number, which is never returned. */
function publicMember(member: MockTeamMember) {
  const { phone: _phone, ...rest } = member;
  void _phone;
  return rest;
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
function requireManager(request: Request, refusal: string) {
  const failed = requireSession(request);
  if (failed) return failed;
  if (!canManage(sessionUser(request)!)) {
    return envelope("forbidden", refusal, 403);
  }
  return null;
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

export const handlers = [
  /* -------------------------------------------------------------- auth --- */

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
    const member = [...team, ...OTHER_MEMBERS].find(
      (m) => !m.pending && m.phone === (body.phone ?? "").trim(),
    );
    /*
      A wrong code and a number nobody on the account owns answer identically.
      `POST /auth/otp` above already refuses to distinguish known numbers from
      unknown ones; a session endpoint that then said "no such user" would give
      back the directory the OTP endpoint carefully withholds.
    */
    if (body.code !== DEV_CODE || !member) {
      return envelope("unauthorized", "That code did not work.", 401);
    }
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
    return HttpResponse.json({
      id: me.id,
      name: me.name,
      roles: me.roles,
      operatorId: OPERATOR.operatorId,
      canManage: canManage(me),
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
    // may see who is on the account; only the writes are OWNER only.
    const failed = requireSession(request);
    if (failed) return failed;
    return HttpResponse.json({ team: team.map(publicMember) });
  }),

  http.post(url("/team"), async ({ request }) => {
    const failed = requireOwner(request);
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

    return HttpResponse.json(
      { sent: true, devCode: DEV_CODE },
      { status: 202 },
    );
  }),

  /*
    Unauthenticated by design — `security: []` in the contract, because
    accepting an invitation is what somebody does BEFORE they have an account.
    Note what it does not do: mint a session. "They sign in through the
    ordinary flow afterwards, so one code path creates operator sessions rather
    than two."
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
    // They have accepted, not signed in. `lastSeenAt` stays absent.

    return HttpResponse.json({ accepted: true, next: "sign_in" });
  }),

  /* ------------------------------------------------------------ media --- */

  /**
   * An upload slot.
   *
   * The `uploadUrl` points at a DIFFERENT ORIGIN, because in production it
   * does: "bytes never pass through this API", the browser talks straight to
   * the video provider, and that is the one request in this portal MSW cannot
   * intercept. `mocks/tus-server.ts` is that origin.
   *
   * The 409 is modelled rather than skipped. One upload at a time is what
   * makes the whole flow unresumable across a reload — the client cannot ask
   * for the URL again — and a mock that handed out a second intent would let
   * this portal ship a recovery path the real API does not have.
   */
  http.post(url("/media/upload-intents"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;
    const me = sessionUser(request)!;

    const open = uploadIntents[me.id];
    if (open && !open.confirmedAt) {
      return envelope(
        "conflict",
        "An upload is already in progress for this operator.",
        409,
      );
    }

    const id = `upi_${Math.random().toString(36).slice(2, 10)}`;
    /*
      A dropping upload for one fixture identity, so the resume path is
      exercised end to end rather than only in unit tests. A resumable uploader
      that has never been interrupted is an uploader whose resume path has
      never run.
    */
    const uploadId = `${id}${me.id === DROPPING_ID ? "-drop" : ""}`;
    createMockUpload(uploadId);
    uploadIntents[me.id] = { id, uploadId };

    return HttpResponse.json(
      {
        intentId: id,
        uploadUrl: `http://127.0.0.1:${MOCK_TUS_PORT}/uploads/${uploadId}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        maxBytes: 200 * 1024 * 1024,
        maxSeconds: 60,
        protocol: "tus",
        /*
          1 MB here, 5 MB in production. The chunk size is the SERVER's to
          decide and the client's to honour — which is the property worth
          testing — so a smaller one exercises the same loop with a quarter of
          the bytes going over Playwright's wire. A client with its own idea of
          the chunk size is a client that breaks the day the provider changes.
        */
        chunkBytes: 1024 * 1024,
        aspectRatio: "9:16",
      },
      { status: 201 },
    );
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
      mediaAssets[mediaAssetId] = { attested: false };
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
    asset.withdrawn = true;
    return HttpResponse.json({
      withdrawn: true,
      note: "It is off Yuvoy now. The original is deleted at the video provider shortly afterwards.",
    });
  }),

  http.delete(url("/team/:id"), async ({ request, params }) => {
    const failed = requireOwner(request);
    if (failed) return failed;

    const id = String(params.id);
    const member = team.find((m) => m.id === id);
    if (!member) return envelope("not_found", "No such member.", 404);

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

  http.get(url("/slots"), async ({ request }) => {
    const failed = requireSession(request);
    if (failed) return failed;

    const u = new URL(request.url);
    const from = u.searchParams.get("from");
    const to = u.searchParams.get("to");

    const inRange = SLOTS.filter((s) => {
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: s.timezone,
      }).format(new Date(s.startsAt));
      return (!from || day >= from) && (!to || day <= to);
    });

    return HttpResponse.json({
      items: inRange.map(
        ({
          id,
          experienceId,
          title,
          startsAt,
          timezone,
          seats,
          sold,
          remaining,
          status,
        }) => ({
          id,
          experienceId,
          title,
          startsAt,
          timezone,
          seats,
          sold,
          remaining,
          status,
        }),
      ),
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
      return {
        ...p,
        state:
          recorded?.outcome === "arrived"
            ? p.state
            : (recorded?.outcome ?? p.state),
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
        seatsSoldOffline: slot.seatsSoldOffline,
      },
    });
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
    const isPast = Boolean(from && to && new Date(to) < new Date());
    return HttpResponse.json({
      from,
      to,
      ...EARNINGS,
      state: isPast ? "settled" : EARNINGS.state,
    });
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
    const failed = requireSession(request);
    if (failed) return failed;

    /*
      The gates are enforced, not assumed. A mock that raises a change without
      step-up would let the client ship without the code step — and the first
      time anybody found out would be in production, on the one flow where the
      whole design is the gate.
    */
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
    */
    const inRange = SLOTS.filter((s) => {
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: s.timezone,
      }).format(new Date(s.startsAt));
      return day >= body.from! && day <= body.to!;
    });
    const existingBookings = inRange.reduce((n, s) => n + s.parties.length, 0);

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
];
