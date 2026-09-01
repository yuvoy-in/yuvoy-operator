"use server";

import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";

/**
 * Accepting an invitation — the one write in this portal with no session
 * behind it, and deliberately so.
 *
 * "Unauthenticated, because accepting an invitation is what somebody does
 * before they have an account. Scoped by the invite code: hashed,
 * attempt-limited, seven-day expiry."
 *
 * `pnpm qa` fails a Server Action module that never calls `requireOperator()`,
 * and this file is the second of exactly two entries on its allowlist. The
 * other is sign-in. Both are the same shape: the *code* is the authorisation,
 * and there is no session yet to check because producing one is the point.
 *
 * **No session is minted here**, on the API side either: "they sign in through
 * the ordinary flow afterwards, so one code path creates operator sessions
 * rather than two — and the second one would be the one written in a hurry."
 * So the success state sends them to sign-in rather than pretending they are
 * in, which is the single most important thing this screen gets right.
 */

const acceptSchema = z.object({
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s()-]/g, ""))
    .pipe(
      z
        .string()
        .regex(
          /^\+[1-9]\d{7,14}$/,
          "Enter the number with its country code, like +919000000101.",
        ),
    ),
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "The code is the digits we sent you, nothing else."),
});

export interface AcceptState {
  message?: string;
  accepted?: boolean;
}

export async function acceptInvite(
  _prev: AcceptState,
  form: FormData,
): Promise<AcceptState> {
  const parsed = acceptSchema.safeParse({
    phone: String(form.get("phone") ?? ""),
    code: String(form.get("code") ?? ""),
  });
  if (!parsed.success) {
    return { message: parsed.error.issues[0].message };
  }

  try {
    /*
      No token passed. `POST /team/accept` carries `security: []` in the
      contract — an authenticated call here would be the wrong shape, because
      the person accepting has no session by definition.
    */
    const { data, error } = await operatorApi().POST("/team/accept", {
      body: parsed.data,
    });
    if (error) throw error;
    if (data.accepted === false) {
      return { message: "That invitation could not be accepted." };
    }
    /*
      The response carries `next`, and it is deliberately not used to navigate.
      There is exactly one next step and this build knows it; following a
      server-supplied string would turn a 200 into whatever URL it contained.
    */
    return { accepted: true };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: err.message };
    }
    if (err instanceof OperatorApiError && err.isUnauthorized) {
      /*
        Wrong, expired, used, over-attempted and "no invitation for that
        number" all answer 401, and this screen keeps them one message — the
        same rule sign-in follows. Telling somebody the code was "already used"
        rather than "wrong" tells whoever is holding a stranger's phone that
        they had the right number and the wrong window.
      */
      return {
        message:
          "That did not work. Check the number and the code, and ask whoever invited you to send a new one — codes last seven days.",
      };
    }
    return { message: "We could not accept that invitation just now." };
  }
}
