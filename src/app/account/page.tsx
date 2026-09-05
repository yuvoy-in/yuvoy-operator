import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ComponentType } from "react";
import { operatorApi } from "@/lib/api/server-client";
import { classifyMeFailure } from "@/lib/account/status";
import {
  blockerText,
  credentialName,
  credentialText,
  headline,
  splitByWaitingOn,
  standingOf,
  stateLabel,
  type Standing,
} from "@/lib/account/standing";
import { marketDateLabel, now } from "@/lib/format/market-time";
import { readSessionToken, SIGN_IN_PATH } from "@/lib/auth/session";
import { SignOutButton } from "@/components/chrome/sign-out-button";
import { Screen } from "@/components/chrome/screen";
import { ButtonLink } from "@/components/ui/button";
import {
  BankIcon,
  ChevronRightIcon,
  CoinsIcon,
  FilmIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { Chip } from "@/components/ui/chip";
import { Panel, panelClass } from "@/components/ui/panel";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Your business" };

export const dynamic = "force-dynamic";

/**
 * The Business door — O3, and the way to everything about the business that
 * is not the day.
 *
 * ## The four states, and the one that used to be a lie
 *
 * O3 asks for the states between signing up and taking bookings, and for the
 * operator to see **exactly what is outstanding — a missing credential, an
 * unverified document — rather than a generic "pending"**. `AccountStanding`
 * on `GET /me` (yuvoy-api#63 → PR #83, 5 Sep 2026) is that data, and this
 * screen is what it was for.
 *
 * |                              | What it says                          |
 * | ---------------------------- | ------------------------------------- |
 * | `403 account_not_active`     | On hold. Call us. Not signed out.     |
 * | `bookable: true`             | Live, and gets out of the way.        |
 * | `bookable: false`            | What is outstanding, and who moves.   |
 * | no `account` block at all    | We cannot tell — **never** "live".    |
 *
 * The third row is the one that was wrong until today: this page said "your
 * account is live" to anybody whose `/me` returned 200, and after self-signup
 * (`POST /auth/signup`, D-029) a `PROSPECT` is the most common operator there
 * is — real account, real session, cannot sell a thing. The fourth row is the
 * contract's own instruction: "Absent means unknown — never 'everything is
 * fine'."
 *
 * Nothing here is invented. Every line is `label`, `waitingOn`, `state` or a
 * date the API published; the only arithmetic is days until an expiry.
 *
 * ## Why it does not call `requireOperator()`
 *
 * That helper redirects here on `account_not_active`. Calling it from this
 * page would redirect to this page, forever. This is the one authenticated
 * screen that reads `GET /me` itself — and it reads `canManage` off the same
 * answer to decide which doors to draw, the same field `requireOperator()`
 * hands every other screen.
 */
export default async function AccountPage() {
  const token = await readSessionToken();
  if (!token) redirect(SIGN_IN_PATH);

  let active = false;
  let canManage = false;
  let standing: Standing | null = null;
  try {
    const { data, error } = await operatorApi(token).GET("/me", {});
    if (error) throw error;
    active = true;
    canManage = data?.canManage ?? false;
    standing = standingOf(data?.account);
  } catch (err) {
    const status = classifyMeFailure(err);
    if (status === "signed-out") redirect(SIGN_IN_PATH);
    /*
      Anything that is not a known account state is thrown, deliberately. A
      dropped connection on a jetty must never render as "your account has
      been suspended" — the error boundary says something recoverable, and
      offers the retry that is actually the answer.
    */
    if (status !== "not-active") throw err;
  }

  // Read once, outside render: the expiry arithmetic must not shift between
  // two renders of the same request. Same rule the manifest follows.
  const at = await now();

  return (
    <Screen>
      <p className="eyebrow text-terra-deep">Yuvoy for operators</p>

      {active ? (
        <>
          <h1 className="font-display tracking-display mt-4 text-4xl leading-[1.05]">
            {standing
              ? headline(standing).title
              : "We cannot tell you where you stand"}
          </h1>
          <p className="text-forest/70 mt-3 text-base">
            {standing
              ? headline(standing).body
              : /*
                  The contract: "Absent means unknown — never 'everything is
                  fine'." An older deployment or a partial response must not
                  read as approval, so this says the true thing instead of the
                  reassuring one.
                */
                "This portal could not read your account's standing just now. It does not mean anything is wrong — but it does mean we should not tell you that nothing is."}
          </p>

          {/*
            `state` is DISPLAYED, never branched on. It is a bare string in the
            contract with no enum, and its values already disagree with the
            examples beside them — the schema shows ONBOARDING/LIVE/PAUSED
            while the API's own worked example returns PROSPECT. `bookable` is
            what every sentence above and below is derived from.
          */}
          {standing?.state ? (
            <Chip
              className={cn(
                "label mt-4",
                standing.bookable
                  ? "bg-forest text-cream"
                  : "border-terra-deep text-terra-deep border bg-transparent",
              )}
            >
              {stateLabel(standing.state)}
            </Chip>
          ) : null}

          {standing?.bookable ? (
            <ButtonLink href="/today" className="mt-6">
              Go to today
            </ButtonLink>
          ) : null}

          {standing && !standing.bookable ? (
            <Outstanding standing={standing} />
          ) : null}

          {/*
            Everything about the business that is not the day. Earnings,
            payout details and the team are OWNER/MANAGER doors — a staff
            phone on a boat needs the manifest and nothing else, and the
            pages themselves say what a manager may do. Uploading a reel is
            ungated: the contract puts no role on an upload intent, and the
            person who filmed the dive is the one who should be sending it.
          */}
          <section className="mt-10" aria-labelledby="business">
            <h2 id="business" className="label text-forest/75">
              Your business
            </h2>
            <ul className="mt-3 space-y-3">
              {canManage ? (
                <>
                  <Door
                    href="/earnings"
                    icon={CoinsIcon}
                    title="Earnings"
                    body="What you are owed, and why it is that number."
                  />
                  <Door
                    href="/payouts"
                    icon={BankIcon}
                    title="Payout details"
                    body="Where the money goes. Changing it takes two days on purpose."
                  />
                  <Door
                    href="/team"
                    icon={UsersIcon}
                    title="Team access"
                    body="Who can get into this business, and what each of them can do."
                  />
                </>
              ) : null}
              <Door
                href="/reels"
                icon={FilmIcon}
                title="Add a reel"
                body="One upright clip of the real thing does more than a page of description."
              />
            </ul>
          </section>

          {/*
            What Yuvoy holds, shown to a LIVE operator too — this is where the
            expiry lives. "A dive licence that lapses mid-season takes the
            listing down, and an operator who was never shown the date finds
            out from a cancelled booking." A live account with a licence
            expiring in three weeks is exactly who needs this section.
          */}
          {standing && standing.credentials.length > 0 ? (
            <Credentials standing={standing} at={at} />
          ) : null}

          {/*
            Editing any of it is still not here. O6 is the screen for that and
            the contract has no write path yet — `POST /change-requests` does
            not exist, only the bank-specific one. Said out loud rather than
            left as a silence: an operator holding a renewed certificate needs
            to know where to send it.
          */}
          <p className="border-cream-line text-forest/70 mt-10 border-t pt-6 text-sm">
            You cannot send or replace a document here yet — message us and a
            person will take it. We will put it on this screen when the API can
            accept one.
          </p>

          <div className="mt-8">
            <SignOutButton />
          </div>
        </>
      ) : (
        <>
          <h1 className="font-display tracking-display mt-4 text-4xl leading-[1.05]">
            Your account cannot take bookings
          </h1>
          {/*
            The contract's own distinction, kept: "the person is fine, the
            business relationship is not". So they are NOT signed out, and
            the page does not talk to them as though they had done something
            wrong. It also does not guess between suspended and offboarded —
            one code covers both, and inventing which would be worse than
            saying neither.
          */}
          <p className="text-forest/80 mt-3 text-base">
            Your sign-in works. It is the business account that is on hold, so
            departures are not on sale and bookings cannot be taken.
          </p>
          <p className="text-forest/80 mt-3 text-base">
            We have not told you why here, because this screen does not know. A
            person at Yuvoy does — that is the conversation to have.
          </p>

          <Panel tone="alert" className="mt-8">
            <p className="text-base font-bold">Call us</p>
            <p className="mt-1.5 font-mono text-lg">+91 81216 57657</p>
            <p className="text-forest/70 mt-2 text-sm">
              If you have travellers booked on departures today, say so first.
              Those bookings still exist and still need somebody to meet them.
            </p>
          </Panel>

          <p className="text-forest/70 mt-8 text-sm">
            Nothing else in the portal will open while the account is on hold.
            Signing out and back in will not change it.
          </p>

          <div className="mt-8">
            <SignOutButton />
          </div>
        </>
      )}
    </Screen>
  );
}

/**
 * What is outstanding, split by who has to move next.
 *
 * `waitingOn` gets its own heading rather than a badge on a row, because it is
 * the field that decides whether an operator does something this morning or
 * waits — "'pending' because we are slow and 'pending' because they have sent
 * nothing read identically, and an operator who cannot tell which has no
 * choice but to ring somebody."
 */
function Outstanding({ standing }: { standing: Standing }) {
  const { operator, yuvoy } = splitByWaitingOn(standing.blocking);

  return (
    <div className="mt-8 space-y-6">
      {operator.length > 0 ? (
        <section aria-labelledby="waiting-on-you">
          <h2 id="waiting-on-you" className="label text-terra-deep">
            Waiting on you
          </h2>
          <ul className="mt-3 space-y-3">
            {operator.map((b, i) => (
              <li key={`${b.code}-${i}`} className={panelClass("alert")}>
                <p className="text-base font-bold">{blockerText(b)}</p>
                {b.since ? (
                  <p className="text-forest/70 mt-2 text-sm">
                    Outstanding since {marketDateLabel(b.since.slice(0, 10))}.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {/*
            There is nowhere in this portal to send a document — O6 is not
            built and the contract has no write path for one. Offering an
            upload that does not exist would be worse than naming the channel
            that does.
          */}
          <p className="text-forest/70 mt-3 text-sm">
            Send these to us and a person will check them. There is no upload on
            this screen yet.
          </p>
        </section>
      ) : null}

      {yuvoy.length > 0 ? (
        <section aria-labelledby="waiting-on-us">
          <h2 id="waiting-on-us" className="label text-forest/75">
            With Yuvoy
          </h2>
          <ul className="mt-3 space-y-3">
            {yuvoy.map((b, i) => (
              <li key={`${b.code}-${i}`} className={panelClass()}>
                <p className="text-base font-bold">{blockerText(b)}</p>
                <p className="text-forest/70 mt-2 text-sm">
                  Nothing for you to do. We will tell you when it moves.
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Every document Yuvoy holds or is waiting for, and when it runs out. */
function Credentials({ standing, at }: { standing: Standing; at: number }) {
  return (
    <section className="mt-10" aria-labelledby="documents">
      <h2 id="documents" className="label text-forest/75">
        Your documents
      </h2>
      <ul className="mt-3 space-y-3">
        {standing.credentials.map((c, i) => {
          const row = credentialText(c, at);
          return (
            <li key={`${c.type}-${i}`} className={panelClass()}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-base font-bold">{credentialName(c)}</p>
                {/*
                  `mandatory` is what separates "the account cannot go live
                  without this" from "nice to have on file", and an operator
                  deciding what to chase first needs it.
                */}
                {c.mandatory ? (
                  <span className="label text-forest/70 shrink-0">
                    Required
                  </span>
                ) : null}
              </div>
              <p
                className={cn(
                  "mt-2 text-sm",
                  row.tone === "problem"
                    ? "text-terra-deep font-bold"
                    : row.tone === "warn"
                      ? "text-terra-deep"
                      : "text-forest/80",
                )}
              >
                {row.text}
              </p>
              {c.expiresOn ? (
                <p className="text-forest/70 mt-1 text-sm">
                  {/*
                    A DATE, not an instant — "a licence expires on a day, and
                    sending a timestamp invites a timezone bug on the one field
                    an operator plans a season around."
                  */}
                  Valid until {marketDateLabel(c.expiresOn)}
                  {c.issuer ? ` · ${c.issuer}` : null}
                </p>
              ) : c.issuer ? (
                <p className="text-forest/70 mt-1 text-sm">{c.issuer}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Door({
  href,
  icon: Icon,
  title,
  body,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className={panelClass(
          "raised",
          "hover:border-forest/40 ease-interaction flex items-center gap-4 transition-colors duration-200",
        )}
      >
        <span className="bg-forest text-cream inline-flex size-11 shrink-0 items-center justify-center rounded-full">
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold">{title}</span>
          <span className="text-forest/70 mt-0.5 block text-sm">{body}</span>
        </span>
        <ChevronRightIcon className="text-forest/70 size-5 shrink-0" />
      </Link>
    </li>
  );
}
