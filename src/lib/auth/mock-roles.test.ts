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
const ADMIN = "+919000000114";
const MANAGER_ID = "usr_manager_dev";
const ADMIN_ID = "usr_admin_nisha";
/** Ravi, the second active admin. Read but never written, so acting on him is safe. */
const OTHER_ADMIN_ID = "usr_admin_ravi";
const OWNER_ID = "usr_havelock_owner";

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
});

/**
 * The access writes, whose refusals had never executed either.
 *
 * `PUT /team/{id}/role`, `POST /team/{id}/hold`, `.../restore` and
 * `DELETE /team/{id}` all carry the same 403 — "OWNER or ADMIN only, and an
 * ADMIN cannot change an OWNER or another ADMIN" — and the same
 * `409 cannot_change_access` for your own access.
 *
 * The screen decides all of that at render time, because `TeamMember` carries
 * no capability field. Which means the client's opinion and the server's have
 * to be checked against each other somewhere, and this is that place: a mock
 * kinder than the API would let the Team screen ship offering an admin
 * controls the real API refuses.
 */
const ACCESS_WRITES: Array<[string, (id: string) => string, unknown?]> = [
  ["PUT", (id) => `/team/${id}/role`, { role: "STAFF" }],
  ["POST", (id) => `/team/${id}/hold`],
  ["POST", (id) => `/team/${id}/restore`],
  ["DELETE", (id) => `/team/${id}`],
];

