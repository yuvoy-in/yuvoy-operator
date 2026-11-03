// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { server } from "../../../mocks/server";
import { __resetOperatorMocks } from "../../../mocks/handlers";
import {
  DEV_CODE,
  OWNER,
  STAFF,
  ADMIN,
  base,
  signIn,
  call,
} from "../../../mocks/mock-roles-kit";

/**
 * The mock refuses what the contract refuses — by role.
 *
 * For its first month the mock gated every manage-only write on "has a
 * session" alone. The Server Actions that call them each carry a 403 branch
 * written from the contract, and not one of those branches had ever executed:
 * the only backend this portal has ever run against was kinder than the real
 * one. That is the one thing a mock must never be. This drives every gated
 * endpoint as STAFF and expects the contract's answer, with an OWNER as the
 * positive control so a mock that 403s everybody cannot pass it.
 */

/** Every operation the contract marks OWNER-or-MANAGER, with a valid body. */
const GATED: Array<[string, string, unknown?]> = [
  ["POST", "/requests/req_any/accept"],
  ["POST", "/requests/req_any/decline", { reasonCode: "weather" }],
  ["PATCH", "/slots/slot_any", { seats: 4 }],
  [
    "POST",
    "/blackouts",
    { from: "2030-01-01", to: "2030-01-02", reasonCode: "WEATHER" },
  ],
  [
    "POST",
    "/slots/slot_any/call-off",
    { reasonCode: "WEATHER", confirmSlotId: "slot_any" },
  ],
  /*
    `GET /earnings` is gone with the month picker (yuvoy-operator#47 item 8).
    The settlement family replaces it and carries the same refusal: every one
    of them "Requires OWNER, ADMIN or MANAGER".
  */
  ["GET", "/settlements/overview"],
  ["GET", "/settlements"],
  ["GET", "/settlements/stl_sent"],
  ["GET", "/settlements/stl_sent/statement"],
  /*
    The logo's mark is the business's — yuvoy-operator#41. Gated here because
    story photographs used to ride this intent, and the correction is only
    meaningful if the difference between the two slots is real in the mock as
    well as in the contract.
  */
  ["POST", "/logo/upload-intents"],
  /*
    Discarding a draft is "OWNER, ADMIN or MANAGER only, the same as `PATCH`
    on this listing" (yuvoy-operator#112). Refused before the listing is even
    looked up, so a staff phone cannot learn which drafts exist.
  */
  ["DELETE", "/experiences/exp_boat"],
];

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => __resetOperatorMocks());
afterAll(() => server.close());

describe("manage-only endpoints refuse STAFF with the contract's 403", () => {
  for (const [method, path, body] of GATED) {
    it(`${method} ${path.split("?")[0]}`, async () => {
      const staff = await signIn(STAFF);
      const res = await call(staff, method, path, body);
      expect(res.status).toBe(403);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("forbidden");
    });
  }

  it("does NOT refuse a story photograph, which any operator may add", async () => {
    /*
      The whole of the second correction on yuvoy-operator#41. Story
      photographs minted through `/logo/upload-intents`, which is owner and
      manager only — so a STAFF member could write the story and was refused at
      the photograph step, having already chosen a file.

      `/story/photos/upload-intents` is open to every operator role, which is
      the same set that may edit the story. Beside the gated list rather than
      inside it, because the claim is the opposite one.
    */
    const staff = await signIn(STAFF);
    const res = await call(staff, "POST", "/story/photos/upload-intents");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { imageId: string; uploadUrl: string };
    expect(body.imageId).toBeTruthy();
    expect(body.uploadUrl).toBeTruthy();
  });

  it("does NOT refuse a counter sale, or taking one back", async () => {
    /*
      yuvoy-api#226, and the owner's ruling of 23 Sep 2026. Recording a
      counter sale is plain `auth` in the API, and taking one back is the same
      people on purpose: "the person who mistypes the count is the person at
      the counter". This list used to hold the record as manager-only, which
      is how the portal came to hide counter sales from staff.
    */
    const staff = await signIn(STAFF);
    const recorded = await call(
      staff,
      "POST",
      "/slots/slot_dawn/offline-sales",
      { seats: 1 },
    );
    expect(recorded.status).toBe(200);
    const { id } = (await recorded.json()) as { id: string };
    expect(id).toBeTruthy();

    const takenBack = await call(
      staff,
      "DELETE",
      `/slots/slot_dawn/offline-sales/${id}`,
    );
    expect(takenBack.status).toBe(200);
    // A second one moves nothing, and says it was already done.
    const again = await call(
      staff,
      "DELETE",
      `/slots/slot_dawn/offline-sales/${id}`,
    );
    expect(again.status).toBe(409);
    const json = (await again.json()) as { error: { code: string } };
    expect(json.error.code).toBe("already_taken_back");
  });

  it("is a role refusal, not a broken endpoint: the OWNER gets past it", async () => {
    const owner = await signIn(OWNER);
    // The positive control. A mock that answered 403 to everybody would pass
    // every case above while proving nothing about roles.
    const res = await call(owner, "GET", "/settlements/overview");
    expect(res.status).toBe(200);
  });
});

