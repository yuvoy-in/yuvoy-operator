/*
  This page sits in a `(root)` route group, and the group exists for exactly
  one reason: to SCOPE the loading boundary beside it.

  `/account` is a tab root and wants a fallback, so its tap paints in the first
  frame. Its children do not: /account/listings/[id] and its edit screen call `notFound()`, and a loading
  boundary makes a route stream — the shell flushes with HTTP 200 before the
  page can set a status, so the 404 becomes a 200 with the not-found screen
  inside it. That was measured, not assumed: the first version of this change
  turned five detail routes into 200s and eleven e2e tests caught it.

  A route group is not part of the URL, so `/account` is unchanged, and
  `loading.tsx` in here covers this page alone rather than the whole subtree.
  Sibling components stay in `app/account/` because several are shared with those
  child routes; they are imported by their absolute path from here.

  `loading.test.ts` pins all of it.
*/
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { operatorApi } from "@/lib/api/server-client";
import { classifyMeFailure } from "@/lib/account/status";
import { readShape } from "@/lib/account/read-shape";
import { standingOf, type Standing } from "@/lib/account/standing";
import { waitingItems } from "@/lib/account/waiting";
import {
  TAB_LABEL,
  TAB_VALUES,
  businessName,
  orderForProfile,
  ratingLine,
  readTab,
  sinceLine,
  tileFacts,
  type TileListing,
} from "@/lib/account/profile";
import { posterFor } from "@/lib/services/home";
import { listListings, listMedia } from "@/lib/day/manifest";
import { readSessionToken, SIGN_IN_PATH } from "@/lib/auth/session";
import { operatorPageUrl } from "@/lib/site/traveller-app";
import { Screen } from "@/components/chrome/screen";
import { SignOutButton } from "@/components/chrome/sign-out-button";
import { ButtonLink } from "@/components/ui/button";
import { Panel, panelClass } from "@/components/ui/panel";
import { Chip } from "@/components/ui/chip";
import { SettingsIcon } from "@/components/ui/icons";
import { ProfileActions } from "@/app/account/profile-actions";
import { AddSheet } from "@/app/account/add-sheet";
import { About } from "@/app/account/about";
import { WaitingStrip } from "@/app/account/waiting-strip";
import { ReviewsTab } from "@/app/account/reviews-tab";
import { ReelsTab } from "@/app/account/reels-tab";

export const metadata: Metadata = { title: "Your business" };

export const dynamic = "force-dynamic";

