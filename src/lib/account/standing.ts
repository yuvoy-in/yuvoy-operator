import type { components } from "@/lib/api/schema.gen";
import { daysUntilMarketDate } from "@/lib/format/market-time";

/**
 * Why this operator can or cannot sell, and who has to move next.
 *
 * `AccountStanding` landed on `GET /me` on 5 Sep 2026 (yuvoy-api#63 → PR #83)
 * and it is the data O3 was shipped without. Before it, `/account` said
 * "your account is live" to anybody whose `/me` returned 200 — which after
 * self-signup (`POST /auth/signup`, D-029) is the WRONG sentence for the most
 * common operator there is: one who has an account, can sign in, and cannot
 * sell a thing.
 *
 * ## The two fields that decide everything on the screen
 *
 * **`bookable` is the branchable one.** It is a boolean and the contract
 * defines it exactly: "whether a traveller can book them right now. `LIVE` is
 * the only status that means yes; everything else, `PAUSED` included, is a no
 * with a different reason."
 *
 * **`state` is NOT branchable and must never be.** It is a bare string in the
 * contract with no enum — and the values already disagree with the examples
 * beside them: the schema shows `ONBOARDING`, `LIVE`, `PAUSED` while the API's
 * own worked example returns `PROSPECT`. A client that branched on it would
 * have been wrong on the first account it ever saw. So it is displayed, never
 * interpreted, and it is displayed only as a label beside a sentence that was
 * derived from `bookable`.
 *
 * ## Absent is unknown, never fine
 *
 * The contract says it in the field description: "Absent means unknown — never
 * 'everything is fine'." An older deployment, a rolled-back API or a partial
 * response must not read as approval. `standingOf` returns `null` and the
 * screen says it cannot tell — which is a worse screen and a true one.
 */

export type AccountStanding = components["schemas"]["AccountStanding"];
export type Blocker = components["schemas"]["Blocker"];
export type OperatorCredential = components["schemas"]["OperatorCredential"];

/** Who has to move next. Two values, and branching is its whole purpose. */
export type WaitingOn = "operator" | "yuvoy";

export interface Standing {
  /** Displayed, never branched on. See the module comment. */
  state: string;
  bookable: boolean;
  blocking: Blocker[];
  credentials: OperatorCredential[];
}

/**
 * The account block on `GET /me`, narrowed — or `null` when it is absent or
 * unusable.
 *
 * `bookable` is required in the contract, so a response missing it is not an
 * `AccountStanding` this build can reason about. Treating a missing boolean as
 * `false` would tell a live operator they cannot sell; treating it as `true`
 * would be the lie this whole module exists to remove. Neither: it is unknown.
 */
export function standingOf(
  account: AccountStanding | undefined,
): Standing | null {
  if (!account || typeof account.bookable !== "boolean") return null;
  return {
    state: typeof account.state === "string" ? account.state : "",
    bookable: account.bookable,
    blocking: Array.isArray(account.blocking) ? account.blocking : [],
    credentials: Array.isArray(account.credentials) ? account.credentials : [],
  };
}

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
 * One blocker, as a line somebody can act on.
 *
 * **`label` is rendered for every code, recognised or not.** That is not
 * defensive coding, it is the contract's condition for its own escape hatch:
 * "`OTHER` exists so a reason can be added operationally without a contract
 * change and without breaking a client: render `label` for anything you do not
 * recognise, including `OTHER`." A client that switched on `code` and fell
 * through to nothing would turn every new operational reason into an invisible
 * blocker — an operator stuck with a blank screen and no idea why.
 */
export function blockerText(blocker: Blocker): string {
  const label = blocker.label?.trim();
  if (label) return label;
  /*
    A blocker with no label at all. It should not happen — `label` is required
    — but a blank row is the one outcome that must not reach a screen: it reads
    as a bug rather than as something outstanding. The code is shown instead,
    made readable, so the operator has something to quote on the phone.
  */
  const code = blocker.code?.trim();
  return code
    ? stateLabel(code)
    : "Something is outstanding, and we have not said what.";
}

/** Blockers this operator has to act on, and the ones sitting with Yuvoy. */
export function splitByWaitingOn(blocking: readonly Blocker[]): {
  operator: Blocker[];
  yuvoy: Blocker[];
} {
  return {
    /*
      `waitingOn` is a closed enum of exactly two values and it is required, so
      anything else is a response this build does not understand. It falls to
      `yuvoy` deliberately: the failure of telling an operator to act when
      nothing is theirs to do is a phone call, and the failure of the reverse
      is an operator waiting all season for a document only they can send.
    */
    operator: blocking.filter((b) => b.waitingOn === "operator"),
    yuvoy: blocking.filter((b) => b.waitingOn !== "operator"),
  };
}

/**
 * What a credential is doing, in the words the row needs.
 *
 * `state` is a closed enum here (`pending`, `verified`, `rejected`, `expired`)
 * — unlike the account's own `state` — so it is safe to branch on. An unknown
 * value still falls through to the raw string rather than to silence.
 */
export function credentialText(
  credential: OperatorCredential,
  now: number,
): { tone: "ok" | "warn" | "problem"; text: string } {
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
      */
      return expiring
        ? { tone: "warn", text: expiring }
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
  if (days <= 60) return `Expires in ${days} days`;
  return null;
}

/** `directorate_registration` → `Directorate registration`. */
export function credentialName(credential: OperatorCredential): string {
  const type = credential.type?.trim();
  return type ? stateLabel(type) : "Document";
}

/**
 * The one sentence at the top of the screen.
 *
 * Derived from `bookable` and the shape of `blocking` — never from `state`.
 * The empty-blocking case is the one worth naming: an account that cannot sell
 * and has nothing outstanding is not "all done", it is Yuvoy holding it, and
 * saying "nothing outstanding" to somebody who cannot trade reads as a fault
 * in us. The API avoids it by sending `AWAITING_REVIEW`; this covers the case
 * where it does not.
 */
export function headline(standing: Standing): { title: string; body: string } {
  if (standing.bookable) {
    return {
      title: "Your account is live",
      body: "Travellers can book your departures.",
    };
  }

  const { operator } = splitByWaitingOn(standing.blocking);
  if (operator.length > 0) {
    return {
      title: "You cannot be booked yet",
      body:
        operator.length === 1
          ? "One thing is waiting on you. It is below."
          : `${operator.length} things are waiting on you. They are below.`,
    };
  }

  return {
    title: "You cannot be booked yet",
    body: "Nothing is waiting on you. It is with us, and you do not need to chase it.",
  };
}
