import { describe, it, expect } from "vitest";
import {
  accountOnFile,
  bankProblem,
  describeChange,
  historyLabel,
  isOpen,
  maskAccount,
  parseBankSummary,
  type ChangeState,
} from "./bank";

const good = {
  accountHolder: "Nemo Reef Divers",
  accountNumber: "50100123456789",
  ifsc: "HDFC0001234",
  bankName: "HDFC Bank",
};

/**
 * The bank change is the highest-risk thing an operator can do. These are the
 * checks that stop a typo costing a code, an SMS to the owner and a 24-hour
 * clock before anybody finds out.
 */
describe("bankProblem", () => {
  it("accepts a well-formed Indian account", () => {
    expect(bankProblem(good)).toBeNull();
    // 9 and 18 digits are both inside the range.
    expect(bankProblem({ ...good, accountNumber: "123456789" })).toBeNull();
    expect(bankProblem({ ...good, accountNumber: "1".repeat(18) })).toBeNull();
  });

  it("refuses an account number that is not 9 to 18 digits", () => {
    expect(bankProblem({ ...good, accountNumber: "12345678" })?.field).toBe(
      "accountNumber",
    );
    expect(bankProblem({ ...good, accountNumber: "1".repeat(19) })?.field).toBe(
      "accountNumber",
    );
    // Letters are the common paste error — an IBAN, or a number with a prefix.
    expect(bankProblem({ ...good, accountNumber: "GB29NWBK6016" })?.field).toBe(
      "accountNumber",
    );
  });

  it("tolerates spaces in an account number, because people type them", () => {
    expect(
      bankProblem({ ...good, accountNumber: "5010 0123 456789" }),
    ).toBeNull();
  });

  it("holds the IFSC to its real shape, including the reserved zero", () => {
    /*
      Four letters, a zero, then six. The fifth character is the one people get
      wrong: it is a reserved zero sitting in the middle of a bank's name, and
      it reads as a letter O.
    */
    expect(bankProblem({ ...good, ifsc: "HDFCO001234" })?.field).toBe("ifsc");
    expect(bankProblem({ ...good, ifsc: "HDFC1001234" })?.field).toBe("ifsc");
    expect(bankProblem({ ...good, ifsc: "HDF0001234" })?.field).toBe("ifsc");
    // And the message has to name the trap, not just refuse.
    expect(bankProblem({ ...good, ifsc: "HDFCO001234" })?.message).toMatch(
      /never a letter O/,
    );
  });

  it("accepts a lowercase IFSC, since a phone keyboard offers it", () => {
    expect(bankProblem({ ...good, ifsc: "hdfc0001234" })).toBeNull();
  });

  it("wants a name on the account", () => {
    expect(bankProblem({ ...good, accountHolder: " " })?.field).toBe(
      "accountHolder",
    );
  });
});

describe("maskAccount", () => {
  it("keeps only the last four digits, which is all that is stored", () => {
    expect(maskAccount("50100123456789")).toBe("••••6789");
    expect(maskAccount("5010 0123 456789")).toBe("••••6789");
  });
});

describe("describeChange", () => {
  it("says a change is stoppable at every stage before it is live", () => {
    // "A cooling change nobody can stop is just a slower mistake."
    for (const s of ["objection_window", "pending", "cooling", "approved"]) {
      expect(describeChange(s as ChangeState).stoppable, s).toBe(true);
      expect(isOpen(s as ChangeState), s).toBe(true);
    }
  });

  it("says it is not stoppable once it is decided", () => {
    for (const s of ["applied", "rejected", "withdrawn"]) {
      expect(describeChange(s as ChangeState).stoppable, s).toBe(false);
      expect(isOpen(s as ChangeState), s).toBe(false);
    }
  });

  it("never says the objection window approved anything", () => {
    /*
      "An objection window closing with nobody objecting does not approve
      anything; it moves the request into a human review queue. Auto-approving
      on silence would make the whole design a delay rather than a control."
    */
    const pending = describeChange("pending");
    expect(pending.body).toMatch(/did not approve it/i);
    expect(pending.body).toMatch(/person still has to/i);
  });

  it("has copy for every state, and it is a sentence", () => {
    const all: ChangeState[] = [
      "objection_window",
      "pending",
      "cooling",
      "approved",
      "applied",
      "rejected",
      "withdrawn",
    ];
    for (const s of all) {
      const d = describeChange(s);
      expect(d.title.length, s).toBeGreaterThan(2);
      expect(d.body, s).toMatch(/\.$/);
    }
  });
});

