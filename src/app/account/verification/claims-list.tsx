import { EmailAgain } from "@/components/claims/email-again";
import { ProofCode } from "@/components/claims/proof-code";
import { ReadAgain } from "@/components/claims/read-again";
import { Panel } from "@/components/ui/panel";
import { Problem } from "@/components/ui/states";
import { operatorApi } from "@/lib/api/server-client";
import { claimRows, type ClaimLike } from "@/lib/claims/claims";
import { CLAIMS_HEADING, EMAIL_CHECKED_LINE } from "@/lib/claims/words";

/** What `GET /listing-claims` gave: the claims, or a read that failed. */
export type ClaimsRead =
  { ok: true; items: readonly ClaimLike[] } | { ok: false };

/**
 * This business's listing claims (yuvoy-operator#388). Read with the page,
 * so a decision made since the last visit shows on the next one: no push is
 * sent for it. A failed read is said with Try again, never an empty list.
 */
export async function readClaims(token: string): Promise<ClaimsRead> {
  try {
    const { data, error } = await operatorApi(token).GET("/listing-claims", {});
    if (error) throw error;
    return { ok: true, items: data?.items ?? [] };
  } catch {
    return { ok: false };
  }
}

/**
 * The claims list on Verification (yuvoy-operator#388, the phone's
 * `ClaimsSection`): drawn once there is at least one claim, newest first,
 * each with the listing's name and where it stands. A waiting
 * `public_page_code` claim shows its code again; a waiting `email_domain`
 * claim still needing its code offers the email steps to an OWNER or ADMIN
 * (`canAct`), and MANAGER and STAFF read the list only.
 */
export function ClaimsList({
  read,
  canAct,
}: {
  read: ClaimsRead;
  canAct: boolean;
}) {
  if (!read.ok) {
    return (
      <section className="mt-10" data-testid="claims-error">
        <h2 className="text-lg font-bold">{CLAIMS_HEADING}</h2>
        <div className="mt-3">
          <Problem
            title="That did not load"
            body="We could not read your listing claims just now."
          />
          <ReadAgain />
        </div>
      </section>
    );
  }
  if (read.items.length === 0) return null;

  return (
    <section className="mt-10 flex flex-col gap-3" data-testid="claims">
      <h2 className="text-lg font-bold">{CLAIMS_HEADING}</h2>
      {claimRows(read.items, canAct).map((row) => (
        <Panel key={row.id} data-testid={`claim-row-${row.id}`}>
          <p
            className="text-base font-bold break-words"
            data-testid={`claim-row-name-${row.id}`}
          >
            {row.name}
          </p>
          <p
            className="text-forest/80 leading-body mt-2 text-sm text-pretty"
            data-testid={`claim-row-state-${row.id}`}
          >
            {row.state}
          </p>
          {row.code ? (
            <div className="mt-2" data-testid={`claim-row-code-${row.id}`}>
              <ProofCode code={row.code} small />
            </div>
          ) : null}
          {row.emailChecked ? (
            <p
              className="leading-body mt-2 text-sm text-pretty"
              data-testid={`claim-row-checked-${row.id}`}
            >
              {EMAIL_CHECKED_LINE}
            </p>
          ) : null}
          {row.offerEmail ? (
            <EmailAgain claimId={row.id} websiteHost={row.websiteHost} />
          ) : null}
        </Panel>
      ))}
    </section>
  );
}
