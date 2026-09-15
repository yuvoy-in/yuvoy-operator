import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import { listSlots } from "@/lib/day/manifest";
import { listOpenRequests } from "@/lib/day/requests";
import { totalUnread } from "@/lib/messages/fetch";
import { unreadLabel } from "@/lib/messages/thread";
import { urgencyOf } from "@/lib/day/request-types";
import { dayCaption, marketDays, marketTime } from "@/lib/format/market-time";
import { headline, splitByWaitingOn } from "@/lib/account/standing";
import { Empty } from "@/components/ui/states";
import { Screen } from "@/components/chrome/screen";
import { Chip } from "@/components/ui/chip";
import { Panel, panelClass } from "@/components/ui/panel";
import { ChevronRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Today" };

/*
  Never prerendered, never cached. This page is the live answer to "what am I
  running today" — a build-time copy would show the deploy day's departures,
  and a cached one would show a seat count that was true a minute ago. The
  brief's warning is exactly this: a manifest kept from memory disagrees with
  the boat.
*/
export const dynamic = "force-dynamic";

/**
 * O10 — the day, as a list of departures.
 *
 * The screen an operator opens at 6am. Today only: a portal that opens on a
 * week makes somebody find today, and at 6am on a jetty the answer to "what is
 * on" is never next Thursday. Tomorrow is one tap away for the operator who is
 * checking ahead.
 *
 * The day carries nothing but the day. Money, people, footage and the account
 * live behind the Business tab, and capacity has a tab of its own.
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { token, me } = await requireOperator();
  const { day } = await searchParams;

  // Started before the slots are awaited, so the two overlap. A failure is
  // kept as a failure rather than folded into "no requests" — a queue nobody
  // sees is a queue that expires, and a 500 used to look exactly like empty.
  const openRequests = listOpenRequests(token).then(
    (items) => ({ ok: true as const, items }),
    () => ({ ok: false as const, items: [] }),
  );

  /*
    Started alongside the requests, for the same reason: on one bar of signal a
    serial fetch doubles the wait, and neither of these depends on the other.
    `totalUnread` soft-fails to zero of its own accord, so there is nothing to
    catch here and nothing that can take the day down.
  */
  const unread = totalUnread(token);

  const { today, tomorrow } = await marketDays();
  // Only ever today or tomorrow from the UI, but the value arrives in a URL,
  // so it is validated rather than trusted.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? day! : today;
  const slots = await listSlots(token, date, date);

  /*
    Requests are fetched here too, because the day is the screen an operator
    opens and a request nobody sees is a request that expires. Deliberately
    not awaited in sequence with the slots — the two are independent, and on
    one bar of signal a serial fetch doubles the wait for no reason.
  */
  const requestsResult = await openRequests;
  const requests = requestsResult.items;
  const urgent = requests.filter(
    (r) => urgencyOf(r.minutesToAnswer) === "critical",
  ).length;
  const unreadTotal = await unread;

  return (
    <Screen>
      <p className="eyebrow text-terra-deep">{me.name || "Your day"}</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        {dayCaption(date, today, tomorrow)}
      </h1>

      {/*
        The account cannot sell, said on the screen where the question is
        actually asked.

        A brand-new operator signs in and lands here — `/` redirects to
        `/today` — and after self-signup (D-029) they are a PROSPECT with no
        departures and nothing to run. Without this they meet "Nothing
        scheduled", which reads as "you have not added anything" rather than
        "you cannot sell yet". The Business door has the detail; this is the
        pointer to it.

        `account` is null when the API did not say. Nothing is claimed then —
        an unknown standing must not produce a warning any more than it may
        produce reassurance.
      */}
      {me.account && !me.account.bookable ? (
        <Link
          href="/account"
          className={panelClass(
            "alert",
            "ease-interaction hover:bg-cream mt-6 flex items-center justify-between gap-4 p-4 transition-colors duration-200",
          )}
        >
          <span>
            <span className="block text-base font-bold">
              {headline(me.account).title}
            </span>
            <span className="text-forest/80 mt-1 block text-sm">
              {splitByWaitingOn(me.account.blocking).operator.length > 0
                ? "See what is outstanding"
                : "See where it stands"}
            </span>
          </span>
          <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
        </Link>
      ) : null}

      {!requestsResult.ok ? (
        <Panel role="status" className="mt-6 px-4 py-3 text-sm">
          Requests could not be loaded just now.{" "}
          <Link href="/bookings" className="text-terra-deep underline">
            Open the queue
          </Link>{" "}
          to check. One may be waiting.
        </Panel>
      ) : null}

      {requests.length > 0 ? (
        <Link
          href="/bookings"
          className={panelClass(
            "alert",
            "ease-interaction hover:bg-cream mt-6 flex items-center justify-between gap-4 p-4 transition-colors duration-200",
          )}
        >
          <span className="text-base font-bold">
            {requests.length} request{requests.length === 1 ? "" : "s"} waiting
          </span>
          <span className="label text-terra-deep flex shrink-0 items-center gap-1">
            {urgent > 0 ? `${urgent} within the hour` : "Answer"}
            <ChevronRightIcon className="size-4" />
          </span>
        </Link>
      ) : null}

      {/*
        Directly under the requests strip, by the owner's decision of 14
        September (yuvoy-operator#52 item 4), and drawn only when there is a
        number to draw. Quieter than requests on purpose: a request expires and
        a message waits, so this must not compete with the thing that dies.
      */}
      {unreadTotal > 0 ? (
        <Link
          href="/messages"
          className={panelClass(
            "raised",
            "ease-interaction hover:bg-cream mt-3 flex items-center justify-between gap-4 p-4 transition-colors duration-200",
          )}
        >
          <span className="text-base font-bold">
            {unreadLabel(unreadTotal)}
          </span>
          <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
        </Link>
      ) : null}

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Which day">
        <DayLink label="Today" href="/today" active={date === today} />
        <DayLink
          label="Tomorrow"
          href={`/today?day=${tomorrow}`}
          active={date === tomorrow}
        />
      </nav>

      <div className="mt-8">
        {slots.length === 0 ? (
          <Empty
            title="Nothing scheduled"
            body={
              date === today
                ? "No departures today. If that is wrong, check your slots. A departure that is not here is one Yuvoy cannot sell."
                : date === tomorrow
                  ? "Nothing on the books for tomorrow yet."
                  : "Nothing on the books for that day."
            }
          />
        ) : (
          <ul className="space-y-3">
            {slots.map((slot) => (
              <li key={slot.id}>
                <Link
                  href={`/today/${slot.id}`}
                  className={panelClass(
                    "raised",
                    "hover:border-forest/40 ease-interaction flex items-center gap-4 transition-colors duration-200",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-display text-2xl leading-none">
                        {marketTime(slot.startsAt, slot.timezone)}
                      </span>
                      <Chip tone={slot.remaining === 0 ? "accent" : "neutral"}>
                        {slot.sold} of {slot.seats} sold
                      </Chip>
                    </div>
                    <p className="mt-2 text-base font-bold">{slot.title}</p>
                    {slot.status !== "open" ? (
                      <p className="text-terra-deep mt-1.5 text-sm font-bold">
                        {slot.status === "cancelled"
                          ? "Called off"
                          : "Closed to new bookings"}
                      </p>
                    ) : null}
                  </div>
                  <ChevronRightIcon className="text-forest/70 size-5 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Screen>
  );
}

function DayLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "dock-target ease-interaction rounded-full border px-6 text-sm transition-colors duration-200",
        active
          ? "border-forest bg-forest text-cream font-bold"
          : "border-cream-line bg-cream-deep hover:border-forest/40",
      )}
    >
      {label}
    </Link>
  );
}
