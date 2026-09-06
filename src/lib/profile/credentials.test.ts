import { describe, expect, it } from "vitest";
import {
  credentialTypeLabel,
  expiryIssue,
  isCredentialType,
  suggestedCredentialType,
  waitingOnOperator,
} from "./credentials";
import type { Blocker, OperatorCredential } from "@/lib/account/standing";

const cred = (over: Partial<OperatorCredential>): OperatorCredential => ({
  type: "insurance",
  state: "pending",
  mandatory: true,
  ...over,
});

describe("which document to offer first", () => {
  it("picks one the operator actually has to act on", () => {
    const suggested = suggestedCredentialType([
      cred({ type: "boat", state: "verified" }),
      cred({ type: "insurance", state: "expired" }),
    ]);
    expect(suggested).toBe("insurance");
  });

  it("prefers a mandatory one, because that is what stops sales", () => {
    const suggested = suggestedCredentialType([
      cred({ type: "gst", state: "rejected", mandatory: false }),
      cred({ type: "insurance", state: "rejected", mandatory: true }),
    ]);
    expect(suggested).toBe("insurance");
  });

  it("suggests nothing when everything is pending or verified", () => {
    /*
      A form that preselects a document nobody asked for invites a duplicate —
      and "sending the same kind twice replaces the earlier pending one", so a
      stray upload quietly discards something already in the queue.
    */
    expect(
      suggestedCredentialType([
        cred({ type: "insurance", state: "pending" }),
        cred({ type: "boat", state: "verified" }),
      ]),
    ).toBeNull();
    expect(suggestedCredentialType([])).toBeNull();
  });

  it("suggests nothing for a kind this build does not know", () => {
    // Rather than putting an unknown string into a select that cannot show it.
    expect(
      suggestedCredentialType([
        cred({ type: "drone_permit", state: "expired" }),
      ]),
    ).toBeNull();
  });
});

describe("who has to move next", () => {
  const blockers: Blocker[] = [
    {
      code: "CREDENTIAL_MISSING",
      label: "We need your insurance",
      waitingOn: "operator",
    },
    {
      code: "AWAITING_REVIEW",
      label: "A person is checking it",
      waitingOn: "yuvoy",
    },
  ];

  it("keeps only what the operator can act on", () => {
    /*
      "The field that stops the phone call." Somebody waiting on US must not be
      invited to send another copy of what we already hold.
    */
    expect(waitingOnOperator(blockers).map((b) => b.code)).toEqual([
      "CREDENTIAL_MISSING",
    ]);
  });

  it("is empty rather than everything when nothing is theirs", () => {
    expect(waitingOnOperator([blockers[1]])).toEqual([]);
  });
});

describe("document kinds", () => {
  it("accepts only what the contract enumerates", () => {
    expect(isCredentialType("directorate_registration")).toBe(true);
    expect(isCredentialType("passport")).toBe(false);
  });

  it("labels a kind it does not know as itself, claiming nothing", () => {
    expect(credentialTypeLabel("insurance")).toBe("Insurance");
    expect(credentialTypeLabel("drone_permit")).toBe("drone_permit");
    expect(credentialTypeLabel(undefined)).toBe("Document");
  });
});

describe("the expiry date", () => {
  const today = "2026-09-07";

  it("accepts a future date, and blank", () => {
    expect(expiryIssue("2027-03-01", today)).toBeNull();
    expect(expiryIssue("", today)).toBeNull();
  });

  it("catches the mistake that actually happens — a year typed wrong", () => {
    /*
      Filing an already-expired document REPLACES the pending one, so the typo
      costs a document that was already in the queue. Worse than not filing.
    */
    expect(expiryIssue("2025-03-01", today)).toMatch(/already passed/);
  });

  it("accepts today itself", () => {
    // Expiring today is not expired. The API evaluates at the departure's
    // start instant, and this portal must not be stricter than the server.
    expect(expiryIssue(today, today)).toBeNull();
  });

  it("compares as calendar dates, never as instants", () => {
    /*
      "A licence expires on a day, and sending a timestamp invites a timezone
      bug on the one field an operator plans a season around." String
      comparison on ISO dates has no zone to get wrong.
    */
    expect(expiryIssue("2026-09-08", "2026-09-07")).toBeNull();
    expect(expiryIssue("2026-09-06", "2026-09-07")).toMatch(/already passed/);
  });

  it("refuses something that is not a date at all", () => {
    expect(expiryIssue("next March", today)).toMatch(/date picker/);
  });
});
