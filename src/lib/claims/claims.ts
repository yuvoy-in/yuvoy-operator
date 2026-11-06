import type { components } from "@/lib/api/schema.gen";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { StalledError } from "@/lib/api/deadline";
import { suspendedMessage } from "@/lib/account/suspended";
import { sentence } from "@/lib/format/sentence";
import { REMOVED_LISTING, STALLED_LEAD } from "./words";

/**
 * The rules of a listing claim (yuvoy-operator#388): who may claim, what a
 * claim's state says, what comes after "Ask to claim", the rows of the claims
 * list on Verification, and what each refusal means. The phone's rules from
 * yuvoy-mobile#388, read against this portal's error classes.
 *
 * Every refusal is shown in the API's own sentence (through `sentence()` for
 * the capital and the stop). The screens branch on the status, `error.code`
 * and `details`, never on the text.
 */

export type ListingClaim = components["schemas"]["ListingClaim"];
export type ClaimPreview = components["schemas"]["ListingClaimPreview"];

/** The fields of a `ListingClaim` these rules read. */
export type ClaimLike = Pick<
  ListingClaim,
  | "claimId"
  | "subjectName"
  | "state"
  | "decisionCode"
  | "proofMethod"
  | "proofCode"
  | "proofEmailVerifiedAt"
  | "websiteHost"
  | "createdAt"
>;

/** For MANAGER and STAFF, in place of the proof options. */
export function claimRoleLine(business: string | null | undefined): string {
  const who = business?.trim() ? business.trim() : "your business";
  return `Only an owner or admin of ${who} can claim a listing. Send them this link.`;
}

/** "Your address at {host}", the email step's field. */
export function emailFieldLabel(host: string | null | undefined): string {
  return host?.trim()
    ? `Your address at ${host.trim()}`
    : "Your address at the listing's website";
}

/** A removed listing's row is deleted, so its claim names nobody. */
export function claimSubjectName(
  claim: Pick<ClaimLike, "subjectName">,
): string {
  return claim.subjectName.trim() ? claim.subjectName : REMOVED_LISTING;
}

const REFUSALS: Record<string, string> = {
  PROOF_NOT_CONFIRMED:
    "we could not confirm your proof. You can claim again another way.",
  NOT_THE_BUSINESS: "this listing looks like a different business.",
  DUPLICATE: "this listing is already covered by another claim or account.",
};

/** Where a claim stands, in the business's words. */
export function claimStateLine(
  claim: Pick<ClaimLike, "state" | "decisionCode">,
): string {
  switch (claim.state) {
    case "waiting":
      return "Waiting for us to check";
    case "approved":
      return "Approved";
    case "refused": {
      const reason = claim.decisionCode
        ? REFUSALS[claim.decisionCode]
        : undefined;
      return reason ? `Not approved: ${reason}` : "Not approved";
    }
    case "withdrawn":
      return "Closed: this listing was removed while we were checking. Nothing more to do.";
    default:
      return "";
  }
}

/** What the business sees once its claim is made (the `201`), by the proof it chose. */
export type ClaimOutcome =
  | { kind: "code"; heading: string; code: string; body: string }
  | { kind: "email" }
  | { kind: "wait"; body: string };

export function claimOutcome(
  claim: Pick<ClaimLike, "proofMethod" | "proofCode">,
): ClaimOutcome {
  switch (claim.proofMethod) {
    case "email_domain":
      return { kind: "email" };
    case "public_page_code": {
      const code = claim.proofCode ?? "";
      return {
        kind: "code",
        heading: "Post this code on your page",
        code,
        body: `Put ${code} on your website or your business's social media page, exactly as it is, and leave it there until we decide. You can find it again under Verification.`,
      };
    }
    case "call_to_published_number":
      return {
        kind: "wait",
        body: "We will call the number on your public page. Nothing more to do here.",
      };
    default:
      return {
        kind: "wait",
        body: "We will get in touch to ask for your papers. Nothing more to do here.",
      };
  }
}

