/**
 * The bank change, and the reason it is slow on purpose.
 *
 * "A stolen operator login plus one convincing phone call is otherwise enough
 * to redirect a season's takings."
 *
 * Three gates, and the UI's job is to explain them rather than apologise for
 * them: OWNER only, a code to an owner (by email since yuvoy-api 67e3213, as
 * there is no phone sender), then two 24-hour clocks: one before approval so
 * the real owner can stop it, one after, so even an approved change is still
 * catchable.
 */

export type ChangeState =
  | "objection_window"
  | "pending"
  | "cooling"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "applied";

/** Where a request sits, in the operator's words rather than the schema's. */
export function describeChange(state: ChangeState): {
  title: string;
  body: string;
  /** Whether the operator can still stop it. */
  stoppable: boolean;
} {
  switch (state) {
    case "objection_window":
      /*
        It said "We messaged the owner the moment it was raised", and nobody
        was messaged. The warning that a bank change was raised is PHONE ONLY
        in yuvoy-api (`NoticeBankChangeRaised`, `phoneOnly`): an email would
        land in the inbox open on a stolen phone, read by the one person it
        exists to warn about. With no phone sender it is suppressed, so the
        owner hears nothing (yuvoy-operator#91). This screen is where they can
        see it and stop it, so that is what it says.
      */
      return {
        title: "Raised: you can still stop this",
        body: "An owner or an admin can stop it from this screen. Nobody at Yuvoy has looked at it yet, and it becomes reviewable in 24 hours.",
        stoppable: true,
      };
    case "pending":
      return {
        title: "Awaiting review by a person at Yuvoy",
        body: "The objection window closed without anybody stopping it. That did not approve it. A person still has to.",
        stoppable: true,
      };
    case "cooling":
      return {
        title: "Approved, not yet live: still stoppable",
        body: "A person approved it. It goes live 24 hours after that, and until it does you can still stop it.",
        stoppable: true,
      };
    case "approved":
      return {
        title: "Approved",
        body: "It is on its way to going live.",
        stoppable: true,
      };
    case "applied":
      return {
        title: "Live",
        body: "Payouts go to this account now.",
        stoppable: false,
      };
    case "rejected":
      return {
        title: "Rejected",
        body: "We did not make this change. If you were expecting it to go through, message us.",
        stoppable: false,
      };
    case "withdrawn":
      return {
        title: "Stopped",
        body: "This change was cancelled and nothing was altered.",
        stoppable: false,
      };
  }
}

/** A change still moving through the gates. Only one may exist at a time. */
export function isOpen(state: ChangeState): boolean {
  return ["objection_window", "pending", "cooling", "approved"].includes(state);
}

/* ------------------------------------------------ what is on file (op#87) -- */

/**
 * The account payouts go to, as the change requests show it, or `null` when
 * no bank change has ever gone live from this portal.
 *
 * yuvoy-operator#87 s14: "The form arrives half filled: IFSC shows
 * HDFC0001234, the account number is empty ... A half-filled form leaves an
 * operator unsure whether their details are saved." The screen now shows what
 * is on file as text, with one Change button.
 *
 * ## Where "on file" comes from
 *
 * No endpoint reads the payout account. What the API does keep is every bank
 * change, and one that is `applied` is the account payouts went to from then
 * on (`applied`: "live"). So the newest applied bank change IS what is on file,
 * sorted here rather than trusted to arrive newest first, because a screen
 * that shows last year's account as current is the one this exists to fix.
 *
 * An account set up by hand before any change was made from here has no row,
 * and this answers `null` for it: the screen then shows the form, as it does
 * for a new business, and claims nothing either way.
 */
export interface OnFile {
  /** The change request that put it there, so the history can leave it out. */
  id: string | null;
  /** "HDFC0001234 · account ending 4412", or the summary as the API wrote it. */
  line: string;
  /** "HDFC Bank", when the summary named one. */
  bankName: string | null;
}

interface BankRow {
  id?: string;
  kind?: string;
  state?: string;
  summary?: string;
  requestedAt?: string;
}

