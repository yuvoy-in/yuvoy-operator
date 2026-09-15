import "server-only";
import { createHash } from "node:crypto";
import { apiBaseUrl } from "@/lib/api/server-client";
import { statementFilename, type Settlement } from "./settlements";

/**
 * Fetching a payout statement, and proving it arrived whole
 * (yuvoy-operator#47 item 7).
 *
 * ## Why this is a raw `fetch` and not the generated client
 *
 * The body is `text/csv` and the two things that matter are HEADERS:
 * `X-Payout-Sha256` and `Content-Disposition`. The generated client is built
 * for JSON envelopes and hands back a parsed body; it is the right tool for
 * every other call in this repo and the wrong one for a file.
 *
 * ## Why the portal fetches it at all, rather than linking to it
 *
 * `/operator/v1` refuses CORS by design and the session lives in an httpOnly
 * cookie the browser cannot read, so there is nothing for a link to carry.
 * This repo has no route handlers either, by a `qa` guard: a generic proxy with
 * the session attached hands back exactly the surface the CORS refusal removes.
 * So a Server Action reads the bytes and returns them.
 *
 * ## The integrity check is the point, not decoration
 *
 * The contract says the sha256 "is in the `X-Payout-Sha256` header, so you and
 * we can each show we hold the same file". An operator reconciling a quarter
 * against their own book is the person who needs that guarantee, and a
 * truncated CSV is exactly the failure that would otherwise look like a
 * discrepancy in the money rather than in the transfer.
 *
 * A mismatch refuses rather than warning. A statement somebody cannot trust is
 * worse than no statement, because they will reconcile against it anyway.
 */

export type StatementResult =
  | { ok: true; csv: string; filename: string; sha256: string }
  | { ok: false; reason: "not_settled" | "not_found" | "corrupt" | "failed" };

export async function fetchStatement(
  token: string,
  settlement: Pick<Settlement, "id" | "periodStart" | "periodEnd">,
): Promise<StatementResult> {
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl()}/settlements/${encodeURIComponent(settlement.id)}/statement`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/csv" },
        cache: "no-store",
      },
    );
  } catch {
    return { ok: false, reason: "failed" };
  }

  /*
    `409 not_settled` is not an error to show as one: the button should not have
    been drawn, so the caller hides it and refreshes. `404` is another
    business's settlement, which is the not-found screen.
  */
  if (response.status === 409) return { ok: false, reason: "not_settled" };
  if (response.status === 404) return { ok: false, reason: "not_found" };
  if (!response.ok) return { ok: false, reason: "failed" };

  const csv = await response.text();
  const claimed = response.headers.get("x-payout-sha256");
  const actual = createHash("sha256").update(csv, "utf8").digest("hex");

  /*
    Compared case-insensitively and only when the header is there.

    A server that stops sending the header has not corrupted anything, and
    refusing the download over a missing guarantee would take away a working
    feature over a header change. A header that is PRESENT and disagrees is the
    case worth refusing.
  */
  if (claimed && claimed.toLowerCase() !== actual) {
    return { ok: false, reason: "corrupt" };
  }

  return {
    ok: true,
    csv,
    filename: statementFilename(
      response.headers.get("content-disposition"),
      settlement,
    ),
    sha256: actual,
  };
}