describe("managing access", () => {
  it("refuses a MANAGER every one of them", async () => {
    // `canManage` is not the gate here and never was: a manager who could hand
    // out access could hand out access to a business that is not theirs.
    const manager = await signIn("+919000000102");
    for (const [method, path, body] of ACCESS_WRITES) {
      const res = await call(manager, method, path("usr_staff_arun"), body);
      expect([403, 404]).toContain(res.status);
      if (res.status === 403) {
        const json = (await res.json()) as { error: { code: string } };
        expect(json.error.code).toBe("forbidden");
      }
    }
  });

  it("refuses an ADMIN acting on the OWNER, with 403 on every write", async () => {
    /*
      The whole of the seniority clause, and it is one clause now: "an ADMIN
      cannot change an OWNER's role", "cannot hold an OWNER", "cannot restore an
      OWNER", "cannot remove an OWNER".

      This used to loop over the owner AND `ADMIN_ID`, asserting `[403, 409]` for
      both — and `ADMIN_ID` is the caller's own row, which answers 409 for a
      different reason entirely. So the "or another admin" half of the old rule
      was never actually tested, and it went on being enforced by the portal for
      a week after the contract dropped it.
    */
    const admin = await signIn(ADMIN);
    for (const [method, path, body] of ACCESS_WRITES) {
      const res = await call(admin, method, path(OWNER_ID), body);
      expect(res.status, `${method} on the owner`).toBe(403);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("forbidden");
    }
  });

  it("lets an ADMIN change ANOTHER ADMIN's role, which it used to refuse", async () => {
    /*
      A real widening of what one login can do to another, and the API's call
      rather than the portal's: an admin exists to stand in for an owner who is
      off the island, and one who could not touch a colleague's access would be a
      stand-in for nothing. The `409` on the last active owner or admin is what
      stops it becoming a lockout.

      Ravi is put straight back, so the fixture both projects read is unchanged
      by the time this returns.
    */
    const admin = await signIn(ADMIN);
    expect(
      (
        await call(admin, "PUT", `/team/${OTHER_ADMIN_ID}/role`, {
          role: "MANAGER",
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await call(admin, "PUT", `/team/${OTHER_ADMIN_ID}/role`, {
          role: "ADMIN",
        })
      ).status,
    ).toBe(204);
  });

  it("lets an ADMIN act on a manager, which is the whole point of the role", async () => {
    /*
      The positive control. Without it every assertion above would pass against
      a mock that refused an admin everything — and the portal would go on
      hiding from an admin exactly the screen the role exists for.
    */
    const admin = await signIn(ADMIN);
    const res = await call(admin, "PUT", `/team/${MANAGER_ID}/role`, {
      role: "STAFF",
    });
    expect(res.status).toBe(204);
  });

  it("refuses anybody their own access, with 409 rather than 403", async () => {
    /*
      "409 `cannot_change_access` — including changing your own." A different
      answer from the seniority refusal, and the screen says nothing at all about
      either: your own row has your name on it.

      Asserted for an ADMIN as well as the owner, because the two reach it by
      different routes now: an admin may act on every other admin, so their own
      row is the only admin row they are refused, and getting that wrong would
      hand somebody a control that locks them out of their own account.
    */
    const owner = await signIn(OWNER);
    const res = await call(owner, "POST", `/team/${OWNER_ID}/hold`);
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("cannot_change_access");

    const admin = await signIn(ADMIN);
    const mine = await call(admin, "POST", `/team/${ADMIN_ID}/hold`);
    expect(mine.status).toBe(409);
    expect(
      ((await mine.json()) as { error: { code: string } }).error.code,
    ).toBe("cannot_change_access");
  });

  it("refuses to pause the last owner", async () => {
    const admin = await signIn(ADMIN);
    const res = await call(admin, "POST", `/team/${OWNER_ID}/hold`);
    // An admin cannot act on an owner at all, so this is the 403 — the
    // last-owner 409 is reachable only by a second owner, and the fixture has
    // one owner by design.
    expect(res.status).toBe(403);
  });

  it("holds and restores, and a hold keeps the person on the list", async () => {
    /*
      "The row, the role and the history stay; `restore` is one call back."
      Asserted through `GET /team` rather than the 204, because the thing that
      would break a screen is the member VANISHING — which would make a hold
      look like a removal.
    */
    const owner = await signIn(OWNER);
    expect((await call(owner, "POST", `/team/${MANAGER_ID}/hold`)).status).toBe(
      204,
    );

    const held = (await (await call(owner, "GET", "/team")).json()) as {
      team: Array<{ id: string; state?: string; roles: string[] }>;
    };
    const row = held.team.find((m) => m.id === MANAGER_ID);
    expect(row).toBeDefined();
    expect(row!.state).toBe("suspended");
    expect(row!.roles).toEqual(["MANAGER"]);

    expect(
      (await call(owner, "POST", `/team/${MANAGER_ID}/restore`)).status,
    ).toBe(204);
    const back = (await (await call(owner, "GET", "/team")).json()) as {
      team: Array<{ id: string; state?: string }>;
    };
    expect(back.team.find((m) => m.id === MANAGER_ID)!.state).toBe("active");
  });

  it("replaces a role rather than adding to it", async () => {
    // "The role is replaced, not added to" — a merge would grant more than the
    // person choosing one role believed they were granting.
    const owner = await signIn(OWNER);
    expect(
      (await call(owner, "PUT", `/team/${MANAGER_ID}/role`, { role: "ADMIN" }))
        .status,
    ).toBe(204);
    const after = (await (await call(owner, "GET", "/team")).json()) as {
      team: Array<{ id: string; roles: string[] }>;
    };
    expect(after.team.find((m) => m.id === MANAGER_ID)!.roles).toEqual([
      "ADMIN",
    ]);
  });

  it("GIVES OWNER, which it used to refuse with a 400", async () => {
    /*
      Reversed on 14 September (D31, yuvoy-operator#51 item 3). This asserted
      `400` on the old reasoning that "`OWNER` cannot be given … the owner is
      whoever the payout account belongs to; that moves deliberately, not from a
      login."

      `PUT /team/{id}/role` now declares `enum: [OWNER, ADMIN, MANAGER, STAFF]`:
      "an OWNER or an ADMIN may make somebody already on the team an owner, rather
      than removing them and inviting them back."

      Put back afterwards, because a second owner in the shared fixture changes
      what every other spec sees on that row.
    */
    const owner = await signIn(OWNER);
    expect(
      (await call(owner, "PUT", `/team/${MANAGER_ID}/role`, { role: "OWNER" }))
        .status,
    ).toBe(204);
    expect(
      (
        await call(owner, "PUT", `/team/${MANAGER_ID}/role`, {
          role: "MANAGER",
        })
      ).status,
    ).toBe(204);
  });

  it("refuses a role that is not one of the four", () => {
    // `invalid_role` is "pick a role that exists". The four are all valid input
    // now, so this is the only 400 left on this endpoint.
    return signIn(OWNER).then(async (owner) => {
      const res = await call(owner, "PUT", `/team/${MANAGER_ID}/role`, {
        role: "SKIPPER",
      });
      expect(res.status).toBe(400);
    });
  });

  it("counts owners and admins together, and the last one is always yourself", async () => {
    /*
      `DELETE /team/{id}` and `POST /team/{id}/hold` both refuse "the last active
      OWNER or ADMIN", answered with `cannot_change_access` — the
      `cannot_remove` this used to send is gone from the contract
      (yuvoy-operator#51 item 4).

      And here is the thing worth writing down, because it decides how much of
      this a screen should try to pre-empt: **that row can only ever be your
      own.** Reaching either endpoint at all means being an active OWNER or
      ADMIN, so you are in the count; somebody ELSE being the last of them is
      arithmetic that cannot happen. Both endpoints refuse your own row first,
      with its own sentence.

      So the count moving from owners to owners-and-admins changed one thing in
      practice, and it is the positive case below: holding an OWNER while an
      active admin remains, which the owners-only rule refused.
    */
    const owner = await signIn(OWNER);

    const mine = await call(owner, "DELETE", `/team/${OWNER_ID}`);
    expect(mine.status).toBe(409);
    const json = (await mine.json()) as {
      error: { code: string; message: string };
    };
    expect(json.error.code).toBe("cannot_change_access");

    const held = await call(owner, "POST", `/team/${OWNER_ID}/hold`);
    expect(held.status).toBe(409);
    expect(
      ((await held.json()) as { error: { code: string } }).error.code,
    ).toBe("cannot_change_access");
  });

  it("holds an ADMIN while the owner remains, and the owner while an admin remains", async () => {
    /*
      The case the owners-only count got wrong in both directions. It refused
      holding an OWNER while an active admin could still administer the business
      — "somebody has to be able to let people in", and an admin can.

      Ravi is the row acted on, because Nisha is the row other tests act AS, and
      he is restored before this returns.
    */
    const owner = await signIn(OWNER);
    expect(
      (await call(owner, "POST", `/team/${OTHER_ADMIN_ID}/hold`)).status,
    ).toBe(204);
    expect(
      (await call(owner, "POST", `/team/${OTHER_ADMIN_ID}/restore`)).status,
    ).toBe(204);

    // And an admin holding another admin, which the old 403 refused outright.
    const admin = await signIn(ADMIN);
    expect(
      (await call(admin, "POST", `/team/${OTHER_ADMIN_ID}/hold`)).status,
    ).toBe(204);
    expect(
      (await call(admin, "POST", `/team/${OTHER_ADMIN_ID}/restore`)).status,
    ).toBe(204);
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
