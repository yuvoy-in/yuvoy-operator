"use server";

import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { suspendedMessage } from "@/lib/account/suspended";
import { canManageAccess } from "@/lib/team/access";
import {
  toSettings,
  type NotificationSettings,
} from "@/lib/account/notifications";

/**
 * Turning one switch — yuvoy-operator#46 items 5 and 6.
 *
 * ## One switch per call, never the whole set
 *
 * "Only the switches named change, and the answer carries all of them." Sending
 * every switch on every toggle would make two people on two phones overwrite
 * each other's: the second save would carry a stale copy of the first's switch
 * and put it back. Naming one changes one.
 *
 * ## The answer is the new truth, and it is redrawn from
 *
 * The response "carries all of them", `changedAt` and `changedBy` included, so
 * the screen redraws from it rather than flipping its own boolean. That is the
 * only way the attribution line can appear without a reload — and it is what
 * makes an owner turning off somebody else's switch visible on that person's own
 * screen.
 */

export type SwitchResult =
  | { ok: true; settings: NotificationSettings }
  | { ok: false; message: string; gone?: boolean };

/**
 * `null` for my own switches, or a team member's id for somebody else's.
 *
 * Two endpoints with identical shapes, so one action. `PUT /team/{id}/...` is
 * "OWNER or ADMIN only" and NOT `canManage`: a MANAGER gets a 403, which is
 * narrower than every other team write and is the API's decision.
 */
export async function setSwitch(
  memberId: string | null,
  group: string,
  on: boolean,
): Promise<SwitchResult> {
  const { token, me } = await requireOperator();

  /*
    Said here as well as by the API, and `pnpm qa` fails a route that reaches
    this endpoint without deciding on the role.

    A Server Action is a public POST endpoint: the page that draws somebody
    else's switches is gated, and that gate is a courtesy to whoever is looking
    at the screen. This is the one a hand-crafted request meets. `GET /me` is
    re-read on every action, so it is the role at the moment of the tap rather
    than the one the page was rendered with.

    OWNER or ADMIN, NOT `canManage`: a MANAGER has `canManage` and is refused
    here, which is the API's decision and is narrower than every other team
    write.
  */
  if (memberId && !canManageAccess(me.roles)) {
    return {
      ok: false,
      message:
        "Only an owner or an admin can change somebody else's notifications.",
    };
  }

  try {
    const body = { switches: [{ group: group as never, on }] };
    const { data, error } = memberId
      ? await operatorApi(token).PUT("/team/{id}/notifications", {
          params: { path: { id: memberId } },
          body,
        })
      : await operatorApi(token).PUT("/me/notifications", { body });
    if (error) throw error;
    return { ok: true, settings: toSettings(data) };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { ok: false, message: "No signal. Nothing was changed." };
    }
    if (err instanceof OperatorApiError) {
      // A suspended business is refused with 403 too, and its own sentence says
      // which of suspended, closed or disqualified it is.
      const refusal = suspendedMessage(err);
      if (refusal) return { ok: false, message: refusal };
      if (err.status === 400) {
        /*
          "No switch named, one named twice, one without `on`, or a name that is
          not a switch. The message lists the switches that exist." Which is
          more useful than anything this screen could write, and is how a build
          with a stale group name finds out.
        */
        return { ok: false, message: err.message };
      }
      if (err.status === 403) {
        return {
          ok: false,
          message:
            err.message ||
            "Only an owner or an admin can change somebody else's notifications.",
        };
      }
      if (err.isNotFound) {
        // The person is off the team. The list behind this is out of date.
        return {
          ok: false,
          message: "They are no longer on this account. Refresh the list.",
          gone: true,
        };
      }
    }
    return { ok: false, message: "Nothing was changed. Try again." };
  }
}
