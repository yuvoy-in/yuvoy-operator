import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { classifyMeFailure } from "@/lib/account/status";
import {
  headline,
  stateLabel,
  standingOf,
  type Standing,
} from "@/lib/account/standing";
import { now } from "@/lib/format/market-time";
import { readMe, readSessionToken, SIGN_IN_PATH } from "@/lib/auth/session";
import { Screen } from "@/components/chrome/screen";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/cn";
import { Outstanding, Credentials } from "./verification-parts";

export const metadata: Metadata = { title: "Verification" };
export const dynamic = "force-dynamic";

/**
 * What is outstanding, and every document we hold: yuvoy-operator#58 item 10.
 *
 * Moved here from the Business tab: the profile became a profile (#58 item 2)
 * and this is what came off it. Everything that links to "what is
 * outstanding" links here: Home's account strip, the profile's own strip, and
 * a `not_selling` listing.
 *
 * ## The first thing waiting is the one action (yuvoy-operator#88 s13)
 *
 * "The biggest, darkest button on a screen about outstanding paperwork is 'Go
 * to today' ... Make the first outstanding item the primary action ('Add your
 * logo'). Demote Go to today to a back link. Show each blocker in one place
 * only, and link to it from the other." So the first item's way out is the
 * screen's one primary button, Go to today is a plain link, each blocker's
 * sentence is said once on this screen (a missing document's row names the
 * document and says it is needed, where it used to repeat the blocker), and
 * Business details links here instead of repeating the list.
 */
export default async function VerificationPage() {
  const token = await readSessionToken();
  if (!token) redirect(SIGN_IN_PATH);

  /*
    A `GET /me` that fails is not an account state. The same classification the
    Business screen applies, so the two cannot disagree about whether an
    operator is offboarded or the server simply had a bad minute.

    The failure is the one thrown. The error middleware raises every non-2xx,
    so a returned `error` never arrives, and reading only that turned an
    expired session into "we cannot tell you where you stand" with a reload
    that could never work (production readiness, 6 Oct 2026). `readMe` is the
    layout's own read, so asking costs no second request.
  */
  let me: Awaited<ReturnType<typeof readMe>> | null = null;
  try {
    me = await readMe(token);
  } catch (err) {
    if (classifyMeFailure(err) === "signed-out") redirect(SIGN_IN_PATH);
  }

  /*
    Two ways to have no standing, and they are not the same sentence. A read
    that failed can be retried; a 200 with no `account` block cannot, and the
    contract is explicit about what it means: "Absent means unknown — never
    'everything is fine'." Both refuse to say anybody is fine.
  */
  const unreadable = me === null;
  const standing: Standing | null = unreadable ? null : standingOf(me?.account);
  /*
    The logo and the business details are OWNER, ADMIN or MANAGER in the API;
    documents are anybody's. Absent reads as the narrower, so a staff phone is
    never handed a button the server will refuse (the audit, M10).
  */
  const canManage = Boolean(me?.canManage);
  const at = await now();

  return (
    <Screen nav={{ back: { href: "/account/settings", label: "settings" } }}>
      {/* One title (op#80 t2): no eyebrow over it, no caption in the bar. */}
      <h1 className="font-display tracking-display leading-display text-4xl text-balance">
        Verification
      </h1>

      {/*
        WHERE THEY STAND, ONCE — yuvoy-operator#33 §3, moved here with the list
        it belongs to (#58 item 10). The profile is headed by the business now,
        and this is the screen that answers whether it can be booked, so the
        sentence travels with the outstanding items rather than being said on a
        screen that no longer shows them.

        "Your account is live" and a LIVE chip say the same thing twice, but
        "You cannot be booked yet" and a `Prospect` chip do NOT: one is a state
        name and the other is what it means. So the chip and this sentence stay
        together as one status block.
      */}
      <p className="mt-4 text-lg font-bold text-balance">
        {standing
          ? headline(standing).title
          : "We cannot tell you where you stand"}
      </p>
      <p className="text-forest/70 leading-body mt-2 text-base text-pretty">
        {standing
          ? headline(standing).body
          : unreadable
            ? "This portal could not read your account's standing just now. It does not mean anything is wrong, but it does mean we should not tell you that nothing is. Reload the page and it should come back."
            : "This portal could not read your account's standing just now. It does not mean anything is wrong, but it does mean we should not tell you that nothing is."}
      </p>

      {/*
        `state` is DISPLAYED, never branched on. It is a bare string in the
        contract with no enum, and its values already disagree with the examples
        beside them: the schema shows ONBOARDING/LIVE/PAUSED while the API's own
        worked example returns PROSPECT. `bookable` is what every sentence above
        and below is derived from.
      */}
      {standing?.state ? (
        <Chip
          className={cn(
            /*
              `self-start`: the sheet lays its children out in a column, which
              stretched this pill across the whole screen, where it read as a
              bar rather than a state. A chip, so the pill's own 11px at the
              label's weight, in sentence case (v3.2).
            */
            "mt-4 self-start font-medium",
            standing.bookable
              ? "bg-forest text-paper"
              : "border-terra-deep text-terra-deep border bg-transparent",
          )}
        >
          {stateLabel(standing.state)}
        </Chip>
      ) : null}

      {/*
        And out of the way. An operator who can sell came here to check one
        thing; the way back to the day is on the screen rather than two taps up
        through settings. A plain link, not the biggest button on a screen
        about paperwork (op#88 s13): the button is for what is waiting.
      */}
      {standing?.bookable ? (
        <Link
          href="/today"
          className="text-forest/80 hover:text-forest mt-3 inline-flex min-h-11 items-center self-start text-sm underline underline-offset-4"
        >
          Go to today
        </Link>
      ) : null}

      {standing === null ? null : (
        <>
          <Outstanding standing={standing} canManage={canManage} />
          <Credentials standing={standing} at={at} />
        </>
      )}
    </Screen>
  );
}
