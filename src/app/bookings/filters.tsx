"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DATE_CHOICES,
  MAX_SEARCH,
  anyFilter,
  choiceFor,
  datesFor,
  rangeLabel,
  type DateChoice,
  type Filters,
} from "@/lib/bookings/list";
import { inputClass } from "@/components/ui/input";
import { useChangedBeforeHydration } from "@/components/ui/use-changed-before-hydration";
import { useRowsNavigation } from "./pill-row";

/**
 * The search box, the two filters and Clear — yuvoy-operator#57 items 4 to 6.
 *
 * ## Everything goes in the URL
 *
 * "The URL carries `view`, `q`, `experienceId`, `from` and `to`, so back and
 * refresh restore the same pill, search and filters." That is not tidiness: an
 * operator opens a booking from a search, presses back, and has to land on the
 * search rather than at the top of an unfiltered list.
 *
 * It also means the reads happen on the server, which is where the search
 * belongs: the counts on the pills are totals, not counts of what a page
 * loaded.
 *
 * ## The search is debounced, and `replace` rather than `push`
 *
 * 300 ms, so a five-letter name is one request rather than five. `replace`
 * because every keystroke would otherwise be a history entry, and back from a
 * booking would walk letter by letter out of a word somebody typed.
 *
 * ## The rows say they are waiting for it
 *
 * Every change of the address runs in the transition the pills' rows watch
 * (`useRowsNavigation`), so a search on one bar of signal dims the old rows
 * after 300ms, as a pill's tap does, rather than leaving them looking like
 * the answer (the stability audit, P3-2).
 */
