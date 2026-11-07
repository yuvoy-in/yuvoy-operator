/**
 * What the two mock-roles test files share (yuvoy-operator#178): the dev
 * phones and the sign-in and call helpers they drive the mock with. Not a
 * test file itself: only `*.test.ts` files under src/ are collected.
 */
import { expect } from "vitest";
import { apiBaseUrl } from "../src/lib/api/server-client";

export const DEV_CODE = "424242";

export const OWNER = "+919000000101";

export const STAFF = "+919000000103";

export const ADMIN = "+919000000114";

export const base = apiBaseUrl();

export async function signIn(phone: string): Promise<string> {
  const res = await fetch(`${base}/auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, code: DEV_CODE, device: "vitest" }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { token: string };
  return body.token;
}

export function call(
  token: string,
  method: string,
  path: string,
  body?: unknown,
) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
