// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { server } from "../../../mocks/server";
import { __resetOperatorMocks } from "../../../mocks/handlers";
import { apiBaseUrl } from "@/lib/api/server-client";

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

const DEV_CODE = "424242";
const OWNER = "+919000000101";
const STAFF = "+919000000103";

const base = apiBaseUrl();

async function signIn(phone: string): Promise<string> {
  const res = await fetch(`${base}/auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, code: DEV_CODE, device: "vitest" }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { token: string };
  return body.token;
}

function call(token: string, method: string, path: string, body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

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
  ["POST", "/slots/slot_any/offline-sales", { seats: 1 }],
  [
    "POST",
    "/slots/slot_any/call-off",
    { reasonCode: "WEATHER", confirmSlotId: "slot_any" },
  ],
  ["GET", "/earnings?from=2030-01-01&to=2030-01-31"],
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

  it("is a role refusal, not a broken endpoint: the OWNER gets past it", async () => {
    const owner = await signIn(OWNER);
    // The positive control. A mock that answered 403 to everybody would pass
    // every case above while proving nothing about roles.
    const res = await call(
      owner,
      "GET",
      "/earnings?from=2030-01-01&to=2030-01-31",
    );
    expect(res.status).toBe(200);
  });
});
