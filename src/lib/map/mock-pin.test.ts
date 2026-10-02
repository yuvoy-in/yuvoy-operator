// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { server } from "../../../mocks/server";
import { __resetOperatorMocks } from "../../../mocks/handlers";
import { apiBaseUrl } from "@/lib/api/server-client";

/**
 * The mock takes a pin the way the API does since yuvoy-api#249
 * (yuvoy-operator#113). A mock that disagreed would let the portal's pin
 * pass every test against an answer production never gives.
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";
const base = apiBaseUrl();

async function signIn(phone: string): Promise<string> {
  const res = await fetch(`${base}/auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, code: DEV_CODE, device: "vitest" }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { token: string }).token;
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

async function draft(token: string): Promise<string> {
  const res = await call(token, "POST", "/experiences", {
    title: "Wall dive",
    category: "adventure",
    destination: "andaman/havelock",
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => __resetOperatorMocks());
afterAll(() => server.close());

describe("a pin on the meeting point, in the mock", () => {
  it("always reads back the key, null when there is no pin", async () => {
    const token = await signIn(OWNER);
    const one = (await (
      await call(token, "GET", "/experiences/exp_dive")
    ).json()) as Record<string, unknown>;
    expect(one).toHaveProperty("meetingLat", null);
    expect(one).toHaveProperty("meetingLng", null);

    const page = (await (
      await call(token, "GET", "/experiences/exp_dive/workspace")
    ).json()) as { listing: Record<string, unknown> };
    expect(page.listing).toHaveProperty("meetingLat", null);
  });

  it("sets a pin on a draft, and clears it with null", async () => {
    const token = await signIn(OWNER);
    const id = await draft(token);

    const set = await call(token, "PATCH", `/experiences/${id}`, {
      meetingLat: 11.9695,
      meetingLng: 92.9631,
    });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({
      meetingLat: 11.9695,
      meetingLng: 92.9631,
    });

    const cleared = await call(token, "PATCH", `/experiences/${id}`, {
      meetingLat: null,
      meetingLng: null,
    });
    expect(await cleared.json()).toMatchObject({
      meetingLat: null,
      meetingLng: null,
    });
  });

  it("leaves the pin alone when the keys are left out", async () => {
    const token = await signIn(OWNER);
    const id = await draft(token);
    await call(token, "PATCH", `/experiences/${id}`, {
      meetingLat: 11.9695,
      meetingLng: 92.9631,
    });

    const res = await call(token, "PATCH", `/experiences/${id}`, {
      meetingPoint: "Jetty 3",
    });
    expect(await res.json()).toMatchObject({
      meetingPoint: "Jetty 3",
      meetingLat: 11.9695,
      meetingLng: 92.9631,
    });
  });

  it("refuses a coordinate off the map, in the API's words", async () => {
    const token = await signIn(OWNER);
    const id = await draft(token);

    const res = await call(token, "PATCH", `/experiences/${id}`, {
      meetingLat: 95,
      meetingLng: "east",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: {
        code: string;
        message: string;
        details: Record<string, unknown>;
      };
    };
    expect(body.error.code).toBe("invalid_input");
    expect(body.error.message).toBe(
      "we could not read: meetingLat, meetingLng",
    );
    expect(body.error.details).toMatchObject({
      meetingLat: "must be 90 or less",
      meetingLng: "this should be a number",
    });
  });

  it("puts a pin on a live listing at once, with nothing for us to read", async () => {
    const token = await signIn(OWNER);

    const res = await call(token, "POST", "/experiences/exp_dive/revisions", {
      meetingLat: 11.9695,
      meetingLng: 92.9631,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      applied: ["meetingLat", "meetingLng"],
      inReview: [],
      state: "applied",
      next: "These are live now. Travellers see them on your listing straight away.",
    });

    const after = (await (
      await call(token, "GET", "/experiences/exp_dive")
    ).json()) as Record<string, unknown>;
    expect(after).toMatchObject({
      status: "live",
      meetingLat: 11.9695,
      meetingLng: 92.9631,
    });
  });

  it("sends a promise to review and applies the operator's half now", async () => {
    const token = await signIn(OWNER);

    const res = await call(token, "POST", "/experiences/exp_dive/revisions", {
      unitPricePaise: 500000,
      summary: "Two tanks on the house reef",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      applied: ["unitPricePaise"],
      inReview: ["summary"],
      state: "submitted",
      needsReview: true,
    });

    const after = (await (
      await call(token, "GET", "/experiences/exp_dive")
    ).json()) as Record<string, unknown>;
    expect(after).toMatchObject({
      unitPricePaise: 500000,
      status: "live_changes_in_review",
    });
    expect(after.summary).not.toBe("Two tanks on the house reef");
  });
});
