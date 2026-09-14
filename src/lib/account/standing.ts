import type { components } from "@/lib/api/schema.gen";
import { daysUntilMarketDate, marketDateLabel } from "@/lib/format/market-time";

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

/**
 * Where an operator goes to clear a blocker — yuvoy-operator#33.
 *
 * The Business screen listed everything stopping a business from selling and
 * gave no way to fix any of it: every blocker was a sentence with no button,
 * and the only route forward was to ring us and have somebody do it from the
 * admin console. That is the concierge path the self-serve portal exists to
 * remove.
 *
 * The codes are a closed set — `BUSINESS_DETAILS_INCOMPLETE`, `LOGO_MISSING`,
 * `CREDENTIAL_MISSING`, `CREDENTIAL_UNVERIFIED`, `CREDENTIAL_EXPIRED`,
 * `CREDENTIAL_REJECTED`, `AWAITING_REVIEW`, `OTHER` — but this returns `null`
 * for anything it does not recognise rather than guessing a destination. A
 * link to the wrong screen is worse than no link: it costs a tap, a page load
 * and the operator's confidence that the portal knows what it is talking
 * about, and `OTHER` exists precisely so a reason can be added operationally
 * without a contract change.
 *
 * `AWAITING_REVIEW` deliberately has no destination either. It is waiting on
 * us, and a button under it would invite somebody to send a second copy of
 * what we already hold.
 */
export function blockerAction(
  blocker: Blocker,
): { href: string; label: string } | null {
  switch (blocker.code) {
    case "BUSINESS_DETAILS_INCOMPLETE":
      return { href: "/profile", label: "Complete your details" };
    case "LOGO_MISSING":
      return { href: "/logo", label: "Add your logo" };
    case "CREDENTIAL_MISSING":
    case "CREDENTIAL_EXPIRED":
      return { href: "/profile#documents", label: "Send us the document" };
    case "CREDENTIAL_REJECTED":
      /*
        A rejected document needs a REPLACEMENT, and the wording says so —
        "send another" rather than "send it", because the operator has already
        sent one and being told to do the same thing again reads as the portal
        not having noticed.

        What this must NOT do is promise a reason. `operator_credentials`
        records a free-text note from whoever reviewed it and **no endpoint
        returns it**; the operator's own credential view carries type, state,
        issuer and expiry and nothing else. So the screen hands over a phone
        number rather than paraphrasing a note nobody can read.
      */
      return { href: "/profile#documents", label: "Send another" };
    default:
      return null;
  }
}

/**
 * Whether this blocker actually stops a sale — or `null` when it will not say.
 *
 * `gates` is REQUIRED on the contract (yuvoy-api#139), and this still refuses
 * to guess when it is not a boolean. An older deployment or a partial row
 * must not be turned into a claim in either direction: "this is not stopping
 * sales" is the sentence that makes an operator ignore something, and "this
 * is stopping sales" is the sentence that made them stop promoting a business
 * that was selling fine. Unknown is a third answer and the screen has one.
 *
 * Same rule as `bookable` on the account: absent means unknown, never fine.
 */
export function gatesSale(blocker: Blocker): boolean | null {
  return typeof blocker.gates === "boolean" ? blocker.gates : null;
}

/**
 * Outstanding items, with the ones costing money first — yuvoy-operator#38.
 *
 * `gates` separates "checkout would refuse this" from "we are still owed
 * this". An operator scanning the list at 6am on a jetty should meet the
 * paperwork that is stopping sales before the logo upload, and a row that
 * will not say which it is sits between the two rather than being sorted as
 * though it were harmless.
 *
 * Stable within each rank, so the API's own ordering survives.
 */
