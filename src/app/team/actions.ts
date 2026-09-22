"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { EMAIL_MAX_LENGTH, looksLikeEmail } from "@/lib/auth/email";
import { sentence } from "@/lib/format/sentence";
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
  field?: "phone" | "name" | "role" | "email";
  /**
   * What was typed, handed back with a refusal so the form can put it back.
   *
   * React resets a form once its action completes and these inputs are
   * uncontrolled, so a typo in the email emptied all three fields and the
   * owner retyped a name and thirteen digits to fix one character. The same
   * repair `/sign-in` and `/signup` carry. Never set on success: an invitation
   * that went through should leave an empty form for the next person.
   */
  values?: { name: string; phone: string; email: string; role: string };
  /** Bumped per submission, so the form remounts and re-reads `values`. */
  attempt?: number;
  /** Set when the invitation was created. */
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
    /**
     * What accepting will make them, **from the response** rather than from what
     * was asked for.
     *
     * `POST /team` answers `role` as `OWNER` or `STAFF` and nothing else: an
     * invitation for ADMIN or MANAGER is "sent, not refused", downgraded to
     * STAFF, and carries a `note` saying so. Echoing the request back would tell
     * the inviter they had made somebody an admin when they had not.
     */
    role: string;
    /**
     * Whether anything is actually carrying the invitation to them.
     *
     * yuvoy-operator#91 f20. `sent` is "read back from the queued message
     * rather than asserted, and it is `false` when we hold no address we can
     * reach that person on". Before yuvoy-api 67e3213 it was `true` of every
     * invitation, including every one queued on a WhatsApp sender that does
     * not exist, and the form said "We message them a code". The owner
     * believed their colleague had been told, and nothing arrived.
     *
     * `true` only when the API says `true`. Absent is read as NOT sent: the
     * failure of saying "sent" about a message nobody carried is a colleague
     * waiting on a phone, and the failure of the reverse is a link passed on
     * by hand that was not strictly needed.
     */
    delivered: boolean;
  };
  /**
   * The server's own sentence to the person inviting, rendered as it sent it
   * (through `sentence()`, which strips a long dash our copy rule cannot reach
   * in another team's database).
   *
   * Two things put one here. When `sent` is `false` it says to pass the link
   * on and how to make the next one arrive (#91). And when `role` is not the
   * role asked for it says they join as staff; this form only ever asks for
   * OWNER or STAFF, so that one should never arrive, which is exactly why it
   * is rendered rather than dropped: if it does, this build and the API
   * disagree about what an invitation grants, and the person handing a phone
   * over is the one who needs to know.
   */
  note?: string;
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
function invalidField(details: unknown): "email" | "phone" {
  if (details && typeof details === "object" && "email" in details) {
    return "email";
  }
  return "phone";
}

