/**
 * The team actions' private schemas and helpers, moved out of actions.ts
 * (yuvoy-operator#178). Deliberately not "use server": there every async
 * export would become an action a browser can call.
 */
import { z } from "zod";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { EMAIL_MAX_LENGTH, looksLikeEmail } from "@/lib/auth/email";
import { INVITABLE_ROLES, type InvitableRole } from "@/lib/team/roles";
import { suspendedMessage } from "@/lib/account/suspended";
import type { AccessState } from "./actions";

/** E.164, the same rule the sign-in form applies. One vocabulary, one regex. */
const phoneSchema = z
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
  );

export const inviteSchema = z.object({
  phone: phoneSchema,
  name: z.string().trim().min(2, "Who is this? A name they will recognise."),
  /*
    Optional, and where the invitation goes while no phone channel can carry
    it, "which today is always: there is no WhatsApp sender" (yuvoy-operator#91
    f20, `POST /team`). A blank field is left out of the body rather than sent
    as "". A typed one is checked with the rule the API applies to this very
    field (`lib/auth/email.ts`), so a typo is caught on the phone instead of
    coming back as a 400, and nothing the API would take is refused here.
  */
  email: z
    .string()
    .trim()
    .max(EMAIL_MAX_LENGTH, "That is longer than an email address can be.")
    .refine(
      (v) => v === "" || looksLikeEmail(v),
      "That does not look like an email address. Check it, or leave it out.",
    ),
  /*
    Derived from INVITABLE_ROLES rather than retyped, so the radios, the
    validator and the request body cannot disagree about which two roles an
    invitation may ask for. The endpoint's own enum is all four and downgrades
    the middle two to STAFF; sending one of those would be asking for a role and
    being told, in a `note`, that we did not get it.
  */
  role: z.enum(
    INVITABLE_ROLES as unknown as [InvitableRole, ...InvitableRole[]],
  ),
});

/**
 * Which field a `400 invalid_input` from `POST /team` is about.
 *
 * One code covers two fields: "the number is not in E.164, or `email` was
 * given and is not an address". The API names the field in `details`
 * (`{ "email": "for example ramesh@example.com" }`), so that is what decides
 * it. With no details, which is how the API answered before the email
 * existed, it is the number, which was the only field it could be.
 */
export function invalidField(details: unknown): "email" | "phone" {
  if (details && typeof details === "object" && "email" in details) {
    return "email";
  }
  return "phone";
}

export const removeSchema = z.object({ id: z.string().min(1) });

export const idSchema = z.string().min(1);

/**
 * The refusals every access write shares, turned into one sentence each.
 *
 * Shared deliberately: four endpoints with the same 403 and the same
 * `409 cannot_change_access` should not drift into four different accounts of
 * what happened, and the difference between them is only ever the verb.
 */
export function accessFailure(err: unknown, verb: string): AccessState {
  if (err instanceof OperatorNetworkError) {
    return {
      message: `No signal. Nothing changed: ${verb} again when you have one.`,
    };
  }
  if (err instanceof OperatorApiError) {
    // A suspended business is refused with 403 too, and the role
    // sentence would be the wrong one. See `suspendedMessage`.
    const refusal = suspendedMessage(err);
    if (refusal) return { message: refusal };
    /*
      `cannot_change_access`, 403, 404 and 400, each rendered as the server said
      it (yuvoy-operator#51 item 4).

      Three sentences were written here by hand and two of them had gone wrong in
      the same direction. "It is either your own access, or the last owner"
      counts owners alone; the refusal is "your own access, or the last active
      OWNER or ADMIN". "You cannot change this person's access. An owner can" is
      false for an ADMIN acting on another ADMIN, which each of these four
      endpoints now allows — and it would be read by the very admin who was just
      offered the control.

      The server's own sentence tracks the rule as the rule moves. 404 in
      particular covers three states the contract deliberately does not tell
      apart — not on this team, not currently working, not on hold — and it is
      the one that knows which.
    */
    if (
      err.code === "cannot_change_access" ||
      err.status === 403 ||
      err.isNotFound ||
      err.status === 400
    ) {
      return {
        message:
          err.message ||
          `That did not work: ${verb} again once you have refreshed the list.`,
      };
    }
  }
  return { message: `That did not work. Try again.` };
}
