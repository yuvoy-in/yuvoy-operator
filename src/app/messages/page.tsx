import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { listThreads } from "@/lib/messages/fetch";
import { Screen } from "@/components/chrome/screen";
import { Empty, Problem } from "@/components/ui/states";
import { ButtonLink } from "@/components/ui/button";
import { now } from "@/lib/format/market-time";
import { ThreadList } from "./thread-list";

export const metadata: Metadata = { title: "Conversations" };
export const dynamic = "force-dynamic";

/**
 * Every conversation this business has — yuvoy-operator#52 item 5.
 *
 * A focused route with a way back, not a tab: somebody arrives here from the
 * unread strip on Home, opens the one that is waiting, and leaves.
 *
 * ## What is deliberately not on a row
 *
 * **The traveller's name, and any contact detail.** `MessageThreadSummary`
 * "carries neither, by design (D-018)", and the issue lists both under
 * `Do not build`. A row is identified by its reference and its trip, which is
 * what an operator at a jetty has in front of them anyway.
 *
 * **Any message text.** The same schema says "never its text". A list that
 * previewed the last line would put a traveller's words on a screen anybody at
 * the business can see over a shoulder, to save one tap.
 */
export default async function MessagesPage() {
  const { token } = await requireOperator();

  let page = null;
  try {
    page = await listThreads(token);
  } catch {
    page = null;
  }
  const at = await now();

  return (
    <Screen
      nav={{ back: { href: "/today", label: "today" } }}
      stageLabel="Conversations"
    >
      <p className="eyebrow text-terra-deep">Messages</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Conversations
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        One per booking, most recently written in first.
      </p>

      {page === null ? (
        /*
          The issue's own copy, and a button rather than a sentence telling
          somebody to reload: this route is `force-dynamic`, so a link back to
          itself genuinely refetches.
        */
        <div className="mt-8">
          <Problem
            title="Conversations did not load."
            body="Nothing is lost. Try again, and tell us if it keeps happening."
          />
          {/*
            A link rather than a client button with a refresh in it. This route
            is `force-dynamic`, so navigating to itself genuinely refetches, and
            the page stays a server component with nothing to hydrate.
          */}
          <div className="mt-4">
            <ButtonLink href="/messages" variant="secondary" block={false}>
              Try again
            </ButtonLink>
          </div>
        </div>
      ) : page.rows.length === 0 ? (
        <div className="mt-8">
          <Empty
            title="No conversations yet"
            body="When a traveller writes about a booking, it appears here."
          />
        </div>
      ) : (
        <div className="mt-8">
          <ThreadList initial={page} now={at} />
        </div>
      )}
    </Screen>
  );
}
