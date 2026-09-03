/**
 * The rights statement, and the hash that proves what was on the screen.
 *
 * `POST /media/{id}/rights` wants `statementSha256` — "the hash of the
 * statement **as it was rendered to the operator**" — and the contract says
 * why in the same breath: "sending only a version number would mean that
 * editing the wording without bumping the version silently turns every prior
 * attestation into a claim about words nobody saw."
 *
 * So the text lives here, as one exported constant, and the hash is computed
 * from that exact string at the moment of submitting. Not from a paraphrase,
 * not from the JSX, not from a copy in a CMS. If somebody edits a word below
 * without touching `STATEMENT_VERSION`, every attestation after that point
 * hashes differently from every one before it — which is the audit trail
 * working, not a bug.
 *
 * **Settled with the backend, 2 Sep 2026 (yuvoy-api#66): the wording is the
 * client's.** The API holds no copy and validates against none —
 * `statementSha256` is evidence of what was rendered, not a checksum the
 * server compares. Two rules follow, and both are in the contract's own
 * description now as well as here:
 *
 *   - `STATEMENT_VERSION` is a **shared integer** even though the text is
 *     ours. Change a word, bump it. A new version invalidates every prior
 *     attestation and forces re-attestation, and that only works if the
 *     number moves.
 *   - **A published version's digest never changes.** `rights.test.ts` keeps
 *     a ledger of version → digest: editing the wording without a bump fails
 *     there, and rewriting an old row is visible as a diff to a line that
 *     says it must never be edited.
 */

export const STATEMENT_VERSION = 1;

/**
 * The exact bytes that are hashed. Rendered verbatim, never reflowed.
 *
 * Written to be read by somebody standing on a boat, which is why it is short
 * and why every clause is a thing they can actually check. A statement nobody
 * reads is a signature nobody meant.
 */
export const RIGHTS_STATEMENT = [
  "I confirm this footage is ours to give Yuvoy.",
  "",
  "I filmed it myself, or I have written permission from whoever did.",
  "It contains no music, logo or footage taken from somewhere else.",
  "Everybody recognisable in it knew they were being filmed and agreed to it being used.",
  "",
  "Yuvoy may show this clip to travellers, and may stop showing it at any time.",
  "I can ask for it to be taken down whenever I want.",
].join("\n");

export const RIGHTS_TYPES = [
  {
    code: "owned",
    label: "We filmed it",
    detail: "Somebody at this business shot it.",
  },
  {
    code: "licensed",
    label: "We paid for it",
    detail: "A videographer or agency shot it and we hold the licence.",
  },
  {
    code: "operator_granted",
    label: "Somebody gave us permission",
    detail: "A guest or a partner filmed it and said we could use it.",
  },
] as const;

export type RightsType = (typeof RIGHTS_TYPES)[number]["code"];

export function isRightsType(v: string): v is RightsType {
  return RIGHTS_TYPES.some((r) => r.code === v);
}

/**
 * SHA-256 of a string, lower-case hex — the shape the contract's pattern
 * demands (`^[a-f0-9]{64}$`).
 *
 * `crypto.subtle` is present on both sides of this app: the browser (secure
 * context) and Node's webcrypto. It is deliberately computed on the CLIENT,
 * from the string the client rendered, because a hash computed on the server
 * would be a hash of what the server *believes* was rendered — which is the
 * exact substitution the field exists to prevent.
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A field-level problem, checked before a round trip. */
export interface RightsProblem {
  field: string;
  message: string;
}

export interface RightsInput {
  rightsType: string;
  /** Tri-state on purpose — see below. */
  peopleConsentConfirmed: boolean | null;
  thirdPartyRef?: string;
  licenceRef?: string;
  filmedOn?: string;
  filmedAtLocation?: string;
}

export function rightsProblem(input: RightsInput): RightsProblem | null {
  if (!isRightsType(input.rightsType)) {
    return {
      field: "rightsType",
      message: "Say where this footage came from.",
    };
  }

  /*
    `null` is not `false`, and the difference is the whole point.

    "`peopleConsentConfirmed` must be an explicit `true` or `false`, never
    defaulted and never omitted: consent of the people filmed is the one thing
    a moderator cannot check by watching." A checkbox defaults to unticked,
    which is an answer nobody gave — so this is two radio buttons and no
    preselection, and an unanswered form is refused here rather than sent as a
    quiet "no".
  */
  if (input.peopleConsentConfirmed === null) {
    return {
      field: "peopleConsentConfirmed",
      message:
        "Answer the question about the people in the clip. There is no default — a moderator cannot tell by watching.",
    };
  }

  if (input.rightsType === "licensed" && !input.licenceRef?.trim()) {
    return {
      field: "licenceRef",
      message:
        "Which licence? An invoice number or the agency's name is enough.",
    };
  }

  if (input.rightsType === "operator_granted" && !input.thirdPartyRef?.trim()) {
    return {
      field: "thirdPartyRef",
      message: "Who gave you permission? A name is enough.",
    };
  }

  if (input.filmedOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.filmedOn)) {
    return { field: "filmedOn", message: "Use a date like 2026-08-14." };
  }

  return null;
}

/* -------------------------------------------------------------- withdraw -- */

/**
 * Why a clip is coming down. A closed set, and the counts are the point.
 *
 * "The reason is a closed set because the counts matter —
 * `people_in_it_objected` arriving repeatedly for one operator is a consent
 * problem in how they film, not a series of unrelated takedowns."
 *
 * So the labels are written to be chosen honestly rather than to be the
 * quickest way out of a dialog. `people_in_it_objected` in particular is
 * phrased as the thing that actually happened, because an operator picking
 * "just take it down" for it is the operator whose filming nobody ever
 * corrects.
 */
export const WITHDRAW_REASONS = [
  {
    code: "operator_request",
    label: "We just want it down",
    detail: "No particular reason, or we would rather show something else.",
  },
  {
    code: "people_in_it_objected",
    label: "Somebody in it objected",
    detail: "A guest or crew member asked not to be shown.",
  },
  {
    code: "no_longer_accurate",
    label: "It is out of date",
    detail: "The boat, the site or the trip is no longer what this shows.",
  },
  {
    code: "rights_lapsed",
    label: "We no longer have the rights",
    detail: "A licence ended, or permission was withdrawn.",
  },
] as const;

export type WithdrawReason = (typeof WITHDRAW_REASONS)[number]["code"];

export function isWithdrawReason(v: string): v is WithdrawReason {
  return WITHDRAW_REASONS.some((r) => r.code === v);
}
