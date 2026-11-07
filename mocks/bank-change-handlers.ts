import { http, HttpResponse } from "msw";
import { DEV_CODE, type MockTeamMember } from "./fixtures";

/**
 * The step-up and bank change routes of the mock API. Moved out of
 * `handlers.ts` as they were (yuvoy-operator#178). The state stays there,
 * because `__resetOperatorMocks` replaces it, so it comes in through getters
 * and the one setter in `deps`.
 */
export interface BankChangeMockDeps {
  url: (path: string) => string;
  requireSession: (request: Request) => Response | null;
  requireOwner: (request: Request) => Response | null;
  requireWritable: (request: Request) => Response | null;
  envelope: (
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) => Response;
  sessionUser: (request: Request) => MockTeamMember | null;
  businessOf: (request: Request) => string;
  changesFor: (request: Request) => Record<string, unknown>[];
  openBankChanges: (request: Request) => Record<string, unknown>[];
  /** Reef Divers' team as it is now. */
  team: () => MockTeamMember[];
  /** Whether this process has passed step-up. */
  isSteppedUp: () => boolean;
  /** Marks step-up as passed. */
  stepUp: () => void;
  /** The bank changes raised since the process started. */
  bankChanges: () => Record<string, unknown>[];
  /** The ids of the changes somebody stopped. */
  stoppedChanges: () => string[];
}

