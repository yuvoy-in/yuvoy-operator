/**
 * The bank change, and the reason it is slow on purpose.
 *
 * "A stolen operator login plus one convincing phone call is otherwise enough
 * to redirect a season's takings."
 *
 * Three gates, and the UI's job is to explain them rather than apologise for
 * them: OWNER only, a code to the owner's phone, then two 24-hour clocks — one
 * before approval so the real owner can stop it, one after, so even an
 * approved change is still catchable.
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
      return {
        title: "Raised: you can still stop this",
        body: "We messaged the owner the moment it was raised. Nobody at Yuvoy has looked at it yet, and it becomes reviewable in 24 hours.",
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
