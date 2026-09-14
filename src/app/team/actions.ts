"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { INVITABLE_ROLES, type InvitableRole } from "@/lib/team/roles";
import { ASSIGNABLE_ROLES, type AssignableRole } from "@/lib/team/access";
import { suspendedMessage } from "@/lib/account/suspended";

/**
 * O5's writes. Every one of them is **OWNER or ADMIN** on the server, and this
 * file's job is to surface each refusal rather than to second-guess it.
 *
 * Note which gate is used: explicit roles, never `canManage`. `canManage` is
 * "OWNER, ADMIN or MANAGER" and it is the gate for capacity, closed dates,
 * earnings
 * and listing edits — not for this. A manager who could add a staff account
 * could hand out access to a business that is not theirs, and `pnpm qa` fails
 * a segment that calls one of these endpoints and decides on `canManage`.
 *
 * ## Why the three access writes revalidate and `remove` does not
 *
 * The rule this repo settled on: **revalidate only when the re-render shows
 * more than the message would.** Changing a role, holding and restoring all
 * change something the list itself displays — the chips, the state, which
 * controls the row offers — so the list becoming right IS the confirmation,
 * and it is a better one than a sentence.
 *
 * Removing is the opposite and stays as it was: revalidating makes the row
 * vanish, taking with it the one fact the operator needed back — that the
 * phone in somebody's pocket stopped working *now*, not at their next
 * sign-in.
 *
 * All three access writes end the person's sessions, which the screen says
 * before the tap rather than after it: somebody demoted mid-shift is signed
 * out, and an operator who does not expect that will think the portal broke.
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
  /**
   * The business's join link, to hand over directly.
   *
   * The same URL for everybody this business adds, and the same one `GET /team`
   * shows. It grants nothing on its own — the number must already have been
   * invited — which is what makes it safe to put on a screen and in a message.
   */
  joinUrl?: string;
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
      /*
        The link, carried back so the inviter can pass it on themselves.

        This was dropped before, and dropping it was the whole of the dead end:
        there is no WhatsApp delivery yet, so the queued message never arrives,
        and the only other thing on the response was `devCode` — which is gated
        on the mock flag and therefore absent in production. The owner was shown
        nothing and the invited person was told nothing.

        "On an island the person doing the inviting is usually standing next to
        the person being invited, and a link they can paste beats waiting for
        one to arrive."
      */
      joinUrl: data.joinUrl,
      devCode: MOCKING ? data.devCode : undefined,
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was sent. Try again." };
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
            "We could not send that invitation. Check the number, and note that an owner cannot be invited. The first one is set up by Yuvoy.",
        };
      }
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
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
        message: "No signal. They were NOT removed. They still have access.",
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
            "That cannot be removed. It is either you, or the last owner. Refresh to see who is on the account now.",
        };
      }
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
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

/* ------------------------------------------------------- manage access ---- */

export interface AccessState {
  message?: string;
  /** Set when the write landed, so the row can say what it did. */
  done?: "role" | "hold" | "restore";
}

const idSchema = z.string().min(1);

/**
 * The refusals every access write shares, turned into one sentence each.
 *
 * Shared deliberately: four endpoints with the same 403 and the same
 * `409 cannot_change_access` should not drift into four different accounts of
 * what happened, and the difference between them is only ever the verb.
 */
function accessFailure(err: unknown, verb: string): AccessState {
  if (err instanceof OperatorNetworkError) {
    return {
      message: `No signal. Nothing changed: ${verb} again when you have one.`,
    };
  }
  if (err instanceof OperatorApiError) {
    if (err.code === "cannot_change_access") {
      /*
        The screen already withholds both cases beside the row, so reaching
        here means the account changed underneath — the other owner was
        removed a minute ago on somebody else's phone.
      */
      return {
        message:
          "That cannot be changed. It is either your own access, or the last owner. Refresh to see who is on the account now.",
      };
    }
    // A suspended business is refused with 403 too, and the role
    // sentence would be the wrong one. See `suspendedMessage`.
    const refusal = suspendedMessage(err);
    if (refusal) return { message: refusal };
    if (err.status === 403) {
      return {
        message: "You cannot change this person's access. An owner can.",
      };
    }
    if (err.isNotFound) {
      /*
        404 covers three different things — not on this team, not currently
        working, not on hold — and the contract deliberately does not tell
        "gone" from "belongs to somebody else" apart. One message, and it says
        the only useful thing: what you are looking at is out of date.
      */
      return {
        message:
          "That is not what this account looks like now. Refresh the list.",
      };
    }
    if (err.status === 400 && err.message) return { message: err.message };
  }
  return { message: `That did not work. Try again.` };
}

/**
 * Change what somebody can do.
 *
 * "The role is **replaced**, not added to" — the picker is a choice of one and
 * the endpoint's semantics match it, so there is nothing to reconcile here.
 * `OWNER` is not in `ASSIGNABLE_ROLES`, so it cannot be sent even by a hand
 * -crafted form post: the schema refuses it before the request exists.
 */
export async function setMemberRole(
  _prev: AccessState,
  form: FormData,
): Promise<AccessState> {
  const parsed = z
    .object({
      id: idSchema,
      role: z.enum(
        ASSIGNABLE_ROLES as unknown as [AssignableRole, ...AssignableRole[]],
      ),
    })
    .safeParse({
      id: String(form.get("id") ?? ""),
      role: String(form.get("role") ?? ""),
    });
  if (!parsed.success) return { message: "Choose a role." };

  const { token } = await requireOperator();

  try {
    const { error } = await operatorApi(token).PUT("/team/{id}/role", {
      params: { path: { id: parsed.data.id } },
      body: { role: parsed.data.role },
    });
    if (error) throw error;
  } catch (err) {
    return accessFailure(err, "change it");
  }

  // The chips, the description and which controls the row offers all change.
  // The list is a better confirmation than a sentence.
  revalidatePath("/team");
  return { done: "role" };
}

/**
 * Pause somebody's login without taking their access away.
 *
 * "The row, the role and the history stay; `restore` is one call back." So the
 * held member must remain visible with a state and a way back, rather than
 * disappearing — a person who vanishes from this list reads as removed, which
 * is the other verb entirely.
 */
export async function holdMember(
  _prev: AccessState,
  form: FormData,
): Promise<AccessState> {
  const parsed = idSchema.safeParse(String(form.get("id") ?? ""));
  if (!parsed.success) return { message: "Nothing to pause." };

  const { token } = await requireOperator();

  try {
    const { error } = await operatorApi(token).POST("/team/{id}/hold", {
      params: { path: { id: parsed.data } },
    });
    if (error) throw error;
  } catch (err) {
    return accessFailure(err, "pause them");
  }

  revalidatePath("/team");
  return { done: "hold" };
}

/** Give held access back, with the role they had. */
export async function restoreMember(
  _prev: AccessState,
  form: FormData,
): Promise<AccessState> {
  const parsed = idSchema.safeParse(String(form.get("id") ?? ""));
  if (!parsed.success) return { message: "Nothing to restore." };

  const { token } = await requireOperator();

  try {
    const { error } = await operatorApi(token).POST("/team/{id}/restore", {
      params: { path: { id: parsed.data } },
    });
    if (error) throw error;
  } catch (err) {
    return accessFailure(err, "restore them");
  }

  revalidatePath("/team");
  return { done: "restore" };
}