export function bankChangeHandlers(deps: BankChangeMockDeps) {
  const {
    url,
    requireSession,
    requireOwner,
    requireWritable,
    envelope,
    sessionUser,
    businessOf,
    changesFor,
    openBankChanges,
    team,
    isSteppedUp,
    stepUp,
    bankChanges,
    stoppedChanges,
  } = deps;

  return [
    /* --------------------------------------------------------- step up ---- */

    http.post(url("/auth/step-up"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      /*
        `sent: false` when there is NOBODY to send it to — yuvoy-operator#46
        item 4.

        "A business with no active owner, whose first person runs it (D15), has
        nobody to send it to. The code goes to no number, `sent` is `false`, and
        no session there can be elevated until an owner has joined."

        Modelled by looking at the team, because the portal had been returning
        `sent: true` whatever the API said — so somebody at such a business was
        handed a code field and left typing into it. A mock that always sent one
        would have kept that invisible.
      */
      const me = sessionUser(request)!;
      /*
        Whose business, and therefore whose owners. An identity created through
        `POST /auth/signup` is a business of its own with exactly one person on
        it, so asking Reef Divers' team about it would answer for somebody else's
        shop — and the one business that can have no owner is precisely the solo
        one whose first person answered "I run it for the owner".
      */
      const onReef = team().some((m) => m.id === me.id);
      const hasActiveOwner = onReef
        ? team().some(
            (m) =>
              !m.pending &&
              m.state !== "suspended" &&
              m.roles.includes("OWNER"),
          )
        : me.roles.includes("OWNER");
      if (!hasActiveOwner) {
        return HttpResponse.json({ sent: false }, { status: 202 });
      }

      // Sent to the OWNER's number whoever asks. The mock does not model a
      // second user, but it does model that asking is not the same as receiving.
      return HttpResponse.json(
        { sent: true, expiresIn: 600, devCode: DEV_CODE },
        { status: 202 },
      );
    }),

    http.post(url("/auth/step-up/verify"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      const { code } = (await request.json()) as { code?: string };
      if (code !== DEV_CODE) {
        // Wrong, expired and used all answer the same way.
        return envelope("unauthorized", "That code did not work.", 401);
      }
      stepUp();
      return HttpResponse.json({ elevated: true, expiresIn: 600 });
    }),

    /* ------------------------------------------------------ bank change --- */

    http.post(url("/change-requests/bank"), async ({ request }) => {
      /*
        The gates are enforced, not assumed. A mock that raises a change without
        step-up would let the client ship without the code step — and the first
        time anybody found out would be in production, on the one flow where the
        whole design is the gate.

        **Both** gates, since 6 September. The contract has always said the 403
        is "also returned to anyone who is not the OWNER" and this mock checked
        only the step-up, so the client's own OWNER gate on the bank form had
        never once been exercised against a refusal — the same hole the 2
        September audit found across the manager-only writes.

        The role is checked FIRST: somebody who may not do this at all should be
        refused for who they are, not sent to fetch a code that will not help.
        Note that requesting the code is deliberately open to anybody — "the code
        goes to the OWNER's number whoever asks" — so this is the only place the
        role can be refused.

        This is now the ONLY genuinely OWNER-only endpoint in the contract:
        `POST /change-requests/{id}/cancel` widened to OWNER or ADMIN, and so did
        all four team writes.
      */
      const failed = requireOwner(request);
      if (failed) return failed;

      /*
        Raising a change is refused while suspended; stopping one is not
        (yuvoy-operator#50). After the role gate, for the reason the role gate is
        first: somebody who may not do this at all should be refused for who they
        are rather than for the state of the business.
      */
      const shut = requireWritable(request);
      if (shut) return shut;

      if (!isSteppedUp()) {
        return envelope("step_up_required", "Ask for a code first.", 403);
      }
      if (!sessionUser(request)!.roles.includes("OWNER")) {
        return envelope("forbidden", "Only the owner can change this.", 403);
      }

      // Open BANK changes only: see `openBankChanges`.
      const open = openBankChanges(request);
      if (open.length > 0) {
        // "Two open bank changes would mean the second approval silently decides
        // which account wins."
        return envelope(
          "change_already_in_progress",
          "Cancel the open one first.",
          409,
        );
      }

      const body = (await request.json()) as {
        accountHolder?: string;
        accountNumber?: string;
        ifsc?: string;
        bankName?: string;
      };
      const account = (body.accountNumber ?? "").replace(/\s/g, "");
      if (!/^\d{9,18}$/.test(account)) {
        return envelope(
          "invalid_input",
          "accountNumber must be 9-18 digits.",
          400,
        );
      }
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test((body.ifsc ?? "").toUpperCase())) {
        return envelope("invalid_input", "ifsc is malformed.", 400);
      }

      const id = `chg_${Math.random().toString(36).slice(2, 10)}`;
      const objectionUntil = new Date(Date.now() + 24 * 3600_000).toISOString();
      /*
        Masked, in the API's own shape (`BankChange.Summary`): "HDFC Bank ····4412
        (HDFC0001234)", or "····4412 (HDFC0001234)" with no bank name. It wrote
        "Bank ••••4412 · HDFC0001234" before, a shape no API sends.
      */
      const ifsc = (body.ifsc ?? "").toUpperCase();
      const summary = `${body.bankName ? `${body.bankName} ` : ""}····${account.slice(-4)} (${ifsc})`;

      bankChanges().unshift({
        // Whose it is. See `changesFor`.
        raisedFor: businessOf(request),
        id,
        kind: "bank_account",
        state: "objection_window",
        summary,
        requestedAt: new Date().toISOString(),
        objectionUntil,
        coolingUntil: null,
      });

      return HttpResponse.json(
        {
          id,
          state: "objection_window",
          summary,
          objectionUntil,
          whatHappensNext:
            "We have messaged the owner. You can stop this for the next 24 hours. After that a person at Yuvoy reviews it, and it goes live 24 hours after they approve — still stoppable the whole time.",
        },
        { status: 202 },
      );
    }),

    http.post(
      url("/change-requests/:id/cancel"),
      async ({ request, params }) => {
        const failed = requireSession(request);
        if (failed) return failed;

        const id = String(params.id);
        /*
          Scoped to the caller's own business. Another business's change is a `404`,
          never a `403` — "a row belonging to another operator answers 404, never
          403. A 403 would confirm the row exists, which is precisely what somebody
          probing ids wants to learn."
        */
        const found = (
          changesFor(request) as { id?: string; state?: string }[]
        ).find((r) => r.id === id);
        if (!found) return envelope("not_found", "No such change.", 404);

        if (stoppedChanges().includes(id) || found.state === "applied") {
          /*
            Distinguished from 404 on purpose: "we cannot find it" and "it already
            happened" mean very different things to somebody who has just realised
            their account was compromised.
          */
          return envelope(
            "change_already_decided",
            "It has already gone through.",
            409,
          );
        }

        /*
          Marked withdrawn rather than removed. A cancelled change is part of the
          account's history — an owner who stopped one needs to be able to show
          that they did, and a record that disappears is the opposite of an audit
          trail. `withdrawn` is in the contract's own state enum for this.
        */
        stoppedChanges().push(id);
        return new HttpResponse(null, { status: 204 });
      },
    ),
  ];
}
