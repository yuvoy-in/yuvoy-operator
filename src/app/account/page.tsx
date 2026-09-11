import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ComponentType } from "react";
import { operatorApi } from "@/lib/api/server-client";
import { classifyMeFailure } from "@/lib/account/status";
import { readShape } from "@/lib/account/read-shape";
import {
  blockerAction,
  blockerText,
  byDocumentType,
  byGatingFirst,
  credentialName,
  credentialText,
  documentAction,
  expirySentences,
  gatesSale,
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
  BriefcaseIcon,
  ChevronRightIcon,
  CoinsIcon,
  ImageIcon,
  StoryIcon,
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
 * |                                     | What it says                        |
 * | ----------------------------------- | ----------------------------------- |
 * | `403 account_not_active`            | On hold. Call us. Not signed out.   |
 * | `bookable: true`, nothing blocking  | Live, and gets out of the way.      |
 * | `bookable: true`, something blocking| Live, AND what we are still owed.   |
 * | `bookable: false`                   | What is outstanding, and who moves. |
 * | no `account` block at all           | We cannot tell — **never** "live".  |
 *
 * The third row is new (yuvoy-operator#38). `bookable` used to go false for
 * ANY outstanding item, so "live" and "has something outstanding" could not
 * both be true; yuvoy-api#139 narrowed it to things that actually stop a
 * sale, and the outstanding list is now gated on `blocking` rather than on
 * `!bookable` — which for an hour hid the logo and address prompts entirely.
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

  /*
    THE BUSINESS'S OWN NAME — yuvoy-operator#33 §3.

    A soft read, and the only reason this page calls `/profile` at all. If it
    fails the heading falls back to the sentence it used to carry: a page that
    error-boundaries because it could not fetch a NAME would take away the
    blocker list, which is the thing an operator came here for.
  */
  const businessName = active
    ? await operatorApi(token)
        .GET("/profile", {})
        .then((r) =>
          r.error ? null : readShape(r.data)?.legalName?.trim() || null,
        )
        .catch(() => null)
    : null;

  // Read once, outside render: the expiry arithmetic must not shift between
  // two renders of the same request. Same rule the manifest follows.
  const at = await now();

  return (
    <Screen>
      <p className="eyebrow text-terra-deep">Yuvoy for operators</p>

      {active ? (
        <>
          {/*
            THE BUSINESS NAME — yuvoy-operator#33 §3.

            This read "Your account is live" as an `h1`, with a `LIVE` chip
            beside it saying the same thing twice — and worse, that heading was
            derived from `bookable`, while since migration 0053 an operator can
            be `LIVE` and still not sellable. One status component, and the
            page named after the business.

            `legalName` comes from `GET /profile`, which is a soft read here:
            if it fails, the heading falls back to the sentence it used to
            carry rather than to an empty line.
          */}
          <h1 className="font-display tracking-display mt-4 text-4xl leading-[1.05]">
            {businessName ?? "Your business"}
          </h1>

          {/*
            The status, ONCE, below the name.

            Dropping this line with the old heading would have been the wrong
            reading of the issue: "Your account is live" and a `LIVE` chip say
            the same thing twice, but "You cannot be booked yet" and a
            `Prospect` chip do NOT — one is a state name and the other is what
            it means. So the chip and this sentence stay together as one
            status block, and what went is a heading that named the state
            instead of the business.
          */}
          <p className="mt-4 text-lg font-bold">
            {standing
              ? headline(standing).title
              : "We cannot tell you where you stand"}
          </p>
          <p className="text-forest/70 mt-2 text-base">
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

          {/*
            GATED ON THE LIST HAVING SOMETHING IN IT — yuvoy-operator#38.

            This read `standing && !standing.bookable`, which was correct
            against the old API: `bookable` went false for ANY outstanding
            item, so `!bookable` was a reliable proxy for "there is something
            to show". yuvoy-api#139 made `bookable` false only when something
            actually stops a sale — and this screen promptly stopped asking
            operators for their logo and their registered address at all,
            because a LIVE operator with those outstanding now has
            `bookable: true`.

            The proxy is gone for good. The list is gated on the list.
          */}
          {standing && standing.blocking.length > 0 ? (
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
              {/*
                Ungated, unlike the three below it.

                `PUT /profile` and `POST /credentials` declare a generic
                `Forbidden` and name no role, and this is the screen that acts
                on the blockers this very page lists. Hiding it from a manager
                would tell them they may not send us an insurance certificate
                the server would have accepted — and it is their account that
                cannot sell until somebody does.
              */}
              <Door
                href="/profile"
                icon={BriefcaseIcon}
                title="Business details"
                body="The registered name and address, and how to send us a document we asked for."
              />
              {canManage ? (
                <>
                  <Door
                    href="/earnings"
                    icon={CoinsIcon}
                    title="Earnings"
                    body="What you are owed, and why it is that number."
                  />
                  {/*
                    CASH, AND WHAT IS OWED ON IT — yuvoy-operator#40 §2.

                    Beside Earnings rather than inside it: earnings are what we
                    owe them and this is what they owe us, and folding the two
                    into one screen would net a balance against a payout that
                    has nothing to do with it. Same OWNER/MANAGER gate — it is
                    the money, and a staff phone on a boat needs the manifest.
                  */}
                  <Door
                    href="/cash"
                    icon={CoinsIcon}
                    title="Cash you've collected"
                    body="What travellers paid you directly, and Yuvoy's share of it."
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
              {/*
                THE LOGO, which is mandatory before an operator can be booked
                and had nowhere to be set (yuvoy-operator#35 §2). It is also
                where `LOGO_MISSING` links to from the blocker list above.
              */}
              <Door
                href="/logo"
                icon={ImageIcon}
                title="Your logo"
                body="The mark travellers see on a card with no clip. We need one before you can be booked."
              />
              {/*
                WHAT TRAVELLERS READ ABOUT YOU — yuvoy-operator#41. Ungated like
                the logo: "not behind step-up and not OWNER-only", and the
                person who runs the boat is the one who should describe it.
              */}
              <Door
                href="/story"
                icon={StoryIcon}
                title="Your story"
                body="What travellers read about you before they book — in your words, with photographs of the operation."
              />
              {/*
                The "Add a reel" door was here and is gone — yuvoy-operator#33
                §4. It opened Services, which is its own tab, and one screen
                should not live in two places: a second door to the same screen
                is a second thing to keep in step and a second answer to "where
                do I do that".
              */}
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
  /*
    Sorted before it is split, so the thing that is costing money is the first
    row an operator meets in each section — yuvoy-operator#38. `gates` is the
    field that tells them apart, and a row that will not say which it is sits
    between the two rather than being sorted as though it were harmless.
  */
  const { operator, yuvoy } = splitByWaitingOn(
    byGatingFirst(standing.blocking),
  );

  return (
    <div className="mt-8 space-y-6">
      {operator.length > 0 ? (
        <section aria-labelledby="waiting-on-you">
          <h2 id="waiting-on-you" className="label text-terra-deep">
            Waiting on you
          </h2>
          <ul className="mt-3 space-y-3">
            {operator.map((b, i) => {
              /*
                THE WAY OUT OF THE BLOCKER — yuvoy-operator#33.

                This screen listed everything stopping a business from selling
                and gave no way to fix any of it. Every line was a sentence
                with no button, so the only route forward was to ring us and
                have somebody do it from the admin console — the concierge
                path the self-serve portal exists to remove.

                `null` for a code we do not recognise, deliberately. A link to
                the wrong screen is worse than no link, and `OTHER` exists so a
                reason can be added operationally without a contract change.
              */
              const action = blockerAction(b);
              return (
                <li
                  key={`${b.code}-${i}`}
                  /*
                    Alert tone is for what is costing money. A logo that stops
                    no sale sitting in the same red panel as a lapsed licence
                    is how a screen teaches an operator to ignore all of it —
                    so an item that says it does not gate is drawn quietly.
                    Unknown keeps the loud panel: it is the safer guess when
                    the row will not say.
                  */
                  className={panelClass(
                    gatesSale(b) === false ? undefined : "alert",
                  )}
                >
                  <p className="text-base font-bold">{blockerText(b)}</p>
                  {/*
                    WHETHER IT IS COSTING THEM ANYTHING — yuvoy-operator#38.

                    A missing logo and an unfinished registered address are
                    real asks that stop no sale; paperwork and operator status
                    do. Saying which is the difference between an operator who
                    clears this at the weekend and one who thinks their
                    business is shut. Only `gates: false` earns a marker: the
                    gating case is already the loudest thing on the screen,
                    and a row that does not carry the field gets no claim in
                    either direction.
                  */}
                  {gatesSale(b) === false ? (
                    <p className="label text-forest/70 mt-1.5">
                      Not stopping sales
                    </p>
                  ) : null}
                  {b.since ? (
                    <p className="text-forest/70 mt-2 text-sm">
                      Outstanding since {marketDateLabel(b.since.slice(0, 10))}.
                    </p>
                  ) : null}
                  {action ? (
                    <ButtonLink
                      href={action.href}
                      variant="secondary"
                      className="mt-4"
                    >
                      {action.label}
                    </ButtonLink>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {/*
            "There is no upload on this screen yet" was here, and it stopped
            being true: `/profile` sends business details and documents, and
            `/logo` sends the logo. What is left to say is the thing the links
            above cannot — that a person reads each one.
          */}
          <p className="text-forest/70 mt-3 text-sm">
            A person at Yuvoy checks each of these. If one was turned down and
            you do not know why, ring us — we cannot show you the reason here
            yet.
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
                  {/*
                    Both halves are true and the second one changes what an
                    operator does with their morning: something of ours that
                    is holding a listing back is worth a phone call, and
                    something that is not can simply be waited on.
                  */}
                  {gatesSale(b) === true
                    ? "Nothing for you to do, but this is holding a listing back. We will tell you when it moves."
                    : "Nothing for you to do. We will tell you when it moves."}
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
  /*
    THE SENTENCE AN EXPIRY EARNS — yuvoy-operator#46, verbatim, above the list
    rather than inside a row: "Public liability insurance expires 30 Nov 2026.
    Listings that need it come down that day." A date in small type on the
    fourth row down is how a lapsed licence becomes a cancelled booking.
  */
  const expiring = expirySentences(standing.credentials, at);
  /*
    One action per DOCUMENT, on the first row of its type. The list is the
    history — last year's certificate sits beside this year's — so the action
    is decided for the type as a whole, and only where `POST /credentials`
    will take what it leads to.
  */
  const actions = new Map(
    [...byDocumentType(standing.credentials)].map(([type, rows]) => [
      type,
      documentAction(rows, at),
    ]),
  );
  const offered = new Set<string>();

  return (
    <section className="mt-10" aria-labelledby="documents">
      <h2 id="documents" className="label text-forest/75">
        Your documents
      </h2>
      {expiring.length > 0 ? (
        <Panel tone="alert" className="mt-3">
          <ul className="space-y-2">
            {expiring.map((line) => (
              <li key={line} className="text-base font-bold">
                {line}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <ul className="mt-3 space-y-3">
        {standing.credentials.map((c, i) => {
          const row = credentialText(c, at);
          const type = c.type?.trim() ?? "";
          const action = offered.has(type) ? null : (actions.get(type) ?? null);
          offered.add(type);
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
              {action ? (
                <ButtonLink
                  href={action.href}
                  variant="secondary"
                  className="mt-4"
                >
                  {action.label}
                </ButtonLink>
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
