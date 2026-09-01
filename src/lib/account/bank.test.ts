import { describe, it, expect } from "vitest";
import {
  bankProblem,
  describeChange,
  isOpen,
  maskAccount,
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
