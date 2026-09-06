import type { Blocker, OperatorCredential } from "@/lib/account/standing";

/**
 * Sending Yuvoy a document we asked for — O6's second half.
 *
 * `POST /credentials` is the endpoint that made this screen possible: "until
 * it existed the screen named a blocker and then asked them to ring us."
 *
 * ## Nothing filed here is ever verified, and the screen must not imply it is
 *
 * "The state is fixed server-side and the operator is taken from the session,
 * so neither verifying your own document nor filing one against another
 * operator is expressible in a request. Verification is somebody at Yuvoy
 * looking at the document, and a self-service path to `verified` would make
 * the credential gate decorative."
 *
 * So every success state here says *sent*, never *done*. An operator who files
 * an insurance certificate and reads "verified" will plan a season on it.
 */

/**
 * The document kinds the API accepts, in the operator's words.
 *
 * A closed enum on the request body, so the picker is generated from it. The
 * labels are deliberately concrete — "Oxygen" alone is not a document anybody
 * recognises holding, and the point of this list is that somebody can look at
 * a folder and find the right piece of paper.
 */
export const CREDENTIAL_TYPES = [
  {
    value: "directorate_registration",
    label: "Directorate registration",
    hint: "Your registration with the Directorate of Tourism.",
  },
  {
    value: "instructor_cert",
    label: "Instructor certificate",
    hint: "For whoever leads the dive or the activity.",
  },
  {
    value: "oxygen",
    label: "Oxygen certificate",
    hint: "The emergency oxygen kit and its service record.",
  },
  {
    value: "equipment",
    label: "Equipment inspection",
    hint: "The last service or inspection on the gear you use.",
  },
  { value: "boat", label: "Boat papers", hint: "Registration and survey." },
  {
    value: "insurance",
    label: "Insurance",
    hint: "Public liability, and marine cover if you run a boat.",
  },
  {
    value: "bank",
    label: "Bank proof",
    hint: "A cancelled cheque or a bank letter, so payouts reach you.",
  },
  {
    value: "gst",
    label: "GST certificate",
    hint: "Only if you are registered.",
  },
] as const;

export type CredentialType = (typeof CREDENTIAL_TYPES)[number]["value"];

export function isCredentialType(v: string): v is CredentialType {
  return CREDENTIAL_TYPES.some((c) => c.value === v);
}

export function credentialTypeLabel(value: string | undefined): string {
  return (
    CREDENTIAL_TYPES.find((c) => c.value === value)?.label ??
    value ??
    "Document"
  );
}

/**
 * Which document to offer first, read off what the account is actually
 * blocked on.
 *
 * The blockers name the rule (`CREDENTIAL_MISSING`, `CREDENTIAL_EXPIRED`) but
 * not the document, so the type comes from `credentials` — the rows in a state
 * that needs the operator to act. Pending and verified do not: one is with us,
 * and the other is done.
 *
 * Returns `null` rather than guessing when nothing is outstanding. A form that
 * preselects a document nobody asked for invites an operator to file a
 * duplicate, and "sending the same kind twice replaces the earlier pending one"
 * — so a stray upload quietly discards a document that was already in the
 * queue.
 */
export function suggestedCredentialType(
  credentials: readonly OperatorCredential[],
): CredentialType | null {
  const needsThem = credentials.filter(
    (c) => c.state === "expired" || c.state === "rejected",
  );
  const first = needsThem.find((c) => c.mandatory) ?? needsThem[0];
  const type = first?.type;
  return type && isCredentialType(type) ? type : null;
}

/**
 * Whether anything on the account is waiting on the OPERATOR specifically.
 *
 * `waitingOn` is "the field that stops the phone call" — "pending because we
 * are slow and pending because they have sent nothing read identically". The
 * form leads with this, so somebody who is waiting on us is not invited to
 * send another copy of what we already hold.
 */
export function waitingOnOperator(blocking: readonly Blocker[]): Blocker[] {
  return blocking.filter((b) => b.waitingOn === "operator");
}

/**
 * An expiry date, checked only for the mistake that actually happens.
 *
 * A date already in the past is almost always a typo in the year — and filing
 * one replaces a pending document with an expired one, which is strictly worse
 * than not filing at all. Everything else about the date is the reviewer's to
 * judge.
 *
 * Compared as calendar dates, never as instants: "a licence expires on a day,
 * and sending a timestamp invites a timezone bug on the one field an operator
 * plans a season around."
 */
export function expiryIssue(value: string, today: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Use the date picker.";
  return v < today ? "That date has already passed. Check the year." : null;
}
