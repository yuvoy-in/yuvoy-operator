import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import { listSlots } from "@/lib/day/manifest";
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

  const { today, tomorrow } = await marketDays();
  // Only ever today or tomorrow from the UI, but the value arrives in a URL,
  // so it is validated rather than trusted.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? day! : today;
  const slots = await listSlots(token, date, date);

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

        <nav className="mt-6 flex gap-2" aria-label="Which day">
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
