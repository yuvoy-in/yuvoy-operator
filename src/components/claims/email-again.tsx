"use client";

import { useState } from "react";
import { EmailSteps } from "./email-steps";
import { Button } from "@/components/ui/button";
import { PROOF_OPTIONS } from "@/lib/claims/words";

/** The email option's title, offered again on a waiting email claim. */
const EMAIL_AGAIN =
  PROOF_OPTIONS.find((o) => o.method === "email_domain")?.title ??
  "Get a code at your business email";

/**
 * A waiting `email_domain` claim that still needs its code, on the claims
 * list (yuvoy-operator#388, the phone's `ClaimRowView`): the option's title
 * as a button, and the two email steps once it is tapped. Closed at first, so
 * a list of claims is not a list of forms.
 */
export function EmailAgain({
  claimId,
  websiteHost,
}: {
  claimId: string;
  websiteHost: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div data-testid={`claim-row-email-${claimId}`}>
        <EmailSteps claimId={claimId} websiteHost={websiteHost} />
      </div>
    );
  }
  return (
    <Button
      variant="secondary"
      className="mt-4"
      onClick={() => setOpen(true)}
      data-testid={`claim-row-email-open-${claimId}`}
    >
      {EMAIL_AGAIN}
    </Button>
  );
}