export async function inviteMember(
  prev: InviteState,
  form: FormData,
): Promise<InviteState> {
  // Exactly as typed, for the refusals below to hand back. See `values`.
  const values = {
    name: String(form.get("name") ?? ""),
    phone: String(form.get("phone") ?? ""),
    email: String(form.get("email") ?? ""),
    role: String(form.get("role") ?? ""),
  };
  const attempt = (prev.attempt ?? 0) + 1;
  const refuse = (
    state: Omit<InviteState, "values" | "attempt">,
  ): InviteState => ({ ...state, values, attempt });

  const parsed = inviteSchema.safeParse({
    phone: values.phone,
    name: values.name,
    email: values.email,
    role: values.role,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return refuse({
      field: issue.path[0] as InviteState["field"],
      message: issue.message,
    });
  }

  const { token } = await requireOperator();
  const { email, ...rest } = parsed.data;

  try {
    const { data, error } = await operatorApi(token).POST("/team", {
      body: { ...rest, ...(email ? { email } : {}) },
    });
    if (error) throw error;

    /*
      Revalidate, and let the list be the confirmation — the same test O4's
      bank change passes and O9's accept fails. The invitation appears as a
      pending row with its role, which is strictly more than a message could
      say, and this form is rendered unconditionally for an owner so the
      returned state survives the re-render rather than unmounting with it.

      The form ALSO refreshes the route once the receipt is on screen
      (`InviteForm`). yuvoy-operator#89 f16 found the new invitation missing
      from the list until a reload on the live portal, and this revalidate was
      already here, so the list is no longer left to one mechanism.
    */
    revalidatePath("/team");

    return {
      attempt,
      sent: {
        name: parsed.data.name,
        phone: parsed.data.phone,
        /*
          The response's role, falling back to what was asked only if the field
          is absent. `role` is optional in the schema, and a receipt with no role
          on it is worse than the one thing we did ask for.
        */
        role: data.role ?? parsed.data.role,
        delivered: data.sent === true,
      },
      note: data.note ? sentence(data.note) : undefined,
      /*
        The link, carried back so the inviter can pass it on themselves.

        This was dropped before, and dropping it was the whole of the dead end:
        nothing the API queued ever arrived, and the only other thing on the
        response was `devCode`, which is gated on the mock flag and therefore
        absent in production. The owner was shown nothing and the invited
        person was told nothing.

        "On an island the person doing the inviting is usually standing next to
        the person being invited, and a link they can paste beats waiting for
        one to arrive."
      */
      joinUrl: data.joinUrl,
      devCode: MOCKING ? data.devCode : undefined,
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return refuse({ message: "No signal. Nothing was sent. Try again." });
    }
    if (err instanceof OperatorApiError) {
      if (err.code === "cannot_invite") {
        /*
          The SERVER's sentence, and no attempt to work out which failure it was.

          "A number already belonging to any operator is refused with the same
          message as any other failure, so this endpoint cannot be used to find
          out which businesses are on Yuvoy — the same reason sign-in answers
          identically for known and unknown numbers." A client that guessed
          between the possible causes would rebuild exactly the oracle the
          endpoint refuses to be, and the one message it does send is the only one
          that stays true as the causes change.

          It is rendered rather than reworded for a second reason: our own
          sentence carried "an owner cannot be invited. The first one is set up by
          Yuvoy", which stopped being true on 14 September (D15,
          yuvoy-operator#51 item 2). An owner IS invitable now, so the copy was
          telling operators the opposite of what the form in front of them does.
        */
        return refuse({
          message: sentence(err.message) || "The invitation was not sent.",
        });
      }
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return refuse({ message: refusal });
      /*
        403 and 400 both come through as the server said them. The hand-written
        403 read "only the owner can add people", which an ADMIN would read on a
        screen whose invite form they are allowed to use: `POST /team` is "OWNER
        or ADMIN". The fallbacks stay for an empty message, never as a rewrite.
        Through `sentence()`, because the API writes them in lower case for its
        logs and a screen's sentences start with a capital.
      */
      if (err.status === 403) {
        return refuse({
          message:
            sentence(err.message) ||
            "You cannot add people to this account. An owner or an admin can.",
        });
      }
      if (err.status === 400) {
        /*
          `invalid_input` belongs ON the field it is about, and since the email
          it can be about either: `details` names which (`invalidField`). A bad
          address used to have nowhere to go but the number, which would have
          pointed the owner at the one field they had typed correctly. Anything
          else 400 can be here is `invalid_role`, which is not a field somebody
          can fix by typing, so it is said once at the bottom.
        */
        const field =
          err.code === "invalid_input" ? invalidField(err.details) : undefined;
        return refuse({
          field,
          message:
            sentence(err.message) ||
            (field === "email"
              ? "That does not look like an email address. Check it, or leave it out."
              : "Something in that invitation needs fixing."),
        });
      }
    }
    return refuse({ message: "The invitation was not sent. Try again." });
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
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      /*
        `cannot_change_access`, 403 and 404, each as the server said it.

        `cannot_remove` used to be branched on here and is GONE from the
        contract: `DELETE /team/{id}` answers `409 cannot_change_access`, and the
        issue is explicit that "`cannot_remove` is never sent"
        (yuvoy-operator#51 item 4). A branch on a code nobody sends is a branch
        that never runs, and the sentence it held — "it is either you, or the
        last owner" — had also stopped being true, since the refusal counts
        owners and admins together.

        The hand-written 403 was worse than dead: "Only the owner can remove
        people" is false. An ADMIN may remove people, and reads it on a row whose
        Remove button they were just offered.
      */
      if (
        err.code === "cannot_change_access" ||
        err.status === 403 ||
        err.isNotFound
      ) {
        return {
          message:
            err.message ||
            "They were not removed. Refresh to see who is on the account now.",
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
