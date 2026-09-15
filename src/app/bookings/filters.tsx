"use client";

import { useCallback, useEffect, useState } from "react";
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
  const [text, setText] = useState(filters.q);
  const choice = choiceFor(filters, today, tomorrow);
  const [picking, setPicking] = useState(choice === "pick");

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
      router.replace(`/bookings?${next.toString()}`, { scroll: false });
    },
    [params, view, router],
  );

  /*
    Debounced, and skipped while the box already agrees with the URL: without
    that guard, arriving on a page with `?q=asha` would immediately rewrite the
    URL to the same thing and fight the back button.
  */
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === filters.q) return;
    const id = setTimeout(() => apply({ q: trimmed }), 300);
    return () => clearTimeout(id);
  }, [text, filters.q, apply]);

  function chooseDate(value: DateChoice) {
    setPicking(value === "pick");
    if (value === "pick") return;
    apply(datesFor(value, today, tomorrow));
  }

  const picked = rangeLabel(filters);

  return (
    <div className="mt-6 space-y-3">
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
