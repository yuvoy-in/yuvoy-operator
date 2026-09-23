import { describe, it, expect } from "vitest";
import {
  MAX_SEARCH,
  anyFilter,
  choiceFor,
  datesFor,
  dayTotals,
  defaultView,
  emptyLine,
  matchesRequest,
  nothingBooked,
  pillHref,
  pillScrollLeft,
  rangeLabel,
  readFilters,
  readSearch,
  readView,
  rowName,
  type Filters,
} from "./list";
import type { BookingLine } from "@/lib/money/bookings";

const TODAY = "2026-09-15";
const TOMORROW = "2026-09-16";

function filters(over: Partial<Filters> = {}): Filters {
  return { q: "", experienceId: "", from: "", to: "", ...over };
}

function booking(over: Partial<BookingLine> = {}): BookingLine {
  return {
    id: "bkg_1",
    reference: "YV-4K2M9P7Q",
    name: "Asha Menon",
    guests: 2,
    experience: "Dawn dive",
    startsAt: "2026-09-15T01:00:00Z",
    timezone: "Asia/Kolkata",
    state: "confirmed",
    ...over,
  };
}

describe("which pill the URL asks for", () => {
  it("takes the four, and treats anything else as absent", () => {
    /*
      "Any other value is treated as absent." This arrives in a URL somebody may
      have edited or a link somebody kept, and a 400 screen for a typo in a
      query string is worse than the default pill.
    */
    expect(readView("past")).toBe("past");
    expect(readView("cancelled")).toBe("cancelled");
    expect(readView("REQUESTS")).toBeNull();
    expect(readView("everything")).toBeNull();
    expect(readView(undefined)).toBeNull();
  });
});

describe("the search text", () => {
  it("is trimmed, and never longer than the API will take", () => {
    // Over 60 is a `400` with `details.q`. Cut here rather than spent on a
    // round trip that comes back as an error nobody can act on.
    expect(readSearch("  asha  ")).toBe("asha");
    expect(readSearch("x".repeat(80))).toHaveLength(MAX_SEARCH);
    expect(readSearch(undefined)).toBe("");
  });
});

describe("the filters a URL carries", () => {
  it("drops a date that is not a date", () => {
    expect(readFilters({ from: "yesterday", to: "2026-09-20" }).from).toBe("");
  });

  it("drops a range that runs backwards, whole", () => {
    /*
      Both halves, not one. The API refuses neither field alone, so keeping
      `from` would quietly show a different range from the one the control says
      is set.
    */
    const f = readFilters({ from: "2026-09-20", to: "2026-09-12" });
    expect(f.from).toBe("");
    expect(f.to).toBe("");
  });

  it("knows when something is narrowing the list", () => {
    expect(anyFilter(filters())).toBe(false);
    expect(anyFilter(filters({ q: "asha" }))).toBe(true);
    expect(anyFilter(filters({ from: TODAY }))).toBe(true);
  });
});

describe("the date choices", () => {
  it("counts the next seven days inclusively", () => {
    // Today plus six, which is what "next 7 days" means to somebody planning a
    // week: seven days of trips, starting with today's.
    expect(datesFor("next7", TODAY, TOMORROW)).toEqual({
      from: "2026-09-15",
      to: "2026-09-21",
    });
  });

  it("sends nothing at all for Any date", () => {
    expect(datesFor("any", TODAY, TOMORROW)).toEqual({ from: "", to: "" });
  });

  it("reads a pair of dates back as the choice it was", () => {
    /*
      Derived from the dates rather than stored beside them: two sources for one
      fact drift, and the dates are the half the API reads.
    */
    expect(choiceFor(filters(), TODAY, TOMORROW)).toBe("any");
    expect(
      choiceFor(filters({ from: TODAY, to: TODAY }), TODAY, TOMORROW),
    ).toBe("today");
    expect(
      choiceFor(filters({ from: TOMORROW, to: TOMORROW }), TODAY, TOMORROW),
    ).toBe("tomorrow");
    expect(
      choiceFor(filters({ from: TODAY, to: "2026-09-21" }), TODAY, TOMORROW),
    ).toBe("next7");
    // Anything else is what it was: a range somebody picked.
    expect(
      choiceFor(
        filters({ from: "2026-09-12", to: "2026-09-20" }),
        TODAY,
        TOMORROW,
      ),
    ).toBe("pick");
  });

  it("reads a picked range the way the issue writes it", () => {
    expect(rangeLabel(filters({ from: "2026-09-12", to: "2026-09-20" }))).toBe(
      "12 Sep to 20 Sep",
    );
    // One day is one day, not "12 Sep to 12 Sep".
    expect(rangeLabel(filters({ from: "2026-09-12", to: "2026-09-12" }))).toBe(
      "12 Sep",
    );
    expect(rangeLabel(filters())).toBeNull();
  });
});

describe("which pill opens by default", () => {
  it("is Requests whenever any are waiting, even beside a busy Upcoming", () => {
    // A request has a clock on it and a traveller behind it; nothing else on
    // this screen expires, so pill order keeps it first.
    expect(
      defaultView({ requests: 2, upcoming: 14, past: 120, cancelled: 6 }),
    ).toBe("requests");
  });

  it("is the first pill with anything in it, never an empty one", () => {
    /*
      yuvoy-operator#83 s4: the screen opened on "Upcoming 0" while Past held
      ten, which is a blank screen as the first thing an operator sees.
    */
    expect(
      defaultView({ requests: 0, upcoming: 0, past: 10, cancelled: 6 }),
    ).toBe("past");
    expect(
      defaultView({ requests: 0, upcoming: 0, past: 0, cancelled: 3 }),
    ).toBe("cancelled");
    expect(
      defaultView({ requests: 0, upcoming: 4, past: 10, cancelled: 3 }),
    ).toBe("upcoming");
  });

  it("is Upcoming when every pill is empty, where the next booking lands", () => {
    expect(
      defaultView({ requests: 0, upcoming: 0, past: 0, cancelled: 0 }),
    ).toBe("upcoming");
  });
});

