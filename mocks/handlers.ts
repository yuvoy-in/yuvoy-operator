import { http, HttpResponse } from "msw";
import { apiBaseUrl } from "../src/lib/api/server-client";
import { validateRelay } from "../src/lib/day/relay-types";
import {
  DEV_CODE,
  OPERATOR,
  REQUESTS,
  SLOTS,
  type MockParty,
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

const SESSION_TOKEN = "opsess_mock_a1b2c3d4e5f6";

let attendance: Record<string, { outcome: string; arrivedAt?: string }> = {};
/** Requests that have been answered. An answered one is not open any more. */
let answered: Record<string, "active" | "released"> = {};
/** Departures called off in this session. Irreversible, as in production. */
let calledOff: Record<string, string> = {};

/** Reset between tests so one case cannot make the next pass. */
export function __resetOperatorMocks() {
  attendance = {};
  answered = {};
  calledOff = {};
}

function envelope(code: string, message: string, status: number) {
  return HttpResponse.json({ error: { code, message } }, { status });
}

/** Every authenticated route answers 401 the same way. */
function requireSession(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${SESSION_TOKEN}`) {
    return envelope(
      "unauthorized",
      "No session, or one that is no longer valid.",
      401,
    );
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
    if (body.code !== DEV_CODE) {
      // Wrong, expired, used and over-attempted all answer 401 with one message.
      return envelope("unauthorized", "That code did not work.", 401);
    }
    return HttpResponse.json(
      {
        token: SESSION_TOKEN,
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
    return HttpResponse.json(OPERATOR);
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
    const failed = requireSession(request);
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
    const failed = requireSession(request);
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
    const failed = requireSession(request);
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
