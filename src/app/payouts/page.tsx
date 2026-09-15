import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { getChangeRequests } from "@/lib/money/fetch";
import { isOpen, type ChangeState } from "@/lib/account/bank";
import { ChangePanel } from "./change-panel";
import { canManageAccess } from "@/lib/team/access";
import { BankForm } from "./bank-form";
import { Screen } from "@/components/chrome/screen";
import { Panel } from "@/components/ui/panel";

export const metadata: Metadata = { title: "Payout details" };

/*
  Never prerendered, never cached. A stale view of a bank change in flight is
  the one thing this screen must never show — the whole point is that the
  operator can see it and stop it.
*/
export const dynamic = "force-dynamic";

/**
 * O4 — where the money goes.
 *
 * The highest-risk thing an operator can do, so it is deliberately slow. The
 * screen's job is to **explain that rather than apologise for it**: an
 * operator who understands why it takes 48 hours does not phone us on hour
 * two, and one who does not, does.
 *
 * "A stolen operator login plus one convincing phone call is otherwise enough
 * to redirect a season's takings."
 */
export default async function PayoutsPage() {
  const { token, me } = await requireOperator();
  const requests = await getChangeRequests(token);

  const bank = requests.filter((r) => r.kind === "bank");
  const inFlight = bank.filter((r) => isOpen((r.state ?? "") as ChangeState));
  const history = bank.filter((r) => !isOpen((r.state ?? "") as ChangeState));

  /*
    TWO permissions, not one — and they are deliberately different sets.

    Raising a bank change is OWNER only. Stopping one is OWNER **or ADMIN**,
    because stopping is the safety action and an admin exists for an owner who
    is off the island. One flag used to serve both, which denied an admin
    something the server allows; `pnpm qa` reads both rules out of the contract
    and now says so.
  */
  /*
    Raising a bank change is refused while suspended and stopping one is not
    (yuvoy-operator#50): the money already in flight can still be redirected
    back, and no new destination can be proposed.
  */
  const canRaise = me.roles.includes("OWNER") && !me.suspension;
  // Stopping a bank change is allowed while suspended; raising one is not
  // (yuvoy-operator#50).
  const canStop = canManageAccess(me.roles);

  return (
    <Screen
      nav={{ back: { href: "/account/settings", label: "settings" } }}
      stageLabel="Payout details"
    >
      <p className="eyebrow text-terra-deep">Your account</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Payout details
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        Changing where the money goes takes two days on purpose. Here is exactly
        what happens, and how to stop it.
      </p>

      {/* In flight first: it is the thing that can still be acted on. */}
      {inFlight.length > 0 ? (
        <section className="mt-8" aria-labelledby="in-flight">
          <h2 id="in-flight" className="label text-forest/75">
            In progress
          </h2>
          <div className="mt-3 space-y-3">
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
        </section>
      ) : null}

      <section className="mt-10" aria-labelledby="change">
        <h2 id="change" className="label text-forest/75">
          {inFlight.length > 0
            ? "Change it again"
            : "Change where the money goes"}
        </h2>

        {inFlight.length > 0 ? (
          /*
            One at a time. "Two open bank changes would mean the second
            approval silently decides which account wins." Saying so beats
            letting somebody fill in a form and meet a 409.
          */
          <p className="text-forest/80 mt-3 text-sm">
            There is already a change in progress. Stop it above before raising
            another. Two at once would mean whichever is approved last silently
            wins.
          </p>
        ) : (
          <div className="mt-4">
            <BankForm canRaise={canRaise} />
          </div>
        )}
      </section>

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
                  <span className="font-mono">{r.summary}</span>
                  <span className="text-forest/70">{r.state}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      ) : null}
    </Screen>
  );
}
