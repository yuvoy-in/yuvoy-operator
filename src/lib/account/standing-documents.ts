/**
 * The account's documents: which are held, which are expiring and what
 * to do about each, and `stateLabel`, which their names are read with.
 * Moved out of standing.ts (yuvoy-operator#178), which re-exports every
 * name here, so callers still import them from standing.ts.
 */
import { daysUntilMarketDate, marketDateLabel } from "@/lib/format/market-time";
import type { OperatorCredential } from "./standing";

/**
 * `PROSPECT` → `Prospect`, `AWAITING_REVIEW` → `Awaiting review`.
 *
 * A screaming-snake constant is a database value on a phone screen. This does
 * not map or translate — mapping would be branching, and the value set is open
 * — it only makes an unknown string readable.
 */
export function stateLabel(state: string): string {
  const words = state.trim().toLowerCase().replace(/[_-]+/g, " ").trim();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A document we verified and hold no file for: yuvoy-operator#93.
 *
 * `hasFile` is "sent on every row", and a verified row with it `false` is
 * Yuvoy vouching for a document it cannot produce: "if a regulator or an
 * insurer asks, there is nothing to show". Keyed on an explicit `false`, never
 * on the flag being absent: an older API that does not send it must leave the
 * row as it was rather than accuse it of missing a file.
 */
export function verifiedWithoutFile(credential: {
  state?: string;
  hasFile?: boolean;
}): boolean {
  return credential.state === "verified" && credential.hasFile === false;
}

/**
 * What a credential is doing, in the words the row needs.
 *
 * `state` is a closed enum here (`pending`, `verified`, `rejected`, `expired`)
 * — unlike the account's own `state` — so it is safe to branch on. An unknown
 * value still falls through to the raw string rather than to silence.
 *
 * `saysNoFile` is set when the sentence already says we hold no file, so the
 * row does not say it twice.
 */
export function credentialText(
  credential: OperatorCredential,
  now: number,
): { tone: "ok" | "warn" | "problem"; text: string; saysNoFile?: boolean } {
  const expiring = expiryWarning(credential, now);

  switch (credential.state) {
    case "verified":
      /*
        The load-bearing case from the issue: "a dive licence that lapses
        mid-season takes the listing down, and an operator who was never shown
        the date finds out from a cancelled booking." A verified credential
        with a date approaching is the ONLY place this portal warns about
        something the API has not called a blocker — and it is arithmetic on a
        published date, not a guess about what Yuvoy will do.

        And never simply "Verified" over a document we hold no file for
        (yuvoy-operator#93): the review read "Verified" and "No file sent" on
        one row with no way to act on either. The expiry still leads when both
        are true, because it is the one that takes a listing down on a date.
      */
      if (expiring) return { tone: "warn", text: expiring };
      return verifiedWithoutFile(credential)
        ? {
            tone: "warn",
            text: "Verified, but we hold no file for it",
            saysNoFile: true,
          }
        : { tone: "ok", text: "Verified" };
    case "pending":
      return { tone: "warn", text: "With Yuvoy, not checked yet" };
    case "rejected":
      return {
        tone: "problem",
        text: "Not accepted. We will have told you why.",
      };
    case "expired":
      return { tone: "problem", text: "Expired" };
    default:
      return {
        tone: "warn",
        text: credential.state
          ? stateLabel(credential.state)
          : "Status unknown",
      };
  }
}

/**
 * Sixty days: when this portal starts warning, and when the API starts taking
 * a replacement.
 *
 * Two rules that happen to be one number, kept as one constant so they cannot
 * drift apart. yuvoy-api accepts a renewal inside the same window
 * (`RenewalWindow`, 60 × 24h, `operator_credential_submit.go`); before it,
 * `POST /credentials` refuses a new copy of a verified document, because "a new
 * row would only put a LIVE operator back behind an unverified document". If
 * the API's window moves, the warning and the Replace beside it move with it.
 */
export const RENEWAL_DAYS = 60;

/** How near an expiry is, or null when it is not worth a sentence yet. */
export function expiryWarning(
  credential: OperatorCredential,
  now: number,
): string | null {
  if (!credential.expiresOn) return null;
  const days = daysUntilMarketDate(credential.expiresOn, now);
  if (days === null) return null;
  if (days < 0) return "Expired";
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  // Sixty days is a season's notice on an island where paperwork travels by
  // ferry. Sooner than that is not a warning, it is a surprise.
  if (days <= RENEWAL_DAYS) return `Expires in ${days} days`;
  return null;
}

/**
 * The sentence an expiring document earns — yuvoy-operator#46, verbatim.
 *
 * "Public liability insurance expires 30 Nov 2026. Listings that need it come
 * down that day." Word for word, because "an operator who thinks an expiring
 * document is a paperwork nag rather than a scheduled loss of sales will not
 * act on it."
 *
 * Only for a VERIFIED document dated inside the renewal window. An expired one
 * already says so, louder; a pending or rejected one is not what is keeping
 * the listings up today.
 */
export function expirySentence(
  credential: OperatorCredential,
  now: number,
): string | null {
  if (credential.state !== "verified" || !credential.expiresOn) return null;
  const days = daysUntilMarketDate(credential.expiresOn, now);
  if (days === null || days < 0 || days > RENEWAL_DAYS) return null;
  return `${credentialName(credential)} expires ${marketDateLabel(credential.expiresOn)}. Listings that need it come down that day.`;
}

/**
 * Where to send a replacement, when the API will take one — yuvoy-operator#46.
 *
 * A current verified document gets no action at all: `POST /credentials`
 * refuses it until the renewal window opens, and a button that ends in a
 * refusal is worse than no button.
 */
export function replaceAction(
  credential: OperatorCredential,
  now: number,
): { href: string; label: string } | null {
  switch (credential.state) {
    case "rejected":
    case "expired":
      return { href: "/profile#documents", label: "Send a new one" };
    case "pending":
      // Filing again replaces the pending copy rather than stacking beside it.
      return { href: "/profile#documents", label: "Replace it" };
    case "verified": {
      if (!credential.expiresOn) return null;
      const days = daysUntilMarketDate(credential.expiresOn, now);
      return days !== null && days <= RENEWAL_DAYS
        ? { href: "/profile#documents", label: "Replace it" }
        : null;
    }
    default:
      return null;
  }
}

/**
 * The credentials as the documents they are: rows grouped by type, in the
 * order the list has them.
 *
 * `credentials` is the whole HISTORY, ordered by type rather than by date — an
 * operator who renewed holds last year's certificate beside this year's — so
 * anything that decides what to DO about a document has to look at every row
 * of its type, never one row alone.
 */
export function byDocumentType(
  credentials: readonly OperatorCredential[],
): Map<string, OperatorCredential[]> {
  const groups = new Map<string, OperatorCredential[]>();
  for (const credential of credentials) {
    const type = credential.type?.trim() ?? "";
    groups.set(type, [...(groups.get(type) ?? []), credential]);
  }
  return groups;
}

/**
 * The row that decides a document type: the verified one lasting longest.
 *
 * The API decides eligibility on the best satisfying row per type — `order by
 * expires_on desc nulls first limit 1` — and this is that ordering: no expiry
 * beats any date, and a later date beats an earlier one. Reading rows one at a
 * time is how a superseded certificate once told a compliant, selling operator
 * that their insurance had expired.
 */
function bestVerified(
  rows: readonly OperatorCredential[],
): OperatorCredential | null {
  let best: OperatorCredential | null = null;
  for (const row of rows) {
    if (row.state !== "verified") continue;
    if (!best) {
      best = row;
    } else if (
      best.expiresOn &&
      (!row.expiresOn || row.expiresOn > best.expiresOn)
    ) {
      best = row;
    }
  }
  return best;
}

/**
 * Every expiry sentence the documents earn, one per document type, from the
 * type's best verified row — a certificate that has already been renewed is
 * not about to take anything down.
 */
export function expirySentences(
  credentials: readonly OperatorCredential[],
  now: number,
): string[] {
  const out: string[] = [];
  for (const rows of byDocumentType(credentials).values()) {
    const best = bestVerified(rows);
    const line = best ? expirySentence(best, now) : null;
    if (line) out.push(line);
  }
  return out;
}

/** A held document inside its renewal window, as Home's card says it. */
export interface ExpiringDocument {
  /** "Insurance". */
  name: string;
  /** Whole market days left: 0 is today. */
  days: number;
  /** `expirySentence`, word for word (yuvoy-operator#46). */
  sentence: string;
  /** Where its replacement is sent, when the API will take one now. */
  action: { href: string; label: string } | null;
}

/**
 * The documents about to take listings down, soonest first.
 *
 * The same rows `expirySentences` reads, one per type from its best verified
 * copy, so Home and Verification name the same documents (audit 5.7: an
 * expiry used to reach nowhere but Verification). An expired one is not
 * here: it is already a blocker, and Home leads with it.
 */
export function expiringDocuments(
  credentials: readonly OperatorCredential[],
  now: number,
): ExpiringDocument[] {
  const out: ExpiringDocument[] = [];
  for (const rows of byDocumentType(credentials).values()) {
    const best = bestVerified(rows);
    const sentence = best ? expirySentence(best, now) : null;
    const days =
      best?.expiresOn !== undefined
        ? daysUntilMarketDate(best.expiresOn, now)
        : null;
    if (!best || !sentence || days === null) continue;
    out.push({
      name: credentialName(best),
      days,
      sentence,
      action: documentAction(rows, now),
    });
  }
  return out.sort((a, b) => a.days - b.days);
}

/**
 * What to do about one document type, as the API will accept it.
 *
 * Decided for the TYPE, for the reason `bestVerified` gives: a "Send a new
 * one" under last year's rejected copy of a certificate that has since been
 * verified would send a document the API refuses.
 */
export function documentAction(
  rows: readonly OperatorCredential[],
  now: number,
): { href: string; label: string } | null {
  const best = bestVerified(rows);
  if (best) {
    // Held: a Replace only once the renewal window is open.
    if (!best.expiresOn) return null;
    const days = daysUntilMarketDate(best.expiresOn, now);
    if (days === null || days > RENEWAL_DAYS) return null;
    if (days >= 0) return replaceAction(best, now);
    // Its date has passed, so nothing current is held — fall through.
  }
  const pending = rows.find((r) => r.state === "pending");
  if (pending) return replaceAction(pending, now);
  const refusedOrLapsed = rows.find(
    (r) => r.state === "rejected" || r.state === "expired",
  );
  if (refusedOrLapsed) return replaceAction(refusedOrLapsed, now);
  // A verified row past its date whose state has not caught up yet.
  return best ? { href: "/profile#documents", label: "Send a new one" } : null;
}

/** `directorate_registration` → `Directorate registration`. */
export function credentialName(credential: OperatorCredential): string {
  const type = credential.type?.trim();
  return type ? stateLabel(type) : "Document";
}
