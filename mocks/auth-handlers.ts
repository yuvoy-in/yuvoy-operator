import { http, HttpResponse } from "msw";
import {
  DEV_CODE,
  OPERATOR,
  OTHER_MEMBERS,
  type MockTeamMember,
} from "./fixtures";

/**
 * The sign-up, sign-in and `GET /me` routes of the mock API: creating an
 * account, the code and the session it buys, signing out, and who the
 * session is. Moved out of `handlers.ts` as they were
 * (yuvoy-operator#178). The helpers and the state stay there. The team, the
 * sign-ups and the code attempts come in through getters in `deps`, because
 * `__resetOperatorMocks` replaces them; the routes only change what is inside
 * them, so no setter is needed.
 */
export interface AuthMockDeps {
  url: (path: string) => string;
  requireSession: (request: Request) => Response | null;
  envelope: (
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) => Response;
  sessionUser: (request: Request) => MockTeamMember | null;
  sessionTokenFor: (id: string) => string;
  /** OWNER, ADMIN or MANAGER, as `GET /me` defines it. */
  canManage: (member: MockTeamMember) => boolean;
  /** The member's account block; `undefined` for another business's member. */
  accountFor: (me: {
    id: string;
  }) => { credentials: readonly unknown[] } | undefined;
  /** The account block with this session's uploaded files overlaid. */
  accountWithFiles: <T extends { credentials: readonly unknown[] }>(
    account: T,
  ) => T;
  payoutsHeldFor: (request: Request) => {
    held: boolean;
    reason: string | null;
  };
  unreadTotals: (request: Request) => {
    unreadCount: number;
    unreadConversations: number;
  };
  /** The number of an account that is offboarded and cannot sign in. */
  OFFBOARDED_PHONE: string;
  /** Wrong codes before a number is throttled. */
  CODE_ATTEMPT_LIMIT: number;
  /** Everybody on the account, invitations included. */
  team: () => MockTeamMember[];
  /** Accounts made through `POST /auth/signup`, kept apart from the team. */
  signups: () => MockTeamMember[];
  /** Wrong codes so far, by number. */
  codeAttempts: () => Record<string, number>;
}

