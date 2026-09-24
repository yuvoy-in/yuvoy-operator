import Link from "next/link";
import { cn } from "@/lib/cn";
import type { RunDay, RunRow, RunTone } from "@/lib/home/day";
import { ButtonLink } from "@/components/ui/button";
import { ChevronRightIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";

/**
 * Today's departures, with Tomorrow one tap away (yuvoy-operator#96 block 3).
 *
 * ## One read, and a switch that needs no signal
 *
 * Both days come from the one `GET /slots` Home already makes (today to
 * tomorrow), so Tomorrow is drawn with Today and the switch between them is
 * two radio buttons and a stylesheet rule. It answers on the first tap before
 * any script has arrived, and it costs no second request on a jetty. The day
 * hidden by the switch is `display: none`, so it is out of the accessibility
 * tree too, and each day's section is named by its own heading.
 *
 * ## The heading
 *
 * "Today · 3 departures · 11 guests" is the heading's name, and so the
 * section's. On screen the day's word is already the switch above it, so the
 * counts are what is drawn.
 */
export function DaySheet({
  today,
  tomorrow,
  emptyToday,
}: {
  /** `null` when the departures did not load. */
  today: RunDay | null;
  tomorrow: RunDay | null;
  /** What an empty today says: "Nothing running today. Next: Thu 09:00." */
  emptyToday: string;
}) {
  return (
    <div className="group/day mt-8">
      <fieldset className="flex gap-2">
        <legend className="sr-only">Which day</legend>
        <DayChoice id="home-day-today" label="Today" checked />
        <DayChoice id="home-day-tomorrow" label="Tomorrow" />
      </fieldset>

      <section
        aria-labelledby="day-today"
        className="mt-4 group-has-[#home-day-tomorrow:checked]/day:hidden"
      >
        <Day id="day-today" caption="Today" day={today} empty={emptyToday} />
      </section>
      <section
        aria-labelledby="day-tomorrow"
        className="mt-4 hidden group-has-[#home-day-tomorrow:checked]/day:block"
      >
        <Day
          id="day-tomorrow"
          caption="Tomorrow"
          day={tomorrow}
          empty="Nothing running tomorrow."
        />
      </section>
    </div>
  );
}

/** One pill of the switch: a real radio, drawn as the pill around it. */
function DayChoice({
  id,
  label,
  checked = false,
}: {
  id: string;
  label: string;
  checked?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "label ease-interaction inline-flex h-11 cursor-pointer items-center rounded-full border px-5 font-bold transition-colors duration-200 select-none",
        "border-paper-line bg-paper-deep text-forest hover:border-forest/40",
        "has-[:checked]:border-forest has-[:checked]:bg-forest has-[:checked]:text-paper",
        // The radio itself is invisible, so its focus ring is drawn here.
        "has-[:focus-visible]:outline-terra-deep has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
      )}
    >
      <input
        type="radio"
        id={id}
        name="home-day"
        value={label.toLowerCase()}
        defaultChecked={checked}
        className="sr-only"
      />
      {label}
    </label>
  );
}

function Day({
  id,
  caption,
  day,
  empty,
}: {
  id: string;
  caption: string;
  day: RunDay | null;
  empty: string;
}) {
  if (day === null) {
    return (
      <>
        <h2 id={id} className="label text-forest/75">
          {caption}
        </h2>
        <p className="text-terra-deep mt-2 text-base font-bold">
          Departures did not load.
        </p>
        {/* This route is force-dynamic, so a link to itself reads again. */}
        <ButtonLink
          href="/today"
          variant="secondary"
          size="md"
          block={false}
          className="mt-3"
        >
          Try again
        </ButtonLink>
      </>
    );
  }

  return (
    <>
      {/*
        The whole heading as the name, the counts as the text: the day's word
        is already on the switch above, and a hidden span inside the heading
        is joined to the text by a different space in every engine.
      */}
      <h2 id={id} aria-label={day.heading} className="label text-forest/75">
        {day.summary}
      </h2>
      {day.rows.length === 0 ? (
        <p className="text-forest/70 mt-2 text-base">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {day.rows.map((row) => (
            <li key={row.id}>
              <DepartureRow row={row} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const TONE: Record<RunTone, string> = {
  ok: "text-forest/80",
  attention: "text-terra-deep font-bold",
  quiet: "text-forest/70",
};

/** One departure: when, what, how full, and what is still to do on it. */
function DepartureRow({ row }: { row: RunRow }) {
  return (
    <Link
      href={`/today/${row.id}`}
      className={panelClass(
        "raised",
        "ease-interaction hover:bg-paper flex items-center gap-3 px-4 py-3 transition-colors duration-200",
      )}
    >
      <span className="w-12 shrink-0 self-start pt-px text-base font-bold tabular-nums">
        {row.time}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-bold">{row.title}</span>
        <span className="mt-0.5 block text-sm">
          <span className={TONE[row.tone]}>{row.state}</span>
          {row.checkedIn ? (
            <span className="text-forest/80"> · {row.checkedIn}</span>
          ) : null}
        </span>
        {row.collect ? (
          <span className="text-terra-deep mt-0.5 block text-sm font-bold">
            {row.collect}
          </span>
        ) : null}
        {row.unchecked ? (
          <span className="text-terra-deep mt-0.5 block text-sm">
            {row.unchecked}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-right">
        <span
          aria-hidden="true"
          className="block text-base font-bold tabular-nums"
        >
          {row.sold}/{row.seats}
        </span>
        <span className="sr-only">
          {row.sold} of {row.seats} seats sold
        </span>
      </span>
      <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
    </Link>
  );
}