export function byGatingFirst(blocking: readonly Blocker[]): Blocker[] {
  const rank = (b: Blocker) => {
    const gates = gatesSale(b);
    return gates === true ? 0 : gates === null ? 1 : 2;
  };
  return [...blocking].sort((a, b) => rank(a) - rank(b));
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

/**
 * The one sentence at the top of the screen.
 *
 * Derived from `bookable` and the shape of `blocking` — never from `state`.
 * The empty-blocking case is the one worth naming: an account that cannot sell
 * and has nothing outstanding is not "all done", it is Yuvoy holding it, and
 * saying "nothing outstanding" to somebody who cannot trade reads as a fault
 * in us. The API avoids it by sending `AWAITING_REVIEW`; this covers the case
 * where it does not.
 *
 * ## The third state — yuvoy-operator#38
 *
 * `bookable` used to go false for ANY outstanding item, so "live" and "has
 * something outstanding" could not both be true and two sentences covered
 * every account. yuvoy-api#139 made `bookable` false only when something
 * actually stops a sale, which is right — a LIVE operator with three listings
 * selling was being told "you cannot be booked yet" over a missing logo, and
 * an operator who believes they are shut stops promoting, stops adding dates
 * and stops answering requests while travellers are already buying.
 *
 * That created a third state, and it is the common one: **live, and still
 * owing us something.** An operator needs both halves — that they are open
 * for business, and that we are still waiting on something — and a headline
 * that says only the first hides the list below it.
 */
export function headline(standing: Standing): { title: string; body: string } {
  if (standing.bookable) {
    const outstanding = standing.blocking.length;
    if (outstanding === 0) {
      return {
        title: "Your account is live",
        body: "Travellers can book your departures.",
      };
    }

    /*
      "These are not blocking you" is only true if nothing in the list says
      otherwise. `bookable: true` with a gating row is a response that
      contradicts itself, and the reassuring half of that sentence is the one
      that must not be said on a guess — so the claim is made from the rows,
      not from `bookable`.
    */
    const anyGating = standing.blocking.some((b) => gatesSale(b) === true);
    return {
      title:
        outstanding === 1
          ? "Your account is live: one thing is still outstanding"
          : `Your account is live: ${outstanding} things are still outstanding`,
      body: anyGating
        ? "Travellers can book your departures. Some of what is below may still be holding a listing back."
        : "Travellers can book your departures. These are not blocking you, but we still need them.",
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

/* ------------------------------------------- a suspended business (#50) -- */

export type Suspension = components["schemas"]["AccountStanding"]["suspension"];

/**
 * A business that is suspended, closed or disqualified.
 *
 * `account.suspension` is "present exactly while the business is suspended
 * (D20), or while its status is `OFFBOARDED` or `DISQUALIFIED` (D44), and
 * absent otherwise". So presence IS the state, and nothing here derives it
 * from `state`, which the module comment above already refuses to branch on.
 *
 * ## It is not the same thing as `account_not_active`
 *
 * It used to be. `GET /me` answered `403 account_not_active` for a suspended
 * business, so the portal had one idea covering two situations. The contract
 * now separates them: "a suspended business is not refused here, and nor is
 * one whose status is `OFFBOARDED` or `DISQUALIFIED`: each signs in, and its
 * writes answer `account_suspended` instead." `account_not_active` is left
 * meaning only an offboarded ACCOUNT, which cannot sign in at all.
 *
 * The difference matters on screen. A suspended operator can still sign in,
 * still read everything, and still run the trips already booked. Sending them
 * to a dead end would strand travellers who have paid.
 *
 * `message` is required by the contract, so a block without one is not a
 * suspension this build can render: an empty banner is worse than none,
 * because it reads as a fault in the portal rather than a state of the
 * business.
 */
export function suspensionOf(
  account: AccountStanding | undefined,
): NonNullable<Suspension> | null {
  const block = account?.suspension;
  if (!block || typeof block.message !== "string" || !block.message.trim()) {
    return null;
  }
  return block;
}

/**
 * The writes a suspended business may still make.
 *
 * Named by endpoint rather than by screen, because that is how the API decides
 * it and a screen-shaped list would drift the first time a button moved. The
 * shape of it: everything can still be read, the trips already booked can
 * still be run or stopped, and the team, a bank change and documents can still
 * be dealt with. Everything that would take NEW money or put new inventory on
 * sale is refused.
 *
 * `POST /bookings/{id}/cancel` and `POST /requests/{id}/decline` are on the
 * list and their opposites are not, which is the whole principle: a suspended
 * business can always let a traveller go, and can never take one on.
 */
export const WRITES_ALLOWED_WHILE_SUSPENDED = [
  "POST /bookings/{id}/attendance",
  "POST /bookings/{id}/cash-collected",
  "POST /bookings/{id}/cash-returned",
  "POST /bookings/{id}/relay",
  "POST /slots/{id}/relay",
  "POST /bookings/{id}/messages",
  "POST /bookings/{id}/messages/read",
  "POST /slots/{id}/call-off",
  "POST /bookings/{id}/cancel",
  "POST /requests/{id}/decline",
  "POST /team/{id}/hold",
  "POST /team/{id}/restore",
  "DELETE /team/{id}",
  "POST /change-requests/{id}/cancel",
  "POST /credentials",
  "POST /credentials/{id}/upload-intents",
  "POST /credentials/{id}/upload-intents/{intentId}/complete",
  "DELETE /auth/session",
] as const;
