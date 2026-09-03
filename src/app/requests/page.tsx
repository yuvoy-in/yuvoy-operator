import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { listOpenRequests } from "@/lib/day/requests";
import { urgencyOf } from "@/lib/day/request-types";
import { Problem } from "@/components/ui/states";
import { RequestQueue } from "./request-queue";
import { RefreshOnFocus } from "@/components/chrome/refresh-on-focus";
import { Screen } from "@/components/chrome/screen";

export const metadata: Metadata = { title: "Requests" };

/*
  Never prerendered, never cached, and re-read after every answer. Every row
  here has a clock on it and a traveller behind it.
*/
export const dynamic = "force-dynamic";

/**
 * O9 — seat requests, the other half of request mode.
 *
 * Request-mode departures hold nothing until the operator accepts. A request
 * that expires unanswered is a traveller told no by a clock, and the failure
 * this screen is designed against is an operator who lets requests rot rather
 * than saying no.
 *
 * So the order is the server's, not ours: the list arrives sorted by how soon
 * each expires rather than when it arrived, because the queue's job is to stop
 * requests dying. Re-sorting it here — by experience, by party size, by
 * anything — would undo the one thing it is for.
 */
export default async function RequestsPage() {
  const { token, me } = await requireOperator();
  const requests = await listOpenRequests(token);

  const critical = requests.filter(
    (r) => urgencyOf(r.minutesToAnswer) === "critical",
  ).length;

  return (
    <Screen>
      <RefreshOnFocus />

      <p className="eyebrow text-terra-deep">Waiting on you</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Requests
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        Nobody holds a seat until you say yes. Soonest to expire first.
      </p>

      {/*
        STAFF can see this queue and cannot answer it. Saying so up front is
        better than letting somebody choose a reason, tap Decline, and read a
        403 — the contract refuses the write, not the read.
      */}
      {!me.canManage ? (
        <div className="mt-6">
          <Problem
            title="You can see these, but not answer them"
            body="Granting seats needs an owner or a manager. Pass it on rather than letting the clock run out."
          />
        </div>
      ) : null}

      {critical > 0 ? (
        <p className="text-terra-deep mt-6 text-sm font-bold">
          {critical} {critical === 1 ? "request runs" : "requests run"} out
          within the hour.
        </p>
      ) : null}

      {/*
        The list and its receipts are one client component on purpose: the
        receipt an accept produces has to outlive the row the next refresh
        removes. See `RequestQueue`.
      */}
      <div className="mt-8">
        <RequestQueue requests={requests} canAnswer={me.canManage} />
      </div>
    </Screen>
  );
}