export function authHandlers(deps: AuthMockDeps) {
  const {
    url,
    requireSession,
    envelope,
    sessionUser,
    sessionTokenFor,
    canManage,
    accountFor,
    accountWithFiles,
    payoutsHeldFor,
    unreadTotals,
    OFFBOARDED_PHONE,
    CODE_ATTEMPT_LIMIT,
    team,
    signups,
    codeAttempts,
  } = deps;

  return [
    /* -------------------------------------------------------------- auth --- */

    /**
     * O1 — an operator creates their own account.
     *
     * **The response is identical for a number that already has an account**,
     * and this mock keeps it that way. A mock that 409'd a duplicate would let
     * the portal ship a branch the real API never takes — and that branch would
     * be the "is this phone a Yuvoy operator" oracle the endpoint is carefully
     * not. So a duplicate creates nothing and answers exactly like a success.
     *
     * No session is minted, exactly as with `/team/accept`: they sign in through
     * the ordinary flow afterwards.
     */
    http.post(url("/auth/signup"), async ({ request }) => {
      const body = (await request.json()) as {
        businessName?: string;
        name?: string;
        phone?: string;
        relationship?: string;
        email?: string;
      };
      const businessName = (body.businessName ?? "").trim();
      const name = (body.name ?? "").trim();
      const phone = (body.phone ?? "").trim();
      /*
        "Optional. Absent means `own`, which is what every sign-up meant before the
        question was asked." The mock honours that rather than requiring it, so a
        client that stops sending the field is not silently broken by the mock
        being stricter than the API.
      */
      const relationship = body.relationship ?? "own";

      if (
        businessName.length < 2 ||
        name.length < 2 ||
        !/^\+[1-9]\d{7,14}$/.test(phone)
      ) {
        return envelope(
          "invalid_input",
          "A business name, a person and an E.164 number.",
          400,
        );
      }

      /*
        "Anything else is refused with `400`, BEFORE the number is looked at, so the
        refusal says nothing about whether the number has an account." The order
        matters as much as the refusal: checking the phone first would make this a
        way to ask whether a number is registered.
      */
      if (relationship !== "own" && relationship !== "run") {
        return envelope(
          "invalid_input",
          "Own it, or run it for the owner.",
          400,
        );
      }

      const taken = [...team(), ...OTHER_MEMBERS, ...signups()].some(
        (m) => m.phone === phone,
      );
      if (!taken) {
        signups().push({
          id: `usr_signup_${Math.random().toString(36).slice(2, 10)}`,
          name,
          /*
            "`own` makes them its OWNER. `run` makes them its ADMIN, and the
            business has no owner until they invite one" (D15). The whole point of
            asking the question, so the mock is what makes the answer observable:
            `GET /me` is where a test can see which one it got.
          */
          roles: [relationship === "run" ? "ADMIN" : "OWNER"],
          state: "active",
          phone,
        });
      }

      return HttpResponse.json({ next: "sign_in" }, { status: 202 });
    }),

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
      const phone = (body.phone ?? "").trim();
      /*
        An OFFBOARDED account, which "cannot sign in or use a session"
        (`AccountNotActive`). The right code for the right number, refused
        anyway, with the API's own sentence: the person is fine and the account
        is not. No identity stood in for it, so the sign-in screen's answer to it
        had never run, and it was "try again shortly" (yuvoy-operator#91).
      */
      if (phone === OFFBOARDED_PHONE && body.code === DEV_CODE) {
        return envelope(
          "account_not_active",
          "this account cannot take bookings right now. Talk to us",
          403,
        );
      }
      /*
        Over-attempted, as the contract declares. Five wrong codes and the
        number is throttled — a 429, distinct from the one 401 every wrong,
        expired or used code shares, because "wait a minute" is a different
        next step from "ask for a new one". The mock never modelled it, so the
        client shipped without its 429 branch ever running.
      */
      if ((codeAttempts()[phone] ?? 0) >= CODE_ATTEMPT_LIMIT) {
        return envelope(
          "rate_limited",
          "Too many attempts. Wait a minute and try again.",
          429,
        );
      }
      const member = [...team(), ...OTHER_MEMBERS, ...signups()].find(
        (m) => !m.pending && m.phone === phone,
      );
      /*
        A wrong code and a number nobody on the account owns answer identically.
        `POST /auth/otp` above already refuses to distinguish known numbers from
        unknown ones; a session endpoint that then said "no such user" would give
        back the directory the OTP endpoint carefully withholds.
      */
      if (body.code !== DEV_CODE || !member) {
        codeAttempts()[phone] = (codeAttempts()[phone] ?? 0) + 1;
        return envelope("unauthorized", "That code did not work.", 401);
      }
      delete codeAttempts()[phone];
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
      const account = accountFor(me);

      return HttpResponse.json({
        id: me.id,
        name: me.name,
        roles: me.roles,
        operatorId: OPERATOR.operatorId,
        /*
          Per-BUSINESS, like `operatorId` beside it — every colleague signed into
          the same account sees the same slug. Always present: `operators.slug`
          is `not null unique`.
        */
        slug: OPERATOR.slug,
        commissionRateBps: OPERATOR.commissionRateBps,
        canManage: canManage(me),
        ...(account ? { account: accountWithFiles(account) } : {}),
        // Always present, every role, with no amount in it.
        payoutsHeld: payoutsHeldFor(request),
        /*
          Always present, `0` when none (yuvoy-api#282 item 6): the inbox
          badge's numbers, counted here so the portal walks no conversations
          to draw them.
        */
        ...unreadTotals(request),
      });
    }),
  ];
}
