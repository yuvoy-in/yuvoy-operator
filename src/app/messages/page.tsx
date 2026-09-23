import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { listThreads } from "@/lib/messages/fetch";
import { Screen } from "@/components/chrome/screen";
import { Problem } from "@/components/ui/states";
import { ButtonLink } from "@/components/ui/button";
import { now } from "@/lib/format/market-time";
import { ThreadList } from "./thread-list";

export const metadata: Metadata = { title: "Conversations" };
export const dynamic = "force-dynamic";

/**
 * Every conversation this business has, most recently written in first:
 * yuvoy-operator#52 item 5, laid out by #83 s6.
 *
 * A focused route with a way back, not a tab: somebody arrives here from the
 * unread strip on Home, opens the one that is waiting, and leaves.
 *
 * One title, and nothing that explains the list (yuvoy-operator#80 t2, t4):
 * the eyebrow repeated the title in another word, and "one per booking, most
 * recently written in first" described what the rows already show.
 *
 * ## What is deliberately not on a row
 *
 * **Any message text, and any contact detail.** `MessageThreadSummary` says
 * "never its text", and a list that previewed the last line would put a
 * traveller's words on a screen anybody at the business can see over a
 * shoulder, to save one tap. The row says who wrote last and when instead.
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
    <Screen nav={{ back: { href: "/today", label: "today" } }}>
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Conversations
      </h1>

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
        <p className="text-forest/70 mt-8 text-base">No conversations yet</p>
      ) : (
        <div className="mt-8">
          <ThreadList initial={page} now={at} />
        </div>
      )}
    </Screen>
  );
}
