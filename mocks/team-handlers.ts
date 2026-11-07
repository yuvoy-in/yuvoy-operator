import { http, HttpResponse } from "msw";
import {
  BUSINESS_NAME,
  DEV_CODE,
  JOIN_TOKEN,
  JOIN_URL,
  LEAVING_PHONE,
  OPERATOR,
  type MockTeamMember,
} from "./fixtures";

/**
 * The team and join-by-link routes of the mock API: who is on the account,
 * inviting somebody, accepting an invitation, and the one join link a
 * business has. Moved out of `handlers.ts` as they were
 * (yuvoy-operator#178). The helpers and the state stay there. The team comes
 * in through a getter in `deps`, because `__resetOperatorMocks` replaces it,
 * and a changed list goes back through `setTeam`.
 */
export interface TeamMockDeps {
  url: (path: string) => string;
  requireSession: (request: Request) => Response | null;
  /** Owner or admin, else `403`. */
  requireInviter: (request: Request) => Response | null;
  /** The suspended business's `403`, which the API answers before the role. */
  requireWritable: (request: Request) => Response | null;
  envelope: (
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) => Response;
  sessionUser: (request: Request) => MockTeamMember | null;
  /** A member as `TeamMember` carries them: no number, only its mask. */
  publicMember: (member: MockTeamMember) => Record<string, unknown>;
  sessionTokenFor: (id: string) => string;
  /** Everybody on the account, invitations included. */
  team: () => MockTeamMember[];
  /** Replaces the list. */
  setTeam: (team: MockTeamMember[]) => void;
}

