import { http, HttpResponse } from "msw";
import { DEV_CODE, OPERATOR, SLOTS, type MockParty } from "./fixtures";

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

const BASE =
  process.env.OPERATOR_API_URL ?? "http://localhost:8093/operator/v1";

const url = (path: string) => `${BASE}${path}`;

const SESSION_TOKEN = "opsess_mock_a1b2c3d4e5f6";

let attendance: Record<string, { outcome: string; arrivedAt?: string }> = {};

/** Reset between tests so one case cannot make the next pass. */
export function __resetOperatorMocks() {
  attendance = {};
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
      status: slot.status,
      ...(slot.calledOff ? { calledOff: slot.calledOff } : {}),
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
