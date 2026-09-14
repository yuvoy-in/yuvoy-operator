"use server";

import { requireOperator } from "@/lib/auth/session";
import { getSettlement } from "@/lib/money/fetch";
import { fetchStatement } from "@/lib/money/statement";
import { hasStatement } from "@/lib/money/settlements";

/**
 * Handing a payout statement to the browser (yuvoy-operator#47 item 7).
 *
 * ## Why a Server Action and not a link
 *
 * `/operator/v1` refuses CORS by design, and the session lives in an httpOnly
 * cookie the browser cannot read, so there is nothing for an `<a download>` to
 * carry. This repo has no route handlers either, enforced by a `qa` guard: a
 * generic proxy with the session attached hands back exactly the surface the
 * CORS refusal removes. So the bytes come through here.
 *
 * ## The settlement is re-read rather than trusted
 *
 * The id arrives from the client. Re-reading it does two things a client-sent
 * `state` could not: it proves this settlement belongs to the caller's business
 * (another business's answers `404`), and it gives the period for the filename
 * fallback. A client that sent its own `periodStart` would be naming the file
 * whatever it liked.
 */

export type DownloadResult =
  { ok: true; csv: string; filename: string } | { ok: false; message: string };

export async function downloadStatement(id: string): Promise<DownloadResult> {
  const { token, me } = await requireOperator();

  /*
    Said rather than thrown. Every settlement endpoint answers 403 to a staff
    login, and an unreadable refusal on a download button is worse than a
    sentence: retrying will never work, because nothing went wrong.
  */
  if (!me.canManage) {
    return {
      ok: false,
      message: "Only owners, admins and managers can download a statement.",
    };
  }

  let settlement: Awaited<ReturnType<typeof getSettlement>>;
  try {
    settlement = await getSettlement(token, id);
  } catch {
    return {
      ok: false,
      message: "We could not find that payout. Reload the page and try again.",
    };
  }

  /*
    Checked here as well as in the markup that draws the button. The markup's
    check is what a person sees; this is what the machine obeys, and the two can
    disagree across a stale page: a week approved when the page rendered may
    have been sent since, or the reverse.
  */
  if (!hasStatement(settlement)) {
    return {
      ok: false,
      message:
        "This payout has not been sent yet, so it has no statement. Reload the page.",
    };
  }

  const result = await fetchStatement(token, settlement);

  if (!result.ok) {
    /*
      Four outcomes, four sentences. `corrupt` is the one that matters: the
      contract publishes the file's sha256 so operator and platform "can each
      show we hold the same file", and a statement somebody cannot trust is
      worse than no statement, because they will reconcile against it anyway.
    */
    const message = {
      not_settled:
        "This payout has not been sent yet, so it has no statement. Reload the page.",
      not_found:
        "We could not find that payout. Reload the page and try again.",
      corrupt:
        "The statement did not arrive whole, so we have not saved it. Try again, and tell us if it keeps happening.",
      failed: "The statement did not download. Try again in a moment.",
    }[result.reason];
    return { ok: false, message };
  }

  return { ok: true, csv: result.csv, filename: result.filename };
}