export function teamHandlers(deps: TeamMockDeps) {
  const {
    url,
    requireSession,
    requireInviter,
    requireWritable,
    envelope,
    sessionUser,
    publicMember,
    sessionTokenFor,
    team,
    setTeam,
  } = deps;

  return [
    /* ------------------------------------------------------------- team --- */

    /**
     * What the response actually carries.
     *
     * `phone` is stripped here rather than never stored: the API knows the
     * number — it is how the invitation was sent, and how "a number already
     * belonging to any operator" is refused — and simply does not return it. A
     * mock that returned one would let this portal ship a screen showing a
     * number the real API never sends.
     */
    http.get(url("/team"), async ({ request }) => {
      // Session only. `GET /team` has no role gate in the contract — every role
      // may see who is on the account. The WRITES differ from each other now:
      // inviting is OWNER or ADMIN, removing is still OWNER only.
      const failed = requireSession(request);
      if (failed) return failed;

      /*
        "Present only for a caller who can invite." Modelled rather than sent to
        everybody, because the portal renders the link on exactly that signal —
        a mock that always sent it would let a staff member's screen offer a join
        link and nothing would catch it.
      */
      const roles = sessionUser(request)!.roles;
      const canInvite = roles.includes("OWNER") || roles.includes("ADMIN");

      return HttpResponse.json({
        team: team().map(publicMember),
        ...(canInvite
          ? {
              joinUrl: JOIN_URL,
              joinNote:
                "Send this to anybody you have added. The same link works for all of them, and only for a number you have already invited.",
            }
          : {}),
      });
    }),

    http.post(url("/team"), async ({ request }) => {
      const failed = requireInviter(request);
      if (failed) return failed;
      const shut = requireWritable(request);
      if (shut) return shut;

      const body = (await request.json()) as {
        phone?: string;
        name?: string;
        email?: string;
        role?: string;
      };
      const phone = (body.phone ?? "").trim();
      const name = (body.name ?? "").trim();
      const role = body.role ?? "";
      // Trimmed and lowered, as the API does before it checks the shape.
      const email = (body.email ?? "").trim().toLowerCase();

      /*
        One code, two fields, and `details` says which: the API answers
        `invalid_input` with `{ phone: … }` or `{ email: … }`, and the portal puts
        the sentence on the field it names. The messages are the API's own, lower
        case and all, so the screen's capitalising is exercised.
      */
      if (!/^\+[1-9]\d{7,14}$/.test(phone) || name.length < 2) {
        return envelope(
          "invalid_input",
          "we need their number with the country code",
          400,
          { phone: "for example +919000000101" },
        );
      }
      if (
        email !== "" &&
        (email.length > 254 || !/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(email))
      ) {
        return envelope(
          "invalid_input",
          "that email address does not look right",
          400,
          { email: "for example ramesh@example.com" },
        );
      }

      /*
        `invalid_role` is "pick a role that EXISTS", and `role` may be left out,
        which is STAFF. The four are all valid input; what varies is what they get.
      */
      if (
        role !== "" &&
        !["OWNER", "ADMIN", "MANAGER", "STAFF"].includes(role)
      ) {
        return envelope("invalid_role", "No such role.", 400);
      }

      /*
        **Everybody joins as STAFF, except an owner** (D15).

        An invitation for ADMIN or MANAGER is "sent, not refused. The response says
        `role: STAFF` and carries a `note` saying so, because a portal built before
        D15 still offers those roles and the person inviting must be told what will
        actually happen."

        Modelled rather than refused, because the difference is invisible unless the
        mock does it: a portal that asked for ADMIN and read back its own request
        would tell an owner they had appointed a stand-in who is in fact staff.
      */
      const granted = role === "OWNER" ? "OWNER" : "STAFF";
      const note =
        role === "ADMIN" || role === "MANAGER"
          ? `They join as staff. You can make them ${role === "ADMIN" ? "an admin" : "a manager"} from their row once they have joined.`
          : undefined;

      /*
        ONE message for every refusal, and the mock keeps it that way on purpose.

        "A number already belonging to any operator is refused with the same
        message as any other failure, so this endpoint cannot be used to find out
        which businesses are on Yuvoy." A mock that distinguished them would let
        this portal ship a branch the real API never takes — and the branch would
        be the enumeration oracle the endpoint exists to avoid being.

        Inviting an OWNER is no longer one of those failures. "An ADMIN may invite
        an owner as well as an OWNER may", because a business whose first person
        runs it has none until somebody invites one.
      */
      const alreadyHere = team().some((m) => !m.pending && m.phone === phone);
      if (alreadyHere) {
        return envelope(
          "cannot_invite",
          "We could not send that invitation.",
          409,
        );
      }

      /*
        "Re-inviting the same number replaces the open invitation rather than
        adding one, so a revoked invite is not undone by an older code still
        lying around."
      */
      setTeam(team().filter((m) => !(m.pending && m.phone === phone)));
      team().push({
        id: `inv_${Math.random().toString(36).slice(2, 10)}`,
        name,
        // What accepting will make them, which is not always what was asked for.
        roles: [granted],
        state: "invited",
        pending: true,
        phone,
        // What `POST /join/{token}/code` reads to say whether a code can go.
        ...(email ? { inviteEmail: email } : {}),
      });

      /*
        `sent` read back, not asserted (yuvoy-api 67e3213, yuvoy-operator#91).

        There is no WhatsApp sender, so the only thing that can carry an
        invitation is the email address, and with none the message is written
        suppressed: `sent: false`, and a `note` saying to add them again with an
        email address. The API's own words since yuvoy-api#227 (it used to say to
        pass on "the code yourself", which the inviter never has), and the same
        override it makes: a role it did not grant as asked replaces the note,
        because that is the sentence the inviter must not miss. It asserted
        `true` for every invitation before, which is how an owner came to believe
        a colleague had been told.
      */
      const sent = email !== "";
      const notSent =
        "We could not send that invitation to them. Add them again with an email address, so we have somewhere to send it.";

      /*
        `joinUrl` alongside the queued message, because "on an island the person
        doing the inviting is usually standing next to the person being
        invited". The portal used to drop this, which made inviting somebody a
        dead end for the invitee.
      */
      return HttpResponse.json(
        {
          sent,
          role: granted,
          ...(note ? { note } : sent ? {} : { note: notSent }),
          joinUrl: JOIN_URL,
          devCode: DEV_CODE,
        },
        { status: 202 },
      );
    }),

    /*
      Unauthenticated by design — `security: []` in the contract, because
      accepting an invitation is what somebody does BEFORE they have an account.

      It now DOES mint a session (yuvoy-api#109): "the code they have just proved
      is the same proof a session needs, so this answers with one — the same
      `StartSession` call sign-in makes". Which means the field name changed too:
      `accepted` is gone and `joined` replaced it, on a 201 rather than a 200.
      That is a breaking change and the mock models it exactly, because a mock
      still answering `accepted` would let the portal keep reading a field the
      API no longer sends.
    */
    http.post(url("/team/accept"), async ({ request }) => {
      const body = (await request.json()) as { phone?: string; code?: string };
      const phone = (body.phone ?? "").trim();

      const invite = team().find((m) => m.pending && m.phone === phone);
      if (!invite || body.code !== DEV_CODE) {
        // Wrong code, expired, used, and no invitation for that number all
        // answer 401 with one message — the same rule sign-in follows.
        return envelope("unauthorized", "That code did not work.", 401);
      }

      /*
        The id changes, because it was the INVITATION's id and is now a user's.
        Modelled rather than glossed: a client holding the old id and calling
        DELETE gets a 404, which is exactly what the real API would do.
      */
      invite.id = `usr_${Math.random().toString(36).slice(2, 10)}`;
      invite.pending = false;
      invite.state = "active";

      return HttpResponse.json(
        {
          joined: true,
          token: sessionTokenFor(invite.id),
          user: { id: invite.id, name: invite.name, roles: invite.roles },
          operatorId: OPERATOR.operatorId,
          next: "portal",
        },
        { status: 201 },
      );
    }),

    /* --------------------------------------------------- join by link ----- */

    /**
     * One link per business, not one per invitation.
     *
     * Unauthenticated on purpose: "somebody who is not yet a user has to see who
     * is asking before handing over a phone number." It says which business and
     * nothing else — whoever opened the link has not identified themselves yet.
     */
    http.get(url("/join/:token"), async ({ params }) => {
      if (String(params.token) !== JOIN_TOKEN) {
        return envelope("not_found", "Not a link we recognise.", 404);
      }
      return HttpResponse.json({
        businessName: BUSINESS_NAME,
        next: "code",
      });
    }),

    /**
     * A number nobody invited is refused BEFORE anything is sent.
     *
     * "That this reveals whether a number was invited is deliberate: the
     * alternative is a page that fires one-time codes at any phone somebody
     * types." The mock keeps that property rather than answering identically for
     * known and unknown numbers, because a client built against the softer
     * behaviour would ship a screen that never says the useful thing.
     */
    http.post(url("/join/:token/code"), async ({ request, params }) => {
      if (String(params.token) !== JOIN_TOKEN) {
        return envelope("not_found", "Not a link we recognise.", 404);
      }
      const body = (await request.json()) as { phone?: string };
      const phone = (body.phone ?? "").trim();

      const invite = team().find((m) => m.pending && m.phone === phone);
      if (!invite) {
        return envelope(
          "not_found",
          `No invitation for that number at ${BUSINESS_NAME}. Ask its owner or an admin to add it.`,
          404,
        );
      }

      /*
        One fixture number already works elsewhere, so the "this takes you off
        another business" path is reachable. Without it that panel — and the
        `confirmLeaving` it gates — would never render in any test.
      */
      const leaving =
        phone === LEAVING_PHONE ? "Havelock Water Sports" : undefined;

      /*
        `sent` read back from what could be queued (yuvoy-api#227), where it used
        to be `true` for everybody: with no phone sender an invitation made
        without an email address has nowhere to send its code. Both sentences
        can be true at once and then arrive together in `note`, the one about
        the code first, in the API's own words.
      */
      const sent = Boolean(invite.inviteEmail);
      const notes = [
        ...(sent
          ? []
          : [
              "We could not send your code. Ask whoever invited you to add you again with an email address, so we have somewhere to send it.",
            ]),
        ...(leaving
          ? [
              `Accepting removes you from ${leaving}. One number works with one business at a time.`,
            ]
          : []),
      ];

      return HttpResponse.json(
        {
          sent,
          businessName: BUSINESS_NAME,
          role: invite.roles[0] ?? "STAFF",
          name: invite.name,
          ...(leaving ? { leavingBusiness: leaving } : {}),
          ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
          devCode: DEV_CODE,
        },
        { status: 202 },
      );
    }),

    http.post(url("/join/:token/accept"), async ({ request, params }) => {
      if (String(params.token) !== JOIN_TOKEN) {
        return envelope("not_found", "Not a link we recognise.", 404);
      }
      const body = (await request.json()) as {
        phone?: string;
        code?: string;
        confirmLeaving?: boolean;
      };
      const phone = (body.phone ?? "").trim();

      const invite = team().find((m) => m.pending && m.phone === phone);
      if (!invite) {
        return envelope("not_found", "No invitation for that number.", 404);
      }
      if (body.code !== DEV_CODE) {
        /*
          A wrong or used-up code is `409 cannot_invite`, in the API's own words
          (`AcceptJoin`, `ErrInviteFailed`). This answered `401`, which the API
          never sends here, so the 409 the portal misread as "confirm you are
          leaving" never reached it in a test (yuvoy-operator#145).
        */
        return envelope(
          "cannot_invite",
          "we could not accept that invitation. Check the code and try again",
          409,
        );
      }

      /*
        The 409 that is not a failure. Modelled rather than skipped: it is the
        authoritative "ask them first", and a client that only handled the
        advisory `leavingBusiness` from the code step would send an unconfirmed
        accept and show an error for it.
      */
      if (phone === LEAVING_PHONE && !body.confirmLeaving) {
        return envelope(
          "confirmation_required",
          "This number works with another business. Confirm to leave it.",
          409,
        );
      }

      // The id changes, because it was the INVITATION's id and is now a user's.
      invite.id = `usr_${Math.random().toString(36).slice(2, 10)}`;
      invite.pending = false;
      invite.state = "active";

      /*
        The session, same as `/team/accept` (yuvoy-api#109). Both doors into a
        team now agree about what accepting gets you — which is the whole reason
        the API added it to both rather than one.
      */
      return HttpResponse.json(
        {
          joined: true,
          token: sessionTokenFor(invite.id),
          user: { id: invite.id, name: invite.name, roles: invite.roles },
          operatorId: OPERATOR.operatorId,
          next: "portal",
        },
        { status: 201 },
      );
    }),
  ];
}
