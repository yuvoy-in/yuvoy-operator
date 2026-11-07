import { http, HttpResponse } from "msw";
import type { MockTeamMember } from "./fixtures";

/**
 * The business behind the account — `GET`/`PUT /profile`.
 *
 * Seeded HALF-FILLED on purpose. A complete profile makes the `missing` array
 * empty, and `missing` is the whole reason the contract names field names
 * rather than sending a boolean: "so a form can mark the specific rows." A
 * fixture with nothing outstanding cannot exercise that at all.
 */
export type MockProfile = {
  displayName: string;
  legalName?: string;
  entityType?: string;
  gstin?: string;
  address: {
    line1?: string;
    line2?: string;
    locality?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
  submittedAt?: string;
};

/**
 * The business details, documents and notification routes of the mock API:
 * the profile and its save, filing a document, and the notification switches
 * for oneself and for a colleague. Moved out of `handlers.ts` as they were
 * (yuvoy-operator#178). The helpers and the state stay there. The profile,
 * the filed documents and the team come in through getters in `deps`,
 * because `__resetOperatorMocks` replaces them, and a saved profile goes back
 * through `setProfile`.
 */
export interface ProfileMockDeps {
  url: (path: string) => string;
  requireSession: (request: Request) => Response | null;
  /** Owner, admin or manager, else `403` with this refusal. */
  requireManager: (request: Request, refusal: string) => Response | null;
  envelope: (
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) => Response;
  sessionUser: (request: Request) => MockTeamMember | null;
  isLiveBusiness: (me: { id: string }) => boolean;
  fileForReview: (
    request: Request,
    kind: "logo" | "profile",
    summary: string,
  ) => void;
  /** `GET /profile`'s body, `missing` derived from what is on file. */
  profileResponse: () => Record<string, unknown>;
  /** One person's switches as `GET /me/notifications` answers them. */
  switchesFor: (user: MockTeamMember) => Record<string, unknown>;
  /** Applies the changes, or answers the refusal; `null` when applied. */
  applySwitches: (
    actor: MockTeamMember,
    target: MockTeamMember,
    changes: { group?: string; on?: unknown }[] | undefined,
  ) => Response | null;
  profile: () => MockProfile;
  /** Replaces the profile. */
  setProfile: (profile: MockProfile) => void;
  /** Credentials filed this session, by type. */
  filedCredentials: () => Record<string, { state: string; expiresOn?: string }>;
  /** Everybody on the account, invitations included. */
  team: () => MockTeamMember[];
}

export function profileHandlers(deps: ProfileMockDeps) {
  const {
    url,
    requireSession,
    requireManager,
    envelope,
    sessionUser,
    isLiveBusiness,
    fileForReview,
    profileResponse,
    switchesFor,
    applySwitches,
    profile,
    setProfile,
    filedCredentials,
    team,
  } = deps;

  return [
    /* -------------------------------------------------- profile & documents - */

    /**
     * The business behind the account.
     *
     * `missing` is DERIVED here rather than stored, the same way the API derives
     * it: a stored list is a second copy of the truth that goes stale the moment
     * somebody fills a field in. The names match the PUT's own field names, so a
     * form can mark the row it is about to ask for.
     */
    http.get(url("/profile"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      return HttpResponse.json(profileResponse());
    }),

    /**
     * Save the whole document.
     *
     * Modelled as a REPLACE, not a merge — "a whole document, not a patch of
     * single fields … partial writes would leave it half-saved in ways the
     * completeness check then has to reason about." A mock that merged would let
     * a client ship a form that omits a field and never notice it was cleared.
     */
    http.put(url("/profile"), async ({ request }) => {
      const failed = requireManager(
        request,
        "only an owner, admin or manager can change the business details",
      );
      if (failed) return failed;

      const body = (await request.json()) as Record<string, string | undefined>;
      const required = [
        "legalName",
        "entityType",
        "addressLine1",
        "locality",
        "region",
        "postalCode",
      ];
      for (const field of required) {
        if (!String(body[field] ?? "").trim()) {
          return envelope("invalid_input", `${field} is required.`, 400);
        }
      }
      const ENTITIES = [
        "sole_proprietor",
        "partnership",
        "llp",
        "private_limited",
        "society",
        "trust",
      ];
      if (!ENTITIES.includes(String(body.entityType))) {
        return envelope("invalid_input", "Not an entity type we know.", 400);
      }
      // 15 characters, or absent. The checksum is the server's business.
      if (body.gstin !== undefined && String(body.gstin).trim().length !== 15) {
        return envelope("invalid_input", "A GSTIN is 15 characters.", 400);
      }

      /*
        A LIVE business's change is RECORDED FOR REVIEW, not applied (D-032.3):
        the verified documents were checked against the name and address on
        file. 202 with no details, exactly as the API answers, and after the
        validation above, which the API also runs first. Nothing on file
        changes, so `GET /profile` goes on answering with the old details, and
        the change is listed on `GET /change-requests` as `profile`, pending. The `409
        details_locked` this replaced is no longer returned (yuvoy-api#222).
      */
      if (isLiveBusiness(sessionUser(request)!)) {
        fileForReview(request, "profile", "Registered name and address");
        return HttpResponse.json(
          {
            state: "in_review",
            next: "We check a change to your registered name or address, because your verified documents were checked against what is on file. Your current details stay in place until we do.",
          },
          { status: 202 },
        );
      }

      setProfile({
        ...profile(),
        legalName: body.legalName,
        entityType: body.entityType,
        gstin: body.gstin,
        address: {
          line1: body.addressLine1,
          line2: body.addressLine2,
          locality: body.locality,
          region: body.region,
          postalCode: body.postalCode,
          country: body.country ?? "IN",
        },
        submittedAt: new Date().toISOString(),
      });

      return HttpResponse.json(profileResponse());
    }),

    /**
     * File a document.
     *
     * **Always lands `pending`**, whatever the request says. "The state is fixed
     * server-side … a self-service path to `verified` would make the credential
     * gate decorative." A mock that honoured a client-supplied state would let
     * exactly that ship.
     *
     * Sending the same kind twice replaces rather than stacks, which the screen
     * warns about before the tap.
     */
    http.post(url("/credentials"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      const body = (await request.json()) as Record<string, string | undefined>;
      const type = String(body.type ?? "");
      const KINDS = [
        "directorate_registration",
        "instructor_cert",
        "oxygen",
        "equipment",
        "boat",
        "insurance",
        "bank",
        "gst",
      ];
      if (!KINDS.includes(type)) {
        return envelope("invalid_input", "Not a document kind we know.", 400);
      }

      // Replaces, never stacks.
      filedCredentials()[type] = {
        state: "pending",
        expiresOn: body.expiresOn,
      };

      return HttpResponse.json(
        { type, state: "pending", next: "we_check_it" },
        { status: 201 },
      );
    }),

    /* ------------------------------------------------- notifications ------ */

    http.get(url("/me/notifications"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      return HttpResponse.json(switchesFor(sessionUser(request)!));
    }),

    http.put(url("/me/notifications"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      const me = sessionUser(request)!;
      const body = (await request.json()) as {
        switches?: { group?: string; on?: unknown }[];
      };
      const refusal = applySwitches(me, me, body.switches);
      return refusal ?? HttpResponse.json(switchesFor(me));
    }),

    http.get(url("/team/:id/notifications"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      /*
        OWNER or ADMIN, and NOT `canManage` — the narrowest gate on these routes.
        "An owner and an admin control everybody's switches, and each person
        controls their own." A MANAGER has `canManage` and is refused here, which
        is why the mock cannot reuse `requireManager`.
      */
      const roles = sessionUser(request)!.roles;
      if (!roles.includes("OWNER") && !roles.includes("ADMIN")) {
        return envelope(
          "forbidden",
          "Only an owner or an admin can see somebody else's notifications.",
          403,
        );
      }
      const target = team().find(
        (m) => m.id === String(params.id) && !m.pending,
      );
      // A pending row is an invitation, not a person, and answers 404 like any
      // other id that names nobody.
      if (!target) return envelope("not_found", "No such member.", 404);
      return HttpResponse.json(switchesFor(target));
    }),

    http.put(url("/team/:id/notifications"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      const me = sessionUser(request)!;
      if (!me.roles.includes("OWNER") && !me.roles.includes("ADMIN")) {
        return envelope(
          "forbidden",
          "Only an owner or an admin can change somebody else's notifications.",
          403,
        );
      }
      const target = team().find(
        (m) => m.id === String(params.id) && !m.pending,
      );
      if (!target) return envelope("not_found", "No such member.", 404);

      const body = (await request.json()) as {
        switches?: { group?: string; on?: unknown }[];
      };
      const refusal = applySwitches(me, target, body.switches);
      return refusal ?? HttpResponse.json(switchesFor(target));
    }),
  ];
}
