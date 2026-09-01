import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import { listSlots } from "@/lib/day/manifest";
import { listOpenRequests } from "@/lib/day/requests";
import { urgencyOf } from "@/lib/day/request-types";
import { marketDays, marketTime } from "@/lib/format/market-time";
import { Empty } from "@/components/ui/states";
import { SignOutButton } from "@/components/chrome/sign-out-button";

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
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { token, me } = await requireOperator();
  const { day } = await searchParams;

  // Started before the slots are awaited, so the two overlap.
  const openRequests = listOpenRequests(token).catch(() => []);

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
  const requests = await openRequests;
  const urgent = requests.filter(
    (r) => urgencyOf(r.minutesToAnswer) === "critical",
  ).length;

  return (
    <main className="bg-cream text-forest min-h-dvh">
      <div className="container-page max-w-2xl py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow text-terra-deep">{me.name || "Your day"}</p>
            <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
              {date === today ? "Today" : "Tomorrow"}
            </h1>
          </div>
          <SignOutButton />
        </div>

        {requests.length > 0 ? (
          <Link
            href="/requests"
            className="rounded-edge border-terra-deep bg-cream-deep mt-6 flex items-center justify-between gap-4 border-2 p-4"
          >
            <span className="text-base font-bold">
              {requests.length} request{requests.length === 1 ? "" : "s"}{" "}
              waiting
            </span>
            <span className="label text-terra-deep shrink-0">
              {urgent > 0 ? `${urgent} within the hour` : "Answer"} →
            </span>
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

        <p className="mt-4">
          <Link
            href="/capacity"
            className="label text-forest/70 hover:text-forest tap-target underline underline-offset-4"
          >
            Seats and closed dates →
          </Link>
          {/* Earnings is OWNER/MANAGER only; a staff member sees a 403 rather
              than a page, so the link is not offered to them. Payout details
              and Team are OWNER-only to CHANGE but readable by a manager, so
              they sit behind the same gate as the link list rather than a
              stricter one — the pages themselves say what a manager may do. A
              staff phone on a boat needs the manifest and nothing else. */}
          {me.canManage ? (
            <>
              {" · "}
              <Link
                href="/earnings"
                className="label text-forest/70 hover:text-forest tap-target underline underline-offset-4"
              >
                Earnings →
              </Link>
              {" · "}
              <Link
                href="/payouts"
                className="label text-forest/70 hover:text-forest tap-target underline underline-offset-4"
              >
                Payout details →
              </Link>
              {" · "}
              <Link
                href="/team"
                className="label text-forest/70 hover:text-forest tap-target underline underline-offset-4"
              >
                Team access →
              </Link>
            </>
          ) : null}
        </p>

        <div className="mt-8">
          {slots.length === 0 ? (
            <Empty
              title="Nothing scheduled"
              body={
                date === today
                  ? "No departures today. If that is wrong, check your slots — a departure that is not here is one Yuvoy cannot sell."
                  : "Nothing on the books for tomorrow yet."
              }
            />
          ) : (
            <ul className="space-y-3">
              {slots.map((slot) => (
                <li key={slot.id}>
                  <Link
                    href={`/today/${slot.id}`}
                    className="rounded-edge border-cream-line bg-cream-deep hover:border-forest/30 block border p-5 transition-colors"
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-display text-2xl leading-none">
                        {marketTime(slot.startsAt, slot.timezone)}
                      </span>
                      <span className="label text-forest/70">
                        {slot.sold} of {slot.seats} sold
                      </span>
                    </div>
                    <p className="mt-2 text-base font-bold">{slot.title}</p>
                    {slot.status !== "open" ? (
                      <p className="text-terra-deep mt-1.5 text-sm font-bold">
                        {slot.status === "cancelled"
                          ? "Called off"
                          : "Closed to new bookings"}
                      </p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
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
      className={
        active
          ? "rounded-edge border-forest bg-forest text-cream dock-target border px-5 text-sm font-bold"
          : "rounded-edge border-cream-line bg-cream-deep dock-target border px-5 text-sm"
      }
    >
      {label}
    </Link>
  );
}