describe("a business with nothing booked at all", () => {
  it("is every pill at zero, and only that", () => {
    expect(
      nothingBooked({ requests: 0, upcoming: 0, past: 0, cancelled: 0 }),
    ).toBe(true);
    expect(
      nothingBooked({ requests: 0, upcoming: 0, past: 0, cancelled: 1 }),
    ).toBe(false);
    expect(
      nothingBooked({ requests: 1, upcoming: 0, past: 0, cancelled: 0 }),
    ).toBe(false);
  });
});

describe("scrolling the selected pill into view", () => {
  it("leaves the row at the start for a pill that already fits", () => {
    expect(pillScrollLeft(24, 120, 360, 640)).toBe(0);
  });

  it("centres a pill that starts off screen", () => {
    // Cancelled at 480px on a 360px row: centred is 480 - (360 - 140) / 2.
    expect(pillScrollLeft(480, 140, 360, 800)).toBe(370);
  });

  it("never scrolls past the end of the row", () => {
    // Centring the last pill would ask for 390, and the row ends at 280.
    expect(pillScrollLeft(500, 140, 360, 640)).toBe(280);
  });

  it("does nothing on a row that does not scroll", () => {
    expect(pillScrollLeft(480, 140, 900, 700)).toBe(0);
  });
});

describe("a day's header line", () => {
  it("does not say 1 bookings or 1 guests", () => {
    expect(dayTotals([booking({ guests: 1 })])).toBe("1 booking · 1 guest");
    expect(dayTotals([booking({ guests: 2 }), booking({ guests: 5 })])).toBe(
      "2 bookings · 7 guests",
    );
  });
});

describe("what a row calls the person", () => {
  it("falls back to the reference rather than showing a blank", () => {
    // A row with no name is still a booking somebody has to meet at a jetty,
    // and the reference is what the traveller is holding.
    expect(rowName(booking({ name: "  " }))).toBe("YV-4K2M9P7Q");
    expect(rowName(booking())).toBe("Asha Menon");
  });
});

describe("what an empty pill says", () => {
  it("tells a search that found nothing from a pill that is empty", () => {
    /*
      Different sentences for different situations. "No past bookings" to
      somebody who has searched reads as a broken search, and "no bookings
      match" to somebody who has not reads as a fault.
    */
    expect(emptyLine("past", false)).toBe("No past bookings");
    expect(emptyLine("past", true)).toBe("No bookings match");
    expect(emptyLine("requests", false)).toBe("No requests waiting");
    expect(emptyLine("requests", true)).toBe("No requests match");
  });
});

describe("filtering the requests, which the API cannot do for us", () => {
  const request = {
    contactName: "Asha Menon",
    experienceId: "exp_dive",
    startsAt: "2026-09-15T01:00:00Z",
    timezone: "Asia/Kolkata",
  };

  it("matches a name by any part of it, case ignored", () => {
    expect(matchesRequest(request, filters({ q: "men" }))).toBe(true);
    expect(matchesRequest(request, filters({ q: "ASHA" }))).toBe(true);
    expect(matchesRequest(request, filters({ q: "priya" }))).toBe(false);
  });

  it("never matches a reference, because a request has none", () => {
    /*
      The API counts `counts.requests` "by name only", and the rows under the
      pill have to agree with the badge above them. A portal that also matched
      something reference-shaped would show rows the count did not include.
    */
    expect(matchesRequest(request, filters({ q: "YV-4K2M" }))).toBe(false);
  });

  it("matches a listing by id and never by title", () => {
    // Two listings may be called the same thing, and a title is a label
    // somebody can edit.
    expect(matchesRequest(request, filters({ experienceId: "exp_dive" }))).toBe(
      true,
    );
    expect(
      matchesRequest(request, filters({ experienceId: "exp_snorkel" })),
    ).toBe(false);
  });

  it("matches the trip's own market day, not the device's", () => {
    // 06:30 in Havelock is the evening before in UTC, and the operator reading
    // this is in Havelock.
    expect(matchesRequest(request, filters({ from: TODAY, to: TODAY }))).toBe(
      true,
    );
    expect(
      matchesRequest(request, filters({ from: TOMORROW, to: TOMORROW })),
    ).toBe(false);
  });

  it("drops a request whose time cannot be read, rather than showing it anyway", () => {
    // The badge counts by trip day; a row the count cannot have included would
    // make the two disagree.
    expect(
      matchesRequest({ ...request, startsAt: "" }, filters({ from: TODAY })),
    ).toBe(false);
  });
});

describe("the link on a pill", () => {
  it("keeps whatever is narrowing the list", () => {
    // Switching pills must not silently drop a search: the badges said how many
    // matches each pill holds, and tapping one has to show those.
    expect(
      pillHref("past", filters({ q: "asha", experienceId: "exp_dive" })),
    ).toBe("/bookings?view=past&q=asha&experienceId=exp_dive");
  });

  it("carries nothing it does not have", () => {
    expect(pillHref("upcoming", filters())).toBe("/bookings?view=upcoming");
  });
});