export function accountOnFile(requests: readonly BankRow[]): OnFile | null {
  const newest = requests
    .filter((r) => r.kind === "bank" && r.state === "applied")
    .sort((a, b) => instant(b.requestedAt) - instant(a.requestedAt))[0];
  const summary = newest?.summary?.trim() ?? "";
  if (!newest || !summary) return null;

  const { ifsc, last4, bankName } = parseBankSummary(summary);
  return {
    id: newest.id ?? null,
    line:
      ifsc && last4
        ? `${ifsc} · account ending ${last4}`
        : /*
            A shape this build does not recognise, shown as the API wrote it:
            "Masked. Never a full account number." A made-up reading of an
            account somebody is paid into is worse than the API's own words.
          */
          summary,
    bankName: ifsc && last4 ? bankName : null,
  };
}

/**
 * The parts of a masked bank summary.
 *
 * The API writes `HDFC Bank ····4412 (HDFC0001234)`, or `····4412
 * (HDFC0001234)` with no bank name (yuvoy-api `BankChange.Summary`); the mock
 * has written `HDFC Bank ••••4417 · HDFC0001234`. Both are read: the IFSC by
 * its own shape (four letters, a zero, six more), the last four as the digits
 * after the mask, and the bank as whatever comes before the mask. A bare
 * "Bank" is the mock's stand-in for no name, and says nothing.
 */
export function parseBankSummary(summary: string): {
  ifsc: string | null;
  last4: string | null;
  bankName: string | null;
} {
  const ifsc = /\b([A-Za-z]{4}0[A-Za-z0-9]{6})\b/.exec(summary)?.[1];
  const masked = /([·•*xX]{2,})\s*(\d{4})\b/.exec(summary);
  const before = masked ? summary.slice(0, masked.index).trim() : "";
  const bankName = before && !/^bank$/i.test(before) ? before : null;
  return {
    ifsc: ifsc ? ifsc.toUpperCase() : null,
    last4: masked ? masked[2] : null,
    bankName,
  };
}

/**
 * A decided change, in the history under what is on file.
 *
 * The one on file is left out of that list, so an `applied` row there is an
 * account that was live once and has since been replaced: "Live" would say it
 * still is. The raw state was printed here before ("withdrawn"), which is a
 * database word on a phone.
 */
export function historyLabel(state: ChangeState): string {
  switch (state) {
    case "applied":
      return "Replaced";
    case "withdrawn":
      return "Stopped";
    case "rejected":
      return "Rejected";
    case "objection_window":
    case "pending":
    case "cooling":
    case "approved":
      return describeChange(state).title;
    default:
      /*
        A state this build has never heard of (the enum can grow). Shown in
        plain words rather than guessed at, and never allowed to throw: the
        history is read-only, and one odd row must not take the screen down.
      */
      return String(state).replace(/_/g, " ");
  }
}

/** Milliseconds, or 0 for a missing or unreadable time (sorts it last). */
function instant(iso: string | null | undefined): number {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

export interface BankInput {
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
}

export interface BankProblem {
  field: keyof BankInput;
  message: string;
}

/**
 * Checked before the round trip, with the same rules the API applies.
 *
 * An operator typing bank details on a phone with a bad keyboard should not
 * discover a typo after a code, an SMS to the owner and a 24-hour clock have
 * all been spent on it.
 */
export function bankProblem(input: BankInput): BankProblem | null {
  if (input.accountHolder.trim().length < 2) {
    return { field: "accountHolder", message: "Whose name is on the account?" };
  }

  const account = input.accountNumber.replace(/\s/g, "");
  if (!/^\d{9,18}$/.test(account)) {
    return {
      field: "accountNumber",
      message: "An Indian account number is 9 to 18 digits, and no letters.",
    };
  }

  /*
    IFSC is four letters, a zero, then six alphanumerics. The fifth character
    is a reserved zero and is the one people get wrong, because it sits in the
    middle of a bank's name and reads as a letter O.
  */
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(input.ifsc.trim().toUpperCase())) {
    return {
      field: "ifsc",
      message:
        "An IFSC looks like HDFC0001234: four letters, then a zero, then six more. The fifth character is always a zero, never a letter O.",
    };
  }

  return null;
}

/**
 * What will actually be stored, so the form can show it before sending.
 *
 * Only the last four digits are kept. Nothing in this service pays anybody —
 * the payout run does not read from here — so holding the full number would be
 * a liability with no matching capability.
 */
export function maskAccount(accountNumber: string): string {
  return `••••${accountNumber.replace(/\D/g, "").slice(-4)}`;
}