/*
  What is on file, as text (yuvoy-operator#87 s14): "Show what is on file as
  text ('HDFC0001234 · account ending 4412'), with one Change button." No
  endpoint reads the payout account; the newest APPLIED bank change is it.
*/
describe("the account on file", () => {
  const applied = (
    id: string,
    requestedAt: string,
    summary = "HDFC Bank ····4412 (HDFC0001234)",
  ) => ({ id, kind: "bank", state: "applied", summary, requestedAt });

  it("reads the API's own summary as the IFSC and the last four", () => {
    expect(accountOnFile([applied("chg_a", "2026-08-01T09:00:00Z")])).toEqual({
      id: "chg_a",
      line: "HDFC0001234 · account ending 4412",
      bankName: "HDFC Bank",
    });
  });

  it("is the newest applied change, whatever order the list came in", () => {
    const onFile = accountOnFile([
      applied("older", "2026-05-01T09:00:00Z", "SBI ····1111 (SBIN0000123)"),
      applied("newer", "2026-08-01T09:00:00Z"),
    ]);
    expect(onFile?.id).toBe("newer");
  });

  it("ignores a change that is not live, and one that is not a bank change", () => {
    /*
      A change in flight is not on file: payouts do not go to it until it is
      applied. A logo or details change files in the same table (kind "logo",
      "profile") and says nothing about where the money goes.
    */
    expect(
      accountOnFile([
        { ...applied("flight", "2026-09-01T09:00:00Z"), state: "cooling" },
        { ...applied("stopped", "2026-09-02T09:00:00Z"), state: "withdrawn" },
        { ...applied("logo", "2026-09-03T09:00:00Z"), kind: "logo" },
      ]),
    ).toBeNull();
  });

  it("is nothing for a business that never changed its account here", () => {
    expect(accountOnFile([])).toBeNull();
    // An applied row with no summary has nothing to show either.
    expect(
      accountOnFile([applied("blank", "2026-08-01T09:00:00Z", "  ")]),
    ).toBeNull();
  });

  it("shows a summary it cannot read as the API wrote it, never a guess", () => {
    const onFile = accountOnFile([
      applied("odd", "2026-08-01T09:00:00Z", "Account ending in four-four"),
    ]);
    expect(onFile?.line).toBe("Account ending in four-four");
    expect(onFile?.bankName).toBeNull();
  });
});

describe("reading a masked summary", () => {
  it("reads the API's shape, with and without a bank name", () => {
    expect(parseBankSummary("HDFC Bank ····4412 (HDFC0001234)")).toEqual({
      ifsc: "HDFC0001234",
      last4: "4412",
      bankName: "HDFC Bank",
    });
    expect(parseBankSummary("····4412 (HDFC0001234)")).toEqual({
      ifsc: "HDFC0001234",
      last4: "4412",
      bankName: null,
    });
  });

  it("reads the shape the portal's own mock writes", () => {
    expect(parseBankSummary("HDFC Bank ••••4417 · HDFC0001234")).toEqual({
      ifsc: "HDFC0001234",
      last4: "4417",
      bankName: "HDFC Bank",
    });
    // "Bank" is the stand-in for no name, and says nothing.
    expect(parseBankSummary("Bank ••••6789 · HDFC0001234").bankName).toBeNull();
  });

  it("never takes the IFSC's own digits for the account's", () => {
    // HDFC0001234 ends in four digits; only digits after a mask are the account.
    expect(parseBankSummary("(HDFC0001234)").last4).toBeNull();
  });
});

describe("a decided change, in the history", () => {
  it("says a replaced account was replaced, not live", () => {
    // The one on file is left out of the history, so an applied row there is
    // an account that has since been replaced.
    expect(historyLabel("applied")).toBe("Replaced");
    expect(historyLabel("withdrawn")).toBe("Stopped");
    expect(historyLabel("rejected")).toBe("Rejected");
  });

  it("says an unknown state in plain words rather than throwing", () => {
    expect(historyLabel("reversed_by_bank" as ChangeState)).toBe(
      "reversed by bank",
    );
  });
});
