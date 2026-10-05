import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import { getCommissionStatements } from "@/lib/money/fetch";
import { statementsOwing, totalOwed } from "@/lib/money/commission-statements";
import { formatPaise } from "@/lib/format/money";
import { helpHref } from "@/lib/help";
import { Empty, Problem } from "@/components/ui/states";
import { Screen } from "@/components/chrome/screen";
import { Panel } from "@/components/ui/panel";
import { StatementRow } from "../statement-row";

export const metadata: Metadata = { title: "Commission statements" };

/* A bill that can be paid while it is open must never be served from a cache. */
export const dynamic = "force-dynamic";

const BACK = { href: "/earnings", label: "Money" };

/**
 * Every weekly commission statement, newest first (yuvoy-operator#121).
 *
 * A traveller who pays at the counter pays the business, so the business
 * holds Yuvoy's share of it. Since D-043 that share is billed weekly: a
 * statement for each Monday to Sunday week with cash trips in it, issued from
 * the Tuesday after. The Money tab shows the ones still to pay and the newest
 * settled; this is all of them, with what is owed across them at the top.
 *
 * Read-only. Paying happens in the operator's own UPI app, from a statement's
 * page, and Yuvoy's staff record a payment once it arrives.
 */
export default async function CommissionStatementsPage() {
  const { token, me } = await requireOperator();

  /*
    Refused before the request, like every money screen: both statement reads
    "Require OWNER, ADMIN or MANAGER", and a staff login meeting the 403 would
    land on an error boundary saying "try again" about a refusal that will
    never succeed.
  */
  if (!me.canManage) {
    return (
      <Screen nav={{ back: BACK }}>
        <h1 className="font-display tracking-display leading-display text-4xl text-balance">
          Commission statements
        </h1>
        <div className="mt-6">
          <Problem
            title="Only owners, admins and managers can see what the business owes"
            body="Ask an owner, an admin or a manager if you need a figure."
          />
        </div>
      </Screen>
    );
  }

  /*
    HARD: the list is the screen. A failure reaches the error boundary, which
    offers the retry, rather than an empty list that reads as nothing owed.
  */
  const { items, complete } = await getCommissionStatements(token);
  const owed = totalOwed(items, complete);
  const owing = statementsOwing(items);

  return (
    <Screen nav={{ back: BACK }}>
      <h1 className="font-display tracking-display leading-display text-4xl text-balance">
        Commission statements
      </h1>

      {items.length === 0 ? (
        /*
          A real and common answer: no cash trips yet, or none completed since
          the business started taking cash. Said in words, never as ₹0.
        */
        <div className="mt-6">
          <Empty
            title="No statements yet"
            body="Yuvoy bills its share of your cash trips once a week. A statement for a week with cash trips in it comes from the Tuesday after."
          />
        </div>
      ) : (
        <>
          <Panel className="mt-6">
            {owed === null ? (
              /*
                A total over a list cut short, or over a statement that will
                not say what it owes, understates the bill. Each row still says
                what is left on it.
              */
              <p className="text-forest/80 leading-body text-sm text-pretty">
                We could not add up what is owed. Each statement below says what
                is left to pay on it.
              </p>
            ) : owed > 0 ? (
              <>
                {/* On the board, as every figure on Money is (v3.2). */}
                <p className="font-board text-4xl leading-none tabular-nums">
                  {formatPaise(owed)}
                </p>
                <p className="text-forest/70 mt-2 text-sm">
                  {owing === 1
                    ? "owed to Yuvoy on 1 statement"
                    : `owed to Yuvoy on ${owing} statements`}
                </p>
              </>
            ) : (
              <p className="text-lg font-bold text-balance">Nothing to pay</p>
            )}
          </Panel>

          <ul className="mt-6 space-y-3">
            {items.map((statement) => (
              <li key={statement.id}>
                <StatementRow statement={statement} />
              </li>
            ))}
          </ul>
          {!complete ? (
            <p className="text-forest/70 mt-4 text-sm">
              {`These are your latest ${items.length} statements.`}
            </p>
          ) : null}
        </>
      )}

      <div className="border-paper-line mt-10 border-t pt-4">
        <Link
          href={helpHref("settling-cash", "/earnings/commission")}
          className="text-forest/80 hover:text-forest inline-flex min-h-11 items-center text-sm underline underline-offset-4"
        >
          How to pay a statement
        </Link>
      </div>
    </Screen>
  );
}
