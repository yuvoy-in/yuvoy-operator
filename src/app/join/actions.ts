"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { writeSessionToken } from "@/lib/auth/session-writes";
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
 * **Accepting now signs them in** (yuvoy-api#109, consumed for
 * yuvoy-operator#25). The API used to mint no session here — "they sign in
 * through the ordinary flow afterwards, so one code path creates operator
 * sessions rather than two" — and this screen correctly said so. It now
 * answers with the same `StartSession` sign-in makes, so the second code path
 * never existed: there is one exchange, and this is a second door onto it.
 *
 * Same reasoning as O1's signup: they proved a code seconds ago, and a second
 * identical challenge is the same gate twice.
 *
 * The fallback is kept and is not theoretical: `token` is "present unless the
 * account itself cannot hold a session, in which case `next` says so and the
 * join still happened". That case must not read as a failure — they ARE on the
 * account — so it lands on the old wording rather than an error.
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
  /**
   * Joined, but not signed in.
   *
   * The narrow case where the account cannot hold a session. A successful
   * accept that DID sign them in never reaches a state at all — it redirects.
   */
  joinedWithoutSession?: boolean;
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

  let session: string | undefined;

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

    /*
      `joined: false` on a 201 is not a shape the contract describes, but it is
      cheap to refuse and the alternative — signing somebody into a business
      the server just said it did not add them to — is not.
    */
    if (data.joined === false) {
      return { message: "That invitation could not be accepted." };
    }

    session = data.token;
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

  /*
    Outside the try/catch, and after the cookie: `redirect` throws by design,
    and catching it would turn a successful accept into "we could not accept
    that invitation just now".

    The response also carries `next`, and it is deliberately not followed.
    There is exactly one next step and this build knows it; navigating to a
    server-supplied string would turn a 201 into whatever URL it contained.
  */
  if (!session) return { joinedWithoutSession: true };
  await writeSessionToken(session);
  redirect("/today");
}