export function BookingFilters({
  filters,
  view,
  today,
  tomorrow,
  listings,
}: {
  filters: Filters;
  /** Kept as the pill changes: Clear removes the filters, never the pill. */
  view: string;
  today: string;
  tomorrow: string;
  listings: { id: string; title: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const navigate = useRowsNavigation();
  const [text, setText] = useState(filters.q);
  const choice = choiceFor(filters, today, tomorrow);
  const [picking, setPicking] = useState(choice === "pick");

  /*
    The address is the truth, and this box only borrows it.

    The screen stays mounted when the address changes underneath it, and the
    box and the date pickers were seeded once. So the empty state's Clear, a
    link, emptied the address and the box kept "asha", and the debounce below
    put it back 300ms later: Clear undid itself (the stability audit, P1-2).
    The date pickers stayed open over a range that had gone the same way.

    So the box follows any search the address arrives with that the box did
    not send (Clear, back, a link). What it did send coming back is only the
    address catching up with typing, and is left alone: a newer navigation
    discards an older one, so the address never goes back to an earlier
    send. The pickers follow every change of dates, since a range picked
    here comes back as "pick" anyway. Both are compared with the last render
    as state, the pattern the pills use for the address they answered.
  */
  const [sent, setSent] = useState(filters.q);
  const [seen, setSeen] = useState(filters);
  if (
    filters.q !== seen.q ||
    filters.from !== seen.from ||
    filters.to !== seen.to
  ) {
    setSeen(filters);
    if (filters.q !== seen.q && filters.q !== sent) {
      setSent(filters.q);
      if (filters.q !== text.trim()) setText(filters.q);
    }
    if (filters.from !== seen.from || filters.to !== seen.to) {
      setPicking(choice === "pick");
    }
  }

  /**
   * Rewrite the URL with these changes, dropping any page already loaded.
   *
   * "Changing the search, a filter or the pill drops any 'Show more' pages and
   * reads page one again" — a cursor belongs to the query it was issued for,
   * and the API refuses one sent with another.
   *
   * `useCallback` because the debounce effect below depends on it, and a fresh
   * function every render would restart the timer on every keystroke's
   * re-render rather than on the keystroke.
   */
  const apply = useCallback(
    (changes: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (view) next.set("view", view);
      navigate(() =>
        router.replace(`/bookings?${next.toString()}`, { scroll: false }),
      );
    },
    [params, view, router, navigate],
  );

  /*
    Debounced, and skipped while the box already agrees with the URL: without
    that guard, arriving on a page with `?q=asha` would immediately rewrite the
    URL to the same thing and fight the back button.
  */
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === filters.q) return;
    const id = setTimeout(() => {
      setSent(trimmed);
      apply({ q: trimmed });
    }, 300);
    return () => clearTimeout(id);
  }, [text, filters.q, apply]);

  /** The address change a date choice makes: none for "pick", yet. */
  function datesChosen(value: DateChoice): Record<string, string> {
    setPicking(value === "pick");
    return value === "pick" ? {} : datesFor(value, today, tomorrow);
  }

  function chooseDate(value: DateChoice) {
    const changes = datesChosen(value);
    if (Object.keys(changes).length > 0) apply(changes);
  }

  /*
    Searched or filtered before the page hydrated: on a slow link the bar is
    there for seconds before its script. Taken as one change, so a listing
    and a date picked in that time land in one address.

    Dates typed by hand outrank a date choice changed with them. Without a
    script the choice hides nothing, so both can change, and taking the
    choice would hide the very fields somebody typed into. The choice follows
    the dates instead, as it does for any range (it reads "pick").
  */
  const bar = useRef<HTMLDivElement>(null);
  useChangedBeforeHydration(bar, (changed) => {
    const changes: Record<string, string> = {};
    let chosen: DateChoice | null = null;
    for (const field of changed) {
      if (field.id === "booking-search") setText(field.value);
      if (field.id === "booking-listing") changes.experienceId = field.value;
      if (field.id === "booking-dates") chosen = field.value as DateChoice;
      if (field.id === "booking-from") changes.from = field.value;
      if (field.id === "booking-to") changes.to = field.value;
    }
    if (chosen && !("from" in changes) && !("to" in changes)) {
      Object.assign(changes, datesChosen(chosen));
    }
    if (Object.keys(changes).length > 0) apply(changes);
  });

  const picked = rangeLabel(filters);

  return (
    <div ref={bar} className="mt-6 space-y-3">
      <div>
        <label htmlFor="booking-search" className="sr-only">
          Guest name or booking reference
        </label>
        <input
          id="booking-search"
          type="search"
          value={text}
          maxLength={MAX_SEARCH}
          onChange={(e) => setText(e.target.value)}
          /*
            No phone, and the word does not appear (D-018). "A traveller gives
            us a number so we can tell them about their booking, not so it can
            be added to an operator's contacts" — a placeholder offering to
            search by one would promise a capability this portal must not have.
          */
          placeholder="Guest name or booking reference"
          className={inputClass()}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="booking-listing" className="sr-only">
          Which listing
        </label>
        <select
          id="booking-listing"
          value={filters.experienceId}
          onChange={(e) => apply({ experienceId: e.target.value })}
          className={inputClass("h-11 w-auto min-w-40 pr-8")}
        >
          <option value="">All listings</option>
          {listings.map((listing) => (
            <option key={listing.id} value={listing.id}>
              {listing.title}
            </option>
          ))}
        </select>

        <label htmlFor="booking-dates" className="sr-only">
          Which dates
        </label>
        <select
          id="booking-dates"
          value={choice}
          onChange={(e) => chooseDate(e.target.value as DateChoice)}
          className={inputClass("h-11 w-auto min-w-32 pr-8")}
        >
          {DATE_CHOICES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value === "pick" && picked ? picked : option.label}
            </option>
          ))}
        </select>

        {/*
          Drawn only while something is set. A Clear that is always there is a
          control that does nothing most of the time, and an operator learns to
          ignore it.
        */}
        {anyFilter(filters) ? (
          <button
            type="button"
            onClick={() => {
              setText("");
              setSent("");
              setPicking(false);
              apply({ q: "", experienceId: "", from: "", to: "" });
            }}
            className="text-terra-deep tap-target text-sm font-bold underline underline-offset-4"
          >
            Clear
          </button>
        ) : null}
      </div>

      {picking ? (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="booking-from" className="label text-forest/75">
              From
            </label>
            <input
              id="booking-from"
              type="date"
              value={filters.from}
              onChange={(e) => apply({ from: e.target.value })}
              className={inputClass("mt-1 h-11 w-auto")}
            />
          </div>
          <div>
            <label htmlFor="booking-to" className="label text-forest/75">
              To
            </label>
            <input
              id="booking-to"
              type="date"
              /*
                The second cannot be before the first, and the browser is told
                so rather than the screen correcting it afterwards: a range that
                runs backwards is dropped whole by `readFilters`, and an
                operator watching both dates vanish would not know which one was
                wrong.
              */
              min={filters.from || undefined}
              value={filters.to}
              onChange={(e) => apply({ to: e.target.value })}
              className={inputClass("mt-1 h-11 w-auto")}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
