"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { INVITABLE_ROLES, type InvitableRole } from "@/lib/team/roles";

/**
 * O5's two writes. Both are **OWNER only** on the server, and this file's job
 * is to surface that refusal rather than to second-guess it.
 *
 * Note which gate is used: `roles.includes("OWNER")`, never `canManage`.
 * `canManage` is "OWNER or MANAGER" and it is the gate for capacity, closed
 * dates, earnings and listing edits — not for this. A manager who could add a
 * staff account could hand out access to a business that is not theirs, and
 * `pnpm qa` now fails a segment that calls an OWNER-only endpoint and decides
 * on `canManage`.
 */

const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

/* ------------------------------------------------------------- invite ---- */

export interface InviteState {
  message?: string;
  field?: "phone" | "name" | "role";
  /** Set when the invitation was sent. */
  sent?: {
    name: string;
    /**
     * The number it went to, echoed back from what was typed.
     *
     * The list shows the last four digits of every row (`phoneMasked`,
     * yuvoy-api#62); this is the one place the whole number is shown, once,
     * while the owner still remembers what they meant to type.
     */
    phone: string;
    role: InvitableRole;
  };
  /** Development only, exactly as on sign-in and step-up. */
  devCode?: string;
}

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

const inviteSchema = z.object({
  phone: phoneSchema,
  name: z.string().trim().min(2, "Who is this? A name they will recognise."),
  /*
    Derived from INVITABLE_ROLES rather than retyped, so the select, the
    validator and the request body cannot disagree about a set whose whole
    point is that OWNER is not in it.
  */
  role: z.enum(
    INVITABLE_ROLES as unknown as [InvitableRole, ...InvitableRole[]],
  ),
});

export async function inviteMember(
  _prev: InviteState,
  form: FormData,
): Promise<InviteState> {
  const parsed = inviteSchema.safeParse({
    phone: String(form.get("phone") ?? ""),
    name: String(form.get("name") ?? ""),
    role: String(form.get("role") ?? ""),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      field: issue.path[0] as InviteState["field"],
      message: issue.message,
    };
  }

  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).POST("/team", {
      body: parsed.data,
    });
    if (error) throw error;

    /*
      Revalidate, and let the list be the confirmation — the same test O4's
      bank change passes and O9's accept fails. The invitation appears as a
      pending row with its role, which is strictly more than a message could
      say, and this form is rendered unconditionally for an owner so the
      returned state survives the re-render rather than unmounting with it.
    */
    revalidatePath("/team");

    return {
      sent: {
        name: parsed.data.name,
        phone: parsed.data.phone,
        role: parsed.data.role,
      },
      devCode: MOCKING ? data.devCode : undefined,
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was sent — try again." };
    }
    if (err instanceof OperatorApiError) {
      if (err.code === "cannot_invite") {
        /*
          ONE message, and no attempt to work out which failure it was.

          "A number already belonging to any operator is refused with the same
          message as any other failure, so this endpoint cannot be used to find
          out which businesses are on Yuvoy — the same reason sign-in answers
          identically for known and unknown numbers." A client that guessed
          between "already on another operator" and "cannot invite an owner"
          would rebuild exactly the oracle the server refuses to be.
        */
        return {
          message:
            "We could not send that invitation. Check the number, and note that an owner cannot be invited — the first one is set up by Yuvoy.",
        };
      }
      if (err.status === 403) {
        return {
          message:
            "Only the owner can add people. Ask them to do it from their own login.",
        };
      }
      if (err.status === 400) return { message: err.message };
    }
    return { message: "The invitation was not sent. Try again." };
  }
}

/* ------------------------------------------------------------- remove ---- */

export interface RemoveState {
  message?: string;
  /** Set when they were removed, so the row can say what that did. */
  removed?: boolean;
}

const removeSchema = z.object({ id: z.string().min(1) });

/**
 * Remove somebody, or revoke an invitation nobody accepted.
 *
 * "Their sessions are revoked in the same transaction. Marking a user removed
 * while leaving a 14-day session alive is the difference between 'we removed
 * them' and 'we removed them a fortnight from now', and the reason somebody is
 * removed in a hurry is usually that the fortnight matters."
 *
 * That is the fact the operator needs back, which is why this one does **not**
 * revalidate. Revalidating re-renders the list, the row is gone, and the
 * confirmation goes with it — the operator taps Remove, a line vanishes, and
 * nothing anywhere says the phone in somebody's pocket stopped working. Same
 * shape as O9's accept and O4's brake, and the same answer.
 */
export async function removeMember(
  _prev: RemoveState,
  form: FormData,
): Promise<RemoveState> {
  const parsed = removeSchema.safeParse({ id: String(form.get("id") ?? "") });
  if (!parsed.success) return { message: "Nothing to remove." };

  const { token } = await requireOperator();

  try {
    const { error } = await operatorApi(token).DELETE("/team/{id}", {
      params: { path: { id: parsed.data.id } },
    });
    if (error) throw error;
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return {
        message: "No signal. They were NOT removed — they still have access.",
      };
    }
    if (err instanceof OperatorApiError) {
      if (err.code === "cannot_remove") {
        /*
          The screen already disables both cases beside the row, so reaching
          this means the account changed under the operator — the other owner
          was removed a minute ago on somebody else's phone.
        */
        return {
          message:
            "That cannot be removed — it is either you, or the last owner. Refresh to see who is on the account now.",
        };
      }
      if (err.status === 403) {
        return { message: "Only the owner can remove people." };
      }
      if (err.isNotFound) {
        // 404 and 403-for-another-tenant are one case: the server does not
        // distinguish them, and neither does this.
        return {
          message: "They are no longer on this account. Refresh the list.",
        };
      }
    }
    return { message: "They were not removed. Try again." };
  }

  return { removed: true };
}