/** One row of the claims list on Verification. */
export interface ClaimRow {
  id: string;
  name: string;
  state: string;
  /** A waiting `public_page_code` claim shows its code again, so it can be found later. */
  code: string | null;
  /** A waiting `email_domain` claim whose code has been checked. */
  emailChecked: boolean;
  /** A waiting `email_domain` claim still needs its code, and this login may send one. */
  offerEmail: boolean;
  websiteHost: string | null;
}

export function claimRows(
  claims: readonly ClaimLike[],
  canAct: boolean,
): ClaimRow[] {
  return newestFirst(claims).map((c) => {
    const waiting = c.state === "waiting";
    const email = waiting && c.proofMethod === "email_domain";
    return {
      id: c.claimId,
      name: claimSubjectName(c),
      state: claimStateLine(c),
      code:
        waiting && c.proofMethod === "public_page_code" ? c.proofCode : null,
      emailChecked: email && c.proofEmailVerifiedAt !== null,
      offerEmail: email && c.proofEmailVerifiedAt === null && canAct,
      websiteHost: c.websiteHost,
    };
  });
}

/** The API sends them newest first; held to it here, ties kept as sent. */
function newestFirst(claims: readonly ClaimLike[]): ClaimLike[] {
  return claims
    .map((c, i) => ({ c, i, at: Date.parse(c.createdAt) }))
    .sort((a, b) => (b.at || 0) - (a.at || 0) || a.i - b.i)
    .map((x) => x.c);
}

/** The path a claim link opens, and whether a path is one. */
export function claimPath(slug: string): string {
  return `/claim/${encodeURIComponent(slug)}`;
}

export function isClaimPath(path: string | null | undefined): boolean {
  return (
    typeof path === "string" && /^\/claim\/[^/?#]+\/?(?:[?#].*)?$/.test(path)
  );
}

/* ------------------------------------------------------------ refusals -- */

export type ClaimStep = "create" | "send" | "check";

export interface ClaimFailure {
  message: string;
  /** `400 invalid_input` with `details.proofMethod` `no_website`: grey the email option. */
  noWebsite: boolean;
  /** `409 conflict` `not_waiting`: the claim was decided or withdrawn, so read the list again. */
  readAgain: boolean;
}

const STALL_CHECK: Record<ClaimStep, string> = {
  create: "Look under Verification to see whether your claim is there.",
  send: "If no code comes, send another.",
  check: "Check the code again.",
};

const OFFLINE: Record<ClaimStep, string> = {
  create: "No signal. Nothing was sent: ask again when you have one.",
  send: "No signal. No code was sent: send it again when you have one.",
  check:
    "No signal. The code was not checked: check it again when you have one.",
};

/** A request from the browser that never came back: the phone lost its signal. */
export function claimUnsent(step: ClaimStep): ClaimFailure {
  return { message: OFFLINE[step], noWebsite: false, readAgain: false };
}

function detail(details: unknown, key: string): unknown {
  return details && typeof details === "object"
    ? (details as Record<string, unknown>)[key]
    : undefined;
}

/**
 * A refused claim, code or code check: the API's sentence, and what the
 * screen does next.
 *
 * Read in this order. A write that went quiet (`StalledError` under the
 * network error) may have gone through, so it never says nothing was sent,
 * and it is asked before the plain network failure, which it also is. A
 * suspension comes before the API's other sentences because it is a `403`
 * like the role refusal, and the role sentence is the wrong one.
 */
export function claimFailure(e: unknown, step: ClaimStep): ClaimFailure {
  const plain = (message: string): ClaimFailure => ({
    message,
    noWebsite: false,
    readAgain: false,
  });
  if (e instanceof OperatorNetworkError) {
    return e.cause instanceof StalledError
      ? plain(`${STALLED_LEAD} ${STALL_CHECK[step]}`)
      : claimUnsent(step);
  }
  const suspended = suspendedMessage(e);
  if (suspended) return plain(suspended);
  if (!(e instanceof OperatorApiError)) {
    return plain("That did not work. Try again.");
  }
  const said = sentence(e.message);
  if (e.status < 400 || !said) return plain("That did not work. Try again.");
  return {
    message: said,
    noWebsite:
      e.status === 400 && detail(e.details, "proofMethod") === "no_website",
    readAgain:
      e.status === 409 &&
      e.code === "conflict" &&
      detail(e.details, "reason") === "not_waiting",
  };
}