/**
 * The business profile — yuvoy-operator#58 item 2.
 *
 * ## What this replaced
 *
 * A door list. The Business tab was an eyebrow, a status headline, a chip, a
 * link to Today, eight doors with a sentence each, the outstanding list, every
 * document, and a footer paragraph — a page an operator scrolled past to reach
 * the one thing they came for. Every setting is behind the gear now, and what
 * is left is the business as a traveller would recognise it: the name, the
 * logo, three numbers, and what it sells.
 *
 * ## The one screen that does not change
 *
 * `403 account_not_active` still renders exactly as it did (#50, and #58 item 1
 * says so explicitly). It is the one state where a profile would be a lie: the
 * sign-in works and the business does not, and the answer is a telephone number
 * rather than a page of tabs.
 *
 * ## Why it does not call `requireOperator()`
 *
 * That helper redirects here on `account_not_active`. Calling it from this page
 * would redirect to this page, forever. This is the one authenticated screen
 * that reads `GET /me` itself.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const token = await readSessionToken();
  if (!token) redirect(SIGN_IN_PATH);
  const { tab: askedTab } = await searchParams;

  let active = false;
  let canManage = false;
  let suspended = false;
  let slug = "";
  let standing: Standing | null = null;
  try {
    const { data, error } = await operatorApi(token).GET("/me", {});
    if (error) throw error;
    active = true;
    canManage = data?.canManage ?? false;
    suspended = Boolean(data?.account?.suspension);
    slug = data?.slug ?? "";
    standing = standingOf(data?.account);
  } catch (err) {
    const status = classifyMeFailure(err);
    if (status === "signed-out") redirect(SIGN_IN_PATH);
    /*
      Anything that is not a known account state is thrown, deliberately. A
      dropped connection on a jetty must never render as "your account has been
      suspended" — the error boundary says something recoverable, and offers the
      retry that is actually the answer.
    */
    if (status !== "not-active") throw err;
  }

  const tab = readTab(askedTab);

  /*
    Four soft reads. Every one of them degrades to its own absence rather than
    taking the profile down: a business that cannot read its own rating still
    needs the name, the logo and the way into its listings.
  */
  const [profile, logoUrl, story, listings, media] = active
    ? await Promise.all([
        operatorApi(token)
          .GET("/profile", {})
          .then((r) => (r.error ? null : (readShape(r.data) ?? null)))
          .catch(() => null),
        operatorApi(token)
          .GET("/logo", {})
          /*
            `GET /logo` answers a 200 with the URL or a 202 while one is in
            review, so the union has no `logoUrl` on one arm. Read through a
            narrow cast rather than widened: the 202 has no logo to show, and a
            profile drawing the letter circle for it is correct.
          */
          .then((r) =>
            r.error ? null : ((r.data as { logoUrl?: string }).logoUrl ?? null),
          )
          .catch(() => null),
        operatorApi(token)
          .GET("/story", {})
          .then((r) => (r.error ? null : r.data))
          .catch(() => null),
        /*
          `null` when the read failed, never `[]`: an empty grid says "No
          listings yet" and offers to add one, which is false for a business
          with six whose list simply did not arrive.
        */
        listListings(token).catch(() => null),
        listMedia(token).catch(() => null),
      ])
    : [null, null, null, null, null];

  /*
    Every listing, for the reel sheet's "put it on another listing" and for the
    Add a reel flow. Title and id only: the sheet chooses between them and
    nothing on it reads the rest.
  */
  const listingOptions = (listings ?? [])
    .filter((l) => l.id && l.title)
    .map((l) => ({ id: l.id!, title: l.title!, status: l.status }));

  const name = businessName(profile);
  /*
    Each thing waiting on the operator, named and linked where it is fixed
    (op#86 s9). The same list the Business tab's badge counts.
  */
  const waiting = standing ? waitingItems(standing.blocking, canManage) : [];
  const rating = ratingLine(story?.stats?.rating);
  const since = sinceLine(story?.reviewed?.operatingSince, story?.languages);
  // `null` when there is no slug, which the actions treat as "no share".
  const publicUrl = operatorPageUrl(slug) ?? "";

  return (
    <Screen>
      {active ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-display tracking-display text-4xl leading-[1.05]">
              {name}
            </h1>
            <div className="flex shrink-0 items-center gap-2">
              {/*
                + is not drawn for a suspended business: everything behind it
                creates something to sell, and a suspended business may not (#50).
              */}
              {!suspended ? (
                <AddSheet canManage={canManage} listings={listingOptions} />
              ) : null}
              <Link
                href="/account/settings"
                aria-label="Settings"
                className={panelClass(
                  "raised",
                  "ease-interaction hover:bg-paper flex size-11 items-center justify-center p-0 transition-colors duration-200",
                )}
              >
                <SettingsIcon className="text-forest size-5" />
              </Link>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-4">
            {/*
              The logo, and a tap opens the screen that sets it. A circle with
              the first letter when there is none: a broken image on a business's
              own profile reads as the portal failing rather than as a logo
              nobody has uploaded.
            */}
            <Link href="/logo" aria-label="Your logo" className="shrink-0">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt=""
                  className="size-16 rounded-full object-cover"
                />
              ) : (
                <span className="bg-paper-deep font-display text-forest flex size-16 items-center justify-center rounded-full text-2xl">
                  {name.slice(0, 1).toUpperCase()}
                </span>
              )}
            </Link>

            {/*
              The three numbers, from `stats`. Not drawn at all when the story
              read failed: three blanks under three labels is worse than the
              space, and a zero nobody measured is worse than both.

              "The header says 3 listings; the grid below shows six" (op#86
              s9). `stats.listings` counts what a traveller can buy now, and
              the grid shows every listing, drafts included, so the number is
              labelled for what it counts: Live. And every one of the three is
              a number over a word, reviews included.
            */}
            {story?.stats ? (
              <dl className="flex flex-1 justify-between gap-2 text-center">
                <Stat value={String(story.stats.listings ?? 0)} label="Live" />
                <Stat
                  value={String(story.stats.tripsRun ?? 0)}
                  label="Trips run"
                />
                {rating ? (
                  <Stat value={rating.value} label={rating.label} />
                ) : null}
              </dl>
            ) : null}
          </div>

          {since ? (
            <p className="text-forest/70 mt-3 text-sm">{since}</p>
          ) : null}

          {/*
            What is waiting on them, each thing named (op#86 s9). The same
            list the Business tab's badge counts; see `WaitingStrip`.
          */}
          <WaitingStrip items={waiting} />

          <nav aria-label="What to show" className="mt-8 flex flex-wrap gap-2">
            {TAB_VALUES.map((value) => (
              <ButtonLink
                key={value}
                href={`/account?tab=${value}`}
                variant={value === tab ? "primary" : "secondary"}
                size="sm"
                block={false}
                aria-current={value === tab ? "page" : undefined}
              >
                {TAB_LABEL[value]}
              </ButtonLink>
            ))}
          </nav>

          {tab === "listings" ? (
            <ListingsGrid
              listings={listings}
              media={media?.items ?? []}
              canManage={canManage}
              suspended={suspended}
            />
          ) : tab === "reels" ? (
            <ReelsTab
              media={media?.items ?? []}
              listings={listingOptions}
              suspended={suspended}
              partial={media ? !media.complete : false}
            />
          ) : (
            <ReviewsTab />
          )}

          {/*
            Listings come first (operator A, approved 3 Oct 2026). The page
            travellers read, and the ways to edit, share and see it, follow
            what the business sells instead of standing between the operator
            and it.
          */}
          <section aria-labelledby="your-page" className="mt-10">
            <h2
              id="your-page"
              className="font-display tracking-display text-2xl leading-tight"
            >
              Your page
            </h2>
            {story?.about ? <About text={story.about} /> : null}
            <ProfileActions url={publicUrl} />
          </section>
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
            person at Yuvoy does. That is the conversation to have.
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
 * One number over its word. The term comes first in the document, as a
 * description list wants it and a screen reader reads it ("Live, 3"), and the
 * number is drawn above it.
 */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-forest/70 mt-1 text-xs">{label}</dt>
      <dd className="font-display text-2xl leading-none">{value}</dd>
    </div>
  );
}

