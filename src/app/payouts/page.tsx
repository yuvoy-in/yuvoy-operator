import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import { readChangeRequests } from "@/lib/money/fetch";
import { BANK_CHANGE } from "@/lib/account/change-kind";
import {
  accountOnFile,
  historyLabel,
  isOpen,
  type ChangeState,
} from "@/lib/account/bank";
import { canManageAccess } from "@/lib/team/access";
import { helpHref } from "@/lib/help";
import { ChangePanel } from "./change-panel";
import { PayoutDetails } from "./payout-details";
import { Screen } from "@/components/chrome/screen";
import { Panel } from "@/components/ui/panel";
import { Problem } from "@/components/ui/states";

export const metadata: Metadata = { title: "Payout details" };

/*
  Never prerendered, never cached. A stale view of a bank change in flight is
  the one thing this screen must never show — the whole point is that the
  operator can see it and stop it.
*/
export const dynamic = "force-dynamic";

/* Payout details sit behind the Money tab (yuvoy-operator#96). */
const BACK = { href: "/earnings", label: "Money" };

/**
 * O4 — where the money goes.
 *
 * The highest-risk thing an operator can do, so it is deliberately slow.
 * "A stolen operator login plus one convincing phone call is otherwise enough
 * to redirect a season's takings."
 *
 * ## What is on file comes first, as text (yuvoy-operator#87 s14)
 *
 * "The form arrives half filled ... A half-filled form leaves an operator
 * unsure whether their details are saved." The account payouts go to is the
 * newest bank change that went live (`accountOnFile`), shown as a fact with
 * one Change button; the form is drawn only after Change, empty. A business
 * with nothing on file gets the form straight away.
 *
 * A change in flight is above it, because it is the thing that can still be
 * acted on. Why the whole design is slow is an answer in Help rather than a
 * paragraph at the top of every visit (op#80 t4).
 */
export default async function PayoutsPage() {
  const { token, me } = await requireOperator();
  const requests = await readChangeRequests(token);

  /*
    A list that did not load is not an empty one. Drawn as empty it would put
    the form in front of an owner whose account, and whose change in flight,
    simply did not arrive, with no brake on the screen.
  */
  if (requests === null) {
    return (
      <Screen nav={{ back: BACK }}>
        <h1 className="font-display tracking-display text-4xl leading-[1.05]">
          Payout details
        </h1>
        <div className="mt-6">
          <Problem
            title="Your payout details did not load"
            body="Nothing has changed. Try again in a moment."
          />
        </div>
      </Screen>
    );
  }

  /*
    `bank_account`, the kind the API writes. It said `bank` from O4 until
    23 Sep 2026, which matched nothing in production: no change in flight was
    ever shown here, so its Stop could not be pressed. See `change-kind.ts`.
  */
  const bank = requests.filter((r) => r.kind === BANK_CHANGE);
  const inFlight = bank.filter((r) => isOpen((r.state ?? "") as ChangeState));
  const onFile = accountOnFile(bank);
  // Decided changes, less the one that is on file: it is shown above.
  const history = bank.filter(
    (r) =>
      !isOpen((r.state ?? "") as ChangeState) &&
      !(onFile?.id && r.id === onFile.id),
  );

  /*
    TWO permissions, not one — and they are deliberately different sets.

    Raising a bank change is OWNER only. Stopping one is OWNER **or ADMIN**,
    because stopping is the safety action and an admin exists for an owner who
    is off the island. One flag used to serve both, which denied an admin
    something the server allows; `pnpm qa` reads both rules out of the contract
    and now says so.
  */
  const isOwner = me.roles.includes("OWNER");
  // Stopping a bank change is allowed while suspended; raising one is not
  // (yuvoy-operator#50).
  const canStop = canManageAccess(me.roles);

  /*
    Why this person cannot raise a change right now, said in place of the
    Change button rather than after a refusal: who they are first, then the
    state of the business, then the change already open ("two open bank
    changes would mean the second approval silently decides which account
    wins").
  */
  const refusal = !isOwner
    ? "Only the owner can change where the money goes."
    : me.suspension
      ? "While the account is suspended, where the money goes cannot be changed. You can still stop a change in progress."
      : inFlight.length > 0
        ? "There is already a change in progress. Stop it above before raising another. Two at once would mean whichever is approved last silently wins."
        : null;

  return (
    <Screen nav={{ back: BACK }}>
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Payout details
      </h1>

      {/* In flight first: it is the thing that can still be acted on. */}
      {inFlight.length > 0 ? (
        <div className="mt-6 space-y-3">
          {inFlight.map((r) => (
            <ChangePanel
              key={r.id}
              id={r.id ?? ""}
              state={(r.state ?? "pending") as ChangeState}
              summary={r.summary}
              objectionUntil={r.objectionUntil}
              coolingUntil={r.coolingUntil}
              requestedAt={r.requestedAt}
              canStop={canStop}
            />
          ))}
        </div>
      ) : null}

      <PayoutDetails onFile={onFile} refusal={refusal} />

      {history.length > 0 ? (
        <section className="mt-10" aria-labelledby="history">
          <h2 id="history" className="label text-forest/75">
            Previously
          </h2>
          <Panel className="mt-3 p-0">
            <ul className="divide-paper-line divide-y">
              {history.map((r) => (
                <li
                  key={r.id}
                  className="flex items-baseline justify-between gap-4 px-5 py-3 text-sm"
                >
                  <span className="min-w-0 font-mono wrap-break-word">
                    {r.summary}
                  </span>
                  <span className="text-forest/70 shrink-0">
                    {historyLabel((r.state ?? "") as ChangeState)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      ) : null}

      <Link
        href={helpHref("bank-change-two-days")}
        className="text-forest/80 hover:text-forest mt-8 inline-flex min-h-11 items-center self-start text-sm underline underline-offset-4"
      >
        Why a change takes two days
      </Link>
    </Screen>
  );
}