describe("the mock's calendar and its patience", () => {
  /*
    The month-boundary test went with the month picker it was about
    (yuvoy-operator#47 item 8). It existed because a bare date parsed as UTC
    midnight is 05:30 IST, so "This month" flipped to "Paid" while the month was
    still running. There is no month picker now, and a payout week is the unit.

    The class of bug is still guarded, one layer down: `settlements.test.ts`
    asserts every week label is read in the market's day, which is the same
    mistake in the place it can still be made.
  */

  it("answers the sixth wrong code with a 429, not the same 401", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${base}/auth/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: STAFF,
          code: "000000",
          device: "vitest",
        }),
      });
      expect(res.status).toBe(401);
    }
    const throttled = await fetch(`${base}/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: STAFF, code: DEV_CODE, device: "vitest" }),
    });
    expect(throttled.status).toBe(429);
    const body = (await throttled.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });

  it("confirms seats with no dates as the API does since yuvoy-api#244", async () => {
    /*
      yuvoy-api#241. No dates is every departure the counts include, however
      far ahead: the one call behind "Confirm all". Half a range is neither
      form and is refused naming the missing date, as the handler does.
    */
    const owner = await signIn(OWNER);

    const half = await call(owner, "POST", "/slots/confirm-seats", {
      from: "2030-01-01",
    });
    expect(half.status).toBe(400);
    const refusal = (await half.json()) as {
      error: { code: string; details?: unknown };
    };
    expect(refusal.error.code).toBe("invalid_input");
    expect(refusal.error.details).toEqual({ to: "needed with from" });

    // One listing's, then everybody else's, then nothing left to confirm.
    for (const [body, confirmed] of [
      [{ experienceId: "exp_nofootage" }, 1],
      [{}, 1],
      [{}, 0],
    ] as const) {
      const res = await call(owner, "POST", "/slots/confirm-seats", body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ confirmed });
    }
  });
});

describe("discarding a draft, as the API does since yuvoy-api#249", () => {
  it("deletes one nobody has seen, refuses one that was sent, and then has neither", async () => {
    const owner = await signIn(OWNER);

    // `exp_boat` was never sent: no `review`, no `sentBack`.
    const gone = await call(owner, "DELETE", "/experiences/exp_boat");
    expect(gone.status).toBe(204);
    expect(
      (await call(owner, "GET", "/experiences/exp_boat/workspace")).status,
    ).toBe(404);
    expect((await call(owner, "DELETE", "/experiences/exp_boat")).status).toBe(
      404,
    );

    // `exp_night` was sent and came back: a draft again, and still a 409.
    const sent = await call(owner, "DELETE", "/experiences/exp_night");
    expect(sent.status).toBe(409);
    const refusal = (await sent.json()) as {
      error: { code: string; message: string };
    };
    expect(refusal.error.code).toBe("conflict");
    expect(refusal.error.message).toMatch(/already been sent to us/);
    expect(
      (await call(owner, "GET", "/experiences/exp_night/workspace")).status,
    ).toBe(200);
  });
});

describe("the bank change is the last OWNER-only endpoint", () => {
  it("refuses an ADMIN, who may do everything else on this account", async () => {
    /*
      The mock gated this on step-up alone for months, so the client's own
      OWNER gate on the bank form had never been exercised against a refusal.

      It matters more now, not less: `POST /change-requests/{id}/cancel`
      widened to OWNER or ADMIN in the same bump, so an admin can stop a change
      and still cannot start one. A mock that let an admin raise one would let
      that distinction quietly disappear.
    */
    const admin = await signIn(ADMIN);
    const res = await call(admin, "POST", "/change-requests/bank", {
      accountName: "Nemo Reef",
      accountNumber: "12345678",
      ifsc: "HDFC0001234",
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("forbidden");
  });
});