/**
 * Every listing, in the order they need attention — #58 item 3.
 *
 * Two to a row on a phone, three from 40rem: a third of a phone has no room
 * for the words a draft now says (operator A, approved 3 Oct 2026: "Listings
 * come first, each with its state, and a draft says in words what is still
 * missing"). What each tile says is `tileFacts`.
 *
 * The link is named title first, then the state and the line, in real
 * words: its children would otherwise join with no spaces between them, and
 * a screen reader would read "DraftIsland boat dayStill missing".
 */
function ListingsGrid({
  listings,
  media,
  canManage,
  suspended,
}: {
  /** `null` when the read failed, which is not the same as having none. */
  listings: (TileListing & { id?: string; title?: string })[] | null;
  media: {
    listing?: { experienceId?: string };
    posterUrl?: string;
    situation?: string;
  }[];
  canManage: boolean;
  suspended: boolean;
}) {
  if (listings === null) {
    return (
      <p className="text-terra-deep mt-6 text-base font-bold">
        Your listings did not load. Try again.
      </p>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="mt-6">
        <p className="text-forest/70 text-base">No listings yet</p>
        {canManage && !suspended ? (
          <ButtonLink
            href="/account/listings/new"
            variant="secondary"
            block={false}
            className="mt-3"
          >
            Add a listing
          </ButtonLink>
        ) : null}
      </div>
    );
  }

  return (
    <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {orderForProfile(listings).map((listing) => {
        const id = listing.id ?? "";
        const poster = posterFor(media, id);
        const { state, attention, line } = tileFacts(listing);
        const name = [listing.title, state, line].filter(Boolean).join(", ");
        return (
          <li key={id} className="flex">
            <Link
              href={`/account/listings/${id}`}
              aria-label={name}
              className={panelClass(
                "raised",
                "ease-interaction hover:border-forest/40 flex w-full flex-col overflow-hidden p-0 transition-colors duration-200",
              )}
            >
              {poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={poster}
                  alt=""
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="bg-paper-line block aspect-[4/3] w-full"
                />
              )}
              <span className="flex flex-col items-start gap-1.5 p-3">
                <Chip tone={attention ? "accent" : "neutral"}>{state}</Chip>
                <span className="text-sm leading-snug font-bold">
                  {listing.title}
                </span>
                {line ? (
                  <span
                    className={
                      attention
                        ? "text-terra-deep text-xs"
                        : "text-forest/70 text-xs"
                    }
                  >
                    {line}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
