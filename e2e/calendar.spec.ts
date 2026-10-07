import { test, expect, type Locator, type Page } from "@playwright/test";
import { expectAccessible } from "./axe";

/**
 * O9's capacity half — the single most important number in the system.
 *
 * The assertions here are all about refusals, because that is what this screen
 * is for. A capacity screen that only proves you can raise a number has proved
 * nothing: the failure it exists to prevent is a boat leaving with people
 * still on the jetty.
 */

const DEV_CODE = "424242";

async function signInAs(page: Page, phone: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

async function signIn(page: Page) {
  await signInAs(page, "+919000000101");
}

/** A market day `n` days from today, the way the fixtures build them. */
function marketDay(offset: number): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600_000 + offset * 86_400_000);
  return ist.toISOString().slice(0, 10);
}

/**
 * What the day's own region is called on screen.
 *
 * Every day past tomorrow is captioned with its written-out date, so the label
 * has to be built the same way `dayCaption` does rather than guessed at. Today
 * and tomorrow have names of their own and are not used by these tests: both
 * carry fixtures other suites depend on.
 */
function dayLabel(offset: number): string {
  const day = marketDay(offset);
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${day}T06:00:00+05:30`));
}

/**
 * A departure per project: capacity writes mutate shared server state. With
 * the day it sits on, because a departure is inside its day until the day is
 * opened (yuvoy-operator#84 s7).
 */
function mySlot(name: string) {
  return name === "mobile"
    ? { title: "Try-dive at Nemo Reef", day: 0 }
    : { title: "Snorkel trip to Elephant Beach", day: 1 };
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Thu 8 Oct": a day as the board's grid names it, from fixed tables. */
function shortDay(offset: number): string {
  const [y, m, d] = marketDay(offset).split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAY[weekday]} ${d} ${MONTH[m - 1]}`;
}

/** What the open day's region is called: Today, Tomorrow, or the date. */
function dayName(offset: number): string {
  return offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : dayLabel(offset);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One day on the board, opened by its address: the board's whole state is
 * the URL (week, day, open departure), so a test goes where a pasted link
 * goes. Returns the day's region: what is on it, its closures and its own
 * actions (and, on a phone, its departures).
 */
async function openDay(page: Page, offset: number): Promise<Locator> {
  await page.goto(`/calendar?day=${marketDay(offset)}`);
  const day = page.getByRole("region", { name: dayName(offset), exact: true });
  await expect(day).toBeVisible();
  return day;
}

/**
 * A departure on a day, by its accessible name: the grid's cell on a desktop
 * ("Thu 8 Oct, 09:00 Try-dive, 5 of 8 sold"), the day's row on a phone
 * ("09:00 Try-dive, 5 of 8 sold"). Only the one drawn for the viewport is in
 * the accessibility tree, so one locator serves both projects.
 */
function departureOn(
  page: Page,
  offset: number,
  title: string,
  time?: string,
): Locator {
  const at = time ? escape(time) : "\\d\\d:\\d\\d";
  return page.getByRole("link", {
    name: new RegExp(
      `^(${escape(shortDay(offset))}, )?${at} ${escape(title)},`,
    ),
  });
}

/**
 * A departure opened into the inspector (the first by that title on that
 * day, which is the earliest: the day is in time order), and the inspector
 * returned: its seats, sales, counter sale, stopping it, and who is on it.
 */
async function openDeparture(
  page: Page,
  offset: number,
  title: string,
  time?: string,
): Promise<Locator> {
  await openDay(page, offset);
  await departureOn(page, offset, title, time).first().click();
  const inspector = page.getByRole("dialog");
  await expect(inspector).toBeVisible();
  return inspector;
}

/**
 * The day's own marks, under its name: what is on it, "N not on sale",
 * "Closed". Not the departures' chips: on a phone the day also lists them,
 * and a stopped departure says Closed too.
 */
function dayMarks(day: Locator): Locator {
  return day.locator(":scope > p").first();
}

/** Puts the inspector away, the way a thumb does: its Close. */
async function closeInspector(page: Page) {
  const inspector = page.getByRole("dialog");
  await inspector.getByRole("button", { name: "Close" }).click();
  await expect(inspector).toHaveCount(0);
}

/**
 * A listing and a free day per project, for the same reason `mySlot` exists.
 *
 * Departures created by `POST /slots` live in the same shared mock state, and
 * the endpoint is idempotent per listing + start time — so two projects adding
 * the same trip on the same day at the same time would have one of them
 * legitimately told "nothing to add" and fail a test about creating things.
 * Different listing, different day, different time: no contention, and none of
 * these collide with a fixture departure.
 */
function myListing(name: string) {
  return name === "mobile"
    ? { title: "Try-dive at Nemo Reef", offsetDays: 9, time: "08:15" }
    : {
        title: "Snorkel trip to Elephant Beach",
        offsetDays: 11,
        time: "08:45",
      };
}

/** `YYYY-MM-DD`, n days after the market's today. Built in UTC, as dates are. */
function dayAfter(today: string, n: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** A weekday name that today is not, so a stale filter cannot match by luck. */
function OTHER_WEEKDAY(today: string): string {
  const names = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const dow = new Date(Date.parse(`${today}T00:00:00Z`)).getUTCDay();
  return names[(dow + 3) % 7];
}

/** Opens the add-departures form and returns the market's today off it. */
async function openAddDepartures(page: Page): Promise<string> {
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Add departures" }).click();
  const first = page.getByLabel("First day");
  await expect(first).toBeVisible();
  return (await first.inputValue()) || "";
}

test("the bar links to the Calendar, and the board opens on this week", async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByRole("navigation", { name: /Primary/i })
    .first()
    .getByRole("link", { name: "Calendar" })
    .click();
  await page.waitForURL("**/calendar");
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  /*
    `.first()`, because a departure is no longer a fixture-only thing. The
    create test below adds one to this same listing, and the mock's state is
    shared across projects, so "the board shows this trip" is what this
    asserts, not "exactly once". Today is open by default.
  */
  await expect(
    page.getByRole("heading", { name: "This week", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Today", exact: true }),
  ).toBeVisible();
  await expect(
    departureOn(page, 0, "Try-dive at Nemo Reef").first(),
  ).toBeVisible();
});

test("seats cannot go below what is already sold", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/calendar");

  /*
    The earliest matching row on its day, and that is deterministic: departures
    are sorted by start time and anything the create test adds is days later
    than the fixtures. Opened, because its seat box is inside it.
  */
  const mine = mySlot(testInfo.project.name);
  const row = await openDeparture(page, mine.day, mine.title);
  const field = row.getByLabel("Seats offered");

  // slot_dawn has 5 sold of 8; slot_late_morning has 1 of 12.
  await field.fill("0");
  await row.getByRole("button", { name: "Set seats" }).click();

  /*
    "Not 'should not' — the database refuses it, because the alternative is a
    traveller with a paid booking and no seat, discovered at a jetty at six in
    the morning."
  */
  await expect(row.getByRole("alert")).toContainText("already sold");
  // And it names the number to type instead, rather than only refusing.
  await expect(row.getByRole("alert")).toContainText("exactly");
});

test("reducing to exactly what is sold is allowed", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/calendar");

  const mine = mySlot(testInfo.project.name);
  const row = await openDeparture(page, mine.day, mine.title);
  const sold = testInfo.project.name === "mobile" ? "5" : "1";

  await row.getByLabel("Seats offered").fill(sold);
  await row.getByRole("button", { name: "Set seats" }).click();

  // That closes the departure without stranding anyone: the operator's way
  // out of a full boat, and the one reduction the API permits.
  await expect(row.getByText(`Now offering ${sold}.`)).toBeVisible();
  await expect(row.getByRole("alert")).toHaveCount(0);

  /*
    And the departure itself now says so, with the inspector still open: the
    action revalidates the board, and the receipt is read where it was made.
    For a month the mock's reads ignored its writes, and "Now offering 5."
    rendered beside "5 of 8 sold · 3 left".
  */
  await expect(
    row.getByText(new RegExp(`${sold} of ${sold} sold`)),
  ).toBeVisible();
});

test("closing dates says plainly that it did not cancel anybody", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/calendar");

  await page
    .getByRole("button", { name: "Close dates to new bookings" })
    .click();
  /*
    Its own day, twelve out, carrying one confirmed party. This used to close
    TODAY, which was harmless only while the mock read nothing back from a
    closure; now a closed day reads as closed, and closing today would take
    the day screen's departures off sale under every other test.
  */
  const today = await page.getByLabel("First day").inputValue();
  await page.getByLabel("First day").fill(dayAfter(today, 12));
  await page.getByLabel("Last day").fill(dayAfter(today, 12));
  await page.getByRole("radio", { name: "Weather" }).check();
  await page.getByRole("button", { name: "Close them" }).click();

  /*
    "An operator who assumes closing the calendar cancelled the bookings will
    simply not turn up." Today has departures with bookings on them, so the
    owed count must be stated rather than a tick shown.
  */
  await expect(
    page.getByText("Those dates are closed to new bookings", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/You still owe \d+ booking/)).toBeVisible();
  await expect(page.getByText("did not cancel them")).toBeVisible();
});

test("an oversell is never rendered as a success", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/calendar");

  const mine = mySlot(testInfo.project.name);
  const row = await openDeparture(page, mine.day, mine.title);
  await row.getByRole("button", { name: "I sold seats at my counter" }).click();

  // Far more than the boat holds, on purpose.
  await row.getByLabel("Seats you sold at your counter").fill("50");
  await row.getByRole("button", { name: "Record it" }).click();

  /*
    "This is the one endpoint in the portal that deliberately refuses to be
    reassuring: an operator who taps 'I sold 3 at the counter' and sees a
    cheerful tick has not understood what they did to three people who paid
    us."
  */
  await expect(row.getByText("This oversold the departure")).toBeVisible();
  // The API's own words are rendered rather than replaced: it names how many
  // people are affected, which a generic "oversold" would lose.
  await expect(
    row.getByText(/paid for a seat that no longer exists/),
  ).toBeVisible();
  await expect(row.getByText(/Incident inc_/)).toBeVisible();
  // The sale still stands — refusing it would not un-sell the seats.
  await expect(row.getByText("The sale was still recorded")).toBeVisible();
  // And emphatically NOT the success wording.
  await expect(row.getByText(/recorded at your counter$/)).toHaveCount(0);

  /*
    A mistyped 50 can be taken back (yuvoy-api#226), and the question says the
    incident is not withdrawn by it. Taking it back also leaves the shared mock
    as this test found it, so no other test on this departure meets 50 seats
    that were never sold.
  */
  await row.getByRole("button", { name: "That was a mistake" }).click();
  await expect(
    row.getByText(/The incident stays open until we close it/),
  ).toBeVisible();
  await row.getByRole("button", { name: "Take them back" }).click();
  await expect(
    row.getByText("50 seats taken back and on sale again"),
  ).toBeVisible();
  await expect(row.getByText(/stays open until we close it\./)).toBeVisible();

  // The second walk-up sale of the morning does not need a navigation: the
  // receipt offers a fresh form.
  await row.getByRole("button", { name: "Record another sale" }).click();
  await expect(row.getByLabel("Seats you sold at your counter")).toBeVisible();
});

test("a counter sale is named on its departure, and a mistake is taken back", async ({
  page,
}, testInfo) => {
  /*
    yuvoy-api#226 and op#89 f12. A counter sale comes off the departure's
    seats, so the departure has to say who took them, on every read and not
    only in the receipt; and a wrong count has to be correctable.

    Its OWN departure, made here: counter sales are shared mock state, and the
    fixture departures already carry seat tests that read exact numbers. One
    day and time per project, and a retry finds the departure it already made
    ("Nothing to add" is the same departure, not a failure).

    +2 and +4: the days nothing else reads. +3 must stay empty for "fourteen
    days", +5 and +6 for the closed-day test, and the rest carry fixtures or
    other tests' departures.
  */
  test.setTimeout(60_000);
  await signIn(page);
  const mobile = testInfo.project.name === "mobile";
  const offset = mobile ? 2 : 4;
  const time = mobile ? "07:05" : "07:35";
  const title = mobile
    ? "Try-dive at Nemo Reef"
    : "Snorkel trip to Elephant Beach";

  const today = await openAddDepartures(page);
  const day = dayAfter(today, offset);
  await page.getByLabel("Which listing").selectOption({ label: title });
  await page.getByLabel("First day").fill(day);
  await page.getByLabel("Last day").fill(day);
  await page.getByRole("textbox", { name: "Departure time 1" }).fill(time);
  await page.getByLabel("Seats on each departure").fill("6");
  await page.getByRole("button", { name: "Add 1 departure" }).click();
  await expect(
    page.getByText(/1 departure added|Nothing to add/).first(),
  ).toBeVisible();

  const row = await openDeparture(page, offset, title, time);
  const line = row.getByText(/ sold · \d+ left/).first();
  await expect(line).not.toContainText("sold at your counter");

  await row.getByRole("button", { name: "I sold seats at my counter" }).click();
  await row.getByLabel("Seats you sold at your counter").fill("2");
  await row.getByRole("button", { name: "Record it" }).click();
  await expect(row.getByText("2 recorded at your counter")).toBeVisible();
  // The departure's own line, re-read from the server, says it too: the six
  // seats read as four with the two walk-ups named.
  await expect(line).toContainText(
    "0 of 4 sold · 4 left · 2 sold at your counter",
  );

  await row.getByRole("button", { name: "That was a mistake" }).click();
  await expect(
    row.getByText("Take back the 2 seats you just recorded?"),
  ).toBeVisible();
  await row.getByRole("button", { name: "Take them back" }).click();
  await expect(
    row.getByText("2 seats taken back and on sale again"),
  ).toBeVisible();
  await expect(line).toContainText("0 of 6 sold · 6 left");
  await expect(line).not.toContainText("sold at your counter");
});

/**
 * O9's missing half — `POST /slots`, yuvoy-in/yuvoy-operator#16.
 *
 * Until it landed, an operator wanting a Saturday morning trip had to ask
 * somebody at Yuvoy: the screen could change how many seats an existing
 * departure held and close a date, and nothing more.
 */
test("the number of departures is on the button before anything is sent", async ({
  page,
}) => {
  /*
    The guard this form is shaped around. `POST /slots` creates the cross
    product of a range and a list of times, so "next Saturday at seven" and "a
    departure every day for a fortnight" are one untouched date field apart —
    and Yuvoy sells a seat on every one it makes. A confirmation dialog would
    only have the operator confirm the same misunderstanding.
  */
  await signIn(page);
  const today = await openAddDepartures(page);

  // One day, one time.
  await expect(
    page.getByRole("button", { name: "Add 1 departure" }),
  ).toBeVisible();

  // A fortnight, same time: fourteen, said before the press.
  await page.getByLabel("Last day").fill(dayAfter(today, 13));
  await expect(
    page.getByRole("button", { name: "Add 14 departures" }),
  ).toBeVisible();

  // Two times a day across that fortnight: twenty-eight.
  await page.getByRole("button", { name: "Add another time" }).click();
  await page.getByRole("textbox", { name: "Departure time 2" }).fill("14:00");
  await expect(
    page.getByRole("button", { name: "Add 28 departures" }),
  ).toBeVisible();

  /*
    Saturdays only. Exactly two fall in any fourteen-day window, whatever day
    the window opens on — which is why this can be asserted without knowing
    what today is.
  */
  await page.getByRole("button", { name: "Remove departure time 2" }).click();
  await page.getByRole("checkbox", { name: "Saturday" }).check();
  await expect(
    page.getByRole("button", { name: "Add 2 departures" }),
  ).toBeVisible();
});

test("a weekday nothing in the range matches is refused, not sent", async ({
  page,
}) => {
  /*
    The API would answer `created: 0` for this, which is indistinguishable from
    "they already existed". So the difference is caught here, where it can
    still be explained.
  */
  await signIn(page);
  const today = await openAddDepartures(page);

  // A Monday-to-Wednesday range, asking for Saturdays.
  const monday = (() => {
    let d = Date.parse(`${today}T00:00:00Z`);
    while (new Date(d).getUTCDay() !== 1) d += 86_400_000;
    return new Date(d).toISOString().slice(0, 10);
  })();
  await page.getByLabel("First day").fill(monday);
  await page.getByLabel("Last day").fill(dayAfter(monday, 2));
  await page.getByRole("checkbox", { name: "Saturday" }).check();

  await expect(page.getByText(/nothing to add/i)).toBeVisible();
});

test("the preview cannot say one thing while the form sends another", async ({
  page,
}) => {
  /*
    Three ways the count on the button and the body actually posted came apart,
    each found by reading the form rather than by a failure:

    1. Weekday chips only exist while the range spans days. Narrowing back to
       one day unmounted their inputs while this component still held what was
       ticked — so the preview filtered by a weekday the form was no longer
       sending.
    2. A cleared number field submits "", and `z.coerce.number()` reads "" as
       zero. `cutoffHours` emptied would have become "bookings close 0 hours
       before departure" rather than the default.
    3. An empty time input was dropped server-side, so the server would have
       created fewer departures than the operator was shown a count for.
  */
  await signIn(page);
  const today = await openAddDepartures(page);

  /*
    1. Pick a weekday over a range, then collapse the range to one day.

    The weekday must be one today is NOT, or the stale filter still matches and
    the test passes against the bug. Written the other way round first, on a
    Saturday, asserting "Saturday" — and it passed with the fix reverted.
  */
  const other = OTHER_WEEKDAY(today);
  await page.getByLabel("Last day").fill(dayAfter(today, 13));
  await page.getByRole("checkbox", { name: other }).check();
  // Any single weekday falls exactly twice in a fourteen-day window.
  await expect(
    page.getByRole("button", { name: "Add 2 departures" }),
  ).toBeVisible();

  await page.getByLabel("Last day").fill(today);
  await expect(page.getByRole("checkbox", { name: other })).toHaveCount(0);
  /*
    One departure, whatever today's weekday is. Before the fix this read
    "nothing to add" on six days out of seven — a refusal of a plan the server
    would have created.
  */
  await expect(
    page.getByRole("button", { name: "Add 1 departure" }),
  ).toBeVisible();

  // 3. A half-typed second time is refused, not quietly dropped.
  await page.getByRole("button", { name: "Add another time" }).click();
  await expect(page.getByText("Times look like 07:00.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Add \d+/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Remove departure time 2" }).click();
  await expect(
    page.getByRole("button", { name: "Add 1 departure" }),
  ).toBeVisible();
});

test("a departure is created, appears in the list, and is not created twice", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await signIn(page);
  const mine = myListing(testInfo.project.name);
  const today = await openAddDepartures(page);
  const day = dayAfter(today, mine.offsetDays);

  await page.getByLabel("Which listing").selectOption({ label: mine.title });
  await page.getByLabel("First day").fill(day);
  await page.getByLabel("Last day").fill(day);
  await page.getByRole("textbox", { name: "Departure time 1" }).fill(mine.time);
  await page.getByLabel("Seats on each departure").fill("6");

  await page.getByRole("button", { name: "Add 1 departure" }).click();
  await expect(page.getByText("1 departure added")).toBeVisible();

  // It is on the board, read back from the server rather than assumed: on
  // its own day, in whichever week that is.
  await openDay(page, mine.offsetDays);
  await expect(
    departureOn(page, mine.offsetDays, mine.title, mine.time),
  ).toHaveCount(1);

  /*
    And asking again does not sell the same boat twice. "Dates that already
    have a departure at that time are left alone, so `created: 0` is a
    legitimate answer and not a failure" — which the screen has to say as a
    no-op rather than as an error, or an operator told "nothing was added"
    reasonably tries again.
  */
  await page.getByRole("button", { name: "Add departures" }).click();
  await page.getByLabel("Which listing").selectOption({ label: mine.title });
  await page.getByLabel("First day").fill(day);
  await page.getByLabel("Last day").fill(day);
  await page.getByRole("textbox", { name: "Departure time 1" }).fill(mine.time);
  await page.getByRole("button", { name: "Add 1 departure" }).click();

  await expect(page.getByText("Nothing to add")).toBeVisible();
  await expect(page.getByText(/never sells the same boat twice/)).toBeVisible();
  // Still one, not two.
  await openDay(page, mine.offsetDays);
  await expect(
    departureOn(page, mine.offsetDays, mine.title, mine.time),
  ).toHaveCount(1);
});

test("a departure says whether its seats are held, and says nothing when it does not know", async ({
  page,
}) => {
  /*
    `bookingMode` is per departure, not per listing — "a listing can carry
    both". It changes what `remaining` means: on an `allotment` departure it is
    seats Yuvoy holds; on a `request` one nothing is held until the operator
    answers. A row without the field must say NEITHER, because defaulting to
    `allotment` would promise held seats on a departure holding none.
  */
  await signIn(page);

  // Said as a fact inside the opened departure, not as a paragraph on every one.
  const held = await openDeparture(page, 0, "Try-dive at Nemo Reef");
  await expect(held).toContainText("Instant booking");

  const asked = await openDeparture(page, 1, "Snorkel trip to Elephant Beach");
  await expect(asked).toContainText("You answer each request");

  // The charter fixture carries no mode. The departure says nothing either way.
  await openDay(page, 0);
  await expect(departureOn(page, 0, "Private boat charter")).toHaveCount(1);
  const silent = await openDeparture(page, 0, "Private boat charter");
  await expect(silent).not.toContainText("Instant booking");
  await expect(silent).not.toContainText("You answer each request");
});

test("a failed listing read costs the picker, not the screen", async ({
  page,
}) => {
  /*
    `/calendar` reads two endpoints: `GET /slots` for the fortnight it edits,
    and `GET /experiences` for the departure picker's listings. Letting the
    second throw would take a working seat-editing screen down to an error
    page over a form nobody had opened.

    This identity refuses `/experiences` and answers `/slots`. The refusal used
    to sit on a ±120-day `/slots` read, because that is where the listings came
    from before yuvoy-operator#32.
  */
  await signInAs(page, "+919000000111");
  await page.goto("/calendar");

  // The screen is intact: the departures are there and still editable.
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  const row = await openDeparture(page, 0, "Try-dive at Nemo Reef");
  await expect(row.getByLabel("Seats offered")).toBeVisible();
  await closeInspector(page);

  // Only the picker is gone, and it says which of the two absences this is.
  await expect(
    page.getByText("We could not load your listings just now"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add departures" }),
  ).toHaveCount(0);
  /*
    Not the other sentence. `[]` now means "you have written no listings" and
    sends somebody to write one; `null` means the read failed and the answer
    is to reload. Rendering the first for the second would send an operator
    off to create a listing they already have.
  */
  await expect(page.getByText(/you have not written one yet/i)).toHaveCount(0);
});

/*
  Any week, as a board (operator experiment B; audit 5.1). The fortnight this
  replaced had no way past today plus thirteen days, so yesterday could not
  be closed out and a departure three weeks away could not be changed.

  "Calendar controls sellable capacity; Bookings owns customer obligation
  resolution." The assertions that matter most are the two sentences a closure
  must say before it happens, word for word, and that a week is a few phone
  screens rather than thirty.
*/
test("a week, any week, each day saying what is on it", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/calendar");

  // Seven days: the strip on a phone, the grid's columns on a desktop.
  if (testInfo.project.name === "mobile") {
    await expect(
      page.getByRole("navigation", { name: "Days" }).getByRole("link"),
    ).toHaveCount(7);
  } else {
    await expect(page.getByRole("columnheader")).toHaveCount(8);
  }

  // A day with boats says how many times they leave, and what is sold.
  const tomorrow = await openDay(page, 1);
  await expect(tomorrow).toContainText(/\d+ start times? · \d+ sold/);
  // A day with none says so, rather than leaving a gap.
  const empty = await openDay(page, 3);
  await expect(empty).toContainText("No departures scheduled");

  // Later and earlier are a tap away, and This week always comes back.
  await page.goto("/calendar");
  const weeks = page.getByRole("navigation", { name: "Weeks" });
  await weeks.getByRole("link", { name: "Later" }).click();
  await expect(page.getByRole("heading", { name: /^Week of / })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Weeks" })
    .getByRole("link", { name: "This week" })
    .click();
  await expect(
    page.getByRole("heading", { name: "This week", exact: true }),
  ).toBeVisible();
  // Last week too: yesterday's departures can be closed out.
  await page
    .getByRole("navigation", { name: "Weeks" })
    .getByRole("link", { name: "Earlier" })
    .click();
  await expect(page.getByRole("heading", { name: /^Week of / })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("week")).toMatch(
    /^\d{4}-\d{2}-\d{2}$/,
  );
});

test("a week fits a few phone screens, not thirty", async ({ page }) => {
  /*
    yuvoy-operator#84 s7: "fourteen days is a 26,000-pixel page", because every
    departure was an open form. The board is a week, and on a phone one day
    under its strip.
  */
  await signIn(page);
  await page.goto("/calendar");

  const board = page.getByRole("region", { name: "This week", exact: true });
  await expect(board).toBeVisible();
  const box = await board.boundingBox();
  const screen = page.viewportSize()!.height;
  expect(box!.height, "the week's height in screens").toBeLessThan(3 * screen);
});

test("an opened departure holds its controls, and 'Who is booked' is the way in", async ({
  page,
}) => {
  /*
    The seat, close, counter-sale and confirm controls moved inside the
    departure (#84 s7), and "Who is booked, and calling it off" became a label
    that scans (#96 item 6).
  */
  await signIn(page);

  const row = await openDeparture(page, 0, "Try-dive at Nemo Reef");
  // With the board, this departure open, as its way back (audit 5.8).
  await expect(
    row.getByRole("link", { name: "Who is booked" }),
  ).toHaveAttribute(
    "href",
    "/today/slot_dawn?from=%2Fcalendar%3Fdep%3Dslot_dawn",
  );
  await expect(row.getByText(/calling it off/)).toHaveCount(0);
  await expect(row.getByLabel("Seats offered")).toBeVisible();
  await expect(
    row.getByRole("button", { name: "I sold seats at my counter" }),
  ).toBeVisible();
  // Stopping it is quiet text, last, behind a confirm (#81).
  await expect(row.getByRole("button", { name: "Stop selling" })).toBeVisible();
});

test("a day marks what is off sale under it, and only that", async ({
  page,
}) => {
  /*
    #84 s7: a live listing's departures were off sale for unconfirmed seats and
    the only clue was a sentence in the middle of a card. The day row carries
    the mark now.

    Two departures ten days out are off sale for unconfirmed seats: Blue
    lagoon's, and the Sunset cruise Home's own tests confirm. A "Confirm all"
    on Home puts both back on sale at once, on whichever project gets there
    first, so the number is read from the rows rather than assumed: the mark
    on the day must say exactly what is under it, and nothing once it sells.
  */
  await signIn(page);

  const day = await openDay(page, 10);
  const names = await page
    .getByRole("link", {
      name: new RegExp(`^(${escape(shortDay(10))}, )?\\d\\d:\\d\\d `),
    })
    .evaluateAll((links) =>
      links.map((link) => link.getAttribute("aria-label") ?? ""),
    );
  const offSale = names.filter((name) =>
    /, Not on sale(,|$)/.test(name),
  ).length;

  if (offSale > 0) {
    await expect(day).toContainText(`${offSale} not on sale`);
  } else {
    await expect(day).not.toContainText("not on sale");
  }

  // Blue lagoon's own departure, while it is off sale: one tap to confirm,
  // and the reason one link away.
  const lagoon = names.find((name) =>
    name.includes("Blue lagoon (no footage fixture)"),
  );
  if (lagoon && /, Not on sale(,|$)/.test(lagoon)) {
    const opened = await openDeparture(
      page,
      10,
      "Blue lagoon (no footage fixture)",
    );
    await expect(
      opened.getByRole("button", { name: /^Confirm \d+ seats?$/ }),
    ).toBeVisible();
    await expect(
      opened.getByRole("link", { name: "Why seats need confirming" }),
    ).toHaveAttribute(
      "href",
      "/account/help?from=%2Fcalendar#confirming-seats",
    );
  }
});

test("closing a day says what closing does not do, before anything is closed", async ({
  page,
}) => {
  await signIn(page);

  // Tomorrow: never closed by any test, and it has people confirmed on it.
  const tomorrow = await openDay(page, 1);
  // Quiet text until asked for (#81), naming the day to a screen reader.
  await tomorrow.getByRole("button", { name: /^Close this day/ }).click();

  // Both of the issue's sentences, verbatim, before the button that closes.
  await expect(
    tomorrow.getByText(
      "Closing stops new bookings straight away. Bookings you've already confirmed stay live. Resolve those one by one in Bookings.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    tomorrow.getByText(
      /^\d+ guests? (is|are) already confirmed\. Closing won't move them\. Resolve each booking in Bookings\.$/,
    ),
  ).toBeVisible();

  // Nothing closed: backing out puts the quiet control back.
  await tomorrow.getByRole("button", { name: "Keep it open" }).click();
  await expect(
    tomorrow.getByRole("button", { name: /^Close this day/ }),
  ).toBeVisible();
});

test("closing one day closes it, and says who is still owed", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "closes a shared fixture day, single-tenant by design, so it runs on the primary project only",
  );
  await signIn(page);

  const day = await openDay(page, 13);
  await day.getByRole("button", { name: /^Close this day/ }).click();

  await expect(
    day.getByText(
      "3 guests are already confirmed. Closing won't move them. Resolve each booking in Bookings.",
      { exact: true },
    ),
  ).toBeVisible();

  await day.getByRole("radio", { name: "Weather" }).check();
  await day.getByRole("button", { name: /^Close / }).click();

  // The receipt says who is still owed, and survives the day turning Closed.
  await expect(day.getByText(/is closed to new bookings$/)).toBeVisible();
  await expect(day.getByText(/You still owe 1 booking\./)).toBeVisible();
  await expect(
    dayMarks(day).getByText("Closed", { exact: true }),
  ).toBeVisible();
  // The departure says why it is not selling, in the API's own sentence.
  const departure = await openDeparture(
    page,
    13,
    "Lagoon kayak (closing fixture B)",
  );
  await expect(
    departure.getByText(
      "This departure is closed to new bookings. Anybody already booked on it is unaffected.",
    ),
  ).toBeVisible();
});

test("a closed day with nothing on it still says Closed, and why", async ({
  page,
}, testInfo) => {
  /*
    op#45 item 1's own acceptance, and the whole reason "Closed" is READ now
    rather than inferred.

    The old rule was "every departure still running is closed", which an empty
    day can never satisfy: a shop that closed a fortnight in January saw
    fourteen ordinary empty days and no sign that anything had been done. And a
    status carries no reason, so the badge could never say why.

    A day each, because closing is read back and both projects share the mock's
    process.
  */
  /*
    Days nothing else touches. The fortnight is crowded: the departure-creation
    test builds on +9 and +11, the closing fixtures are +12 and +13, the
    stop-selling ones are +7 and +8, and the counter-sale test's are +2 and +4.
    +5 and +6 are empty and stay empty, which is the whole premise of this
    test.
  */
  const offset = testInfo.project.name === "mobile" ? 5 : 6;
  await signIn(page);

  const region = await openDay(page, offset);
  await expect(region).toContainText("No departures scheduled");
  await expect(
    dayMarks(region).getByText("Closed", { exact: true }),
  ).toHaveCount(0);

  await region.getByRole("button", { name: /^Close this day/ }).click();
  await region.getByRole("radio", { name: "Maintenance" }).check();
  await region.getByRole("button", { name: /^Close / }).click();

  // Closed, with its reason, on a day that has no departures at all.
  await expect(
    dayMarks(region).getByText("Closed", { exact: true }),
  ).toBeVisible();
  /*
    `.first()` because the reason is deliberately in two places: at the top of
    the opened day, where somebody reading why reads it, and beside the Reopen
    button, where somebody undoing it needs to know which closure it undoes.
  */
  await expect(
    region.getByText("Maintenance", { exact: true }).first(),
  ).toBeVisible();

  /*
    And the way back, which did not exist either: a closed empty day could be
    closed and never reopened. The day is still the open one: it is in the
    address, and the close only re-reads the board.
  */
  await expect(
    region.getByText("The whole day", { exact: true }),
  ).toBeVisible();
  await region.getByRole("button", { name: "Reopen" }).click();
  /*
    The note, which the API asks to be said out loud because it gives both
    counts in words. It is held by the day's panel, so it survives the day
    re-reading, and the day re-reads at once (op#89 f16).
  */
  await expect(region.getByText(/back on sale/)).toBeVisible();
  await expect(
    dayMarks(region).getByText("Closed", { exact: true }),
  ).toHaveCount(0);

  await page.reload();
  await expect(
    dayMarks(
      page.getByRole("region", { name: dayName(offset), exact: true }),
    ).getByText("Closed", { exact: true }),
  ).toHaveCount(0);
});

test("stopping one departure leaves the rest of the day selling, and reopens", async ({
  page,
}, testInfo) => {
  /*
    op#45 items 4 and 2. "This departure stops selling and the rest of its day
    does not", and "closing is not cancelling people": the bookings on it still
    stand, and the receipt says so. It is inside the departure now, quiet until
    asked for, behind a confirm (#84 s7, #81).
  */
  const offset = testInfo.project.name === "mobile" ? 7 : 8;
  const letter = testInfo.project.name === "mobile" ? "A" : "B";
  const kayak = `Lagoon kayak (stop fixture ${letter})`;
  await signIn(page);

  const stopping = await openDeparture(page, offset, kayak);
  await stopping.getByRole("button", { name: "Stop selling" }).click();
  /*
    "Staff" is this list's label: closing takes `BLACKOUT_REASONS` (Weather,
    Maintenance, Staff, Personal, Out of season, Something else), not the
    call-off list's "Staffing". The contract keeps four separate reason lists
    on purpose and each act takes only its own.
  */
  await stopping.getByRole("radio", { name: "Staff", exact: true }).check();
  await stopping.getByRole("button", { name: "Stop selling it" }).click();

  // The receipt, verbatim, in the departure it was made in: closing cancels
  // nobody.
  await expect(stopping.getByText(/is closed to new bookings$/)).toBeVisible();
  await expect(
    stopping.getByText(/The bookings already on this departure still stand/),
  ).toBeVisible();
  /*
    And the board re-reads underneath it, with no tap (op#89 f16): the
    departure now says why it is not selling, in the API's sentence, and the
    inspector is still open.
  */
  await expect(
    stopping.getByText(/^This departure is closed to new bookings\./),
  ).toBeVisible();

  // A reload lands on the same departure: the inspector is in the address.
  await page.reload();
  await expect(page.getByRole("dialog")).toContainText(
    "This departure is closed to new bookings.",
  );
  await closeInspector(page);
  const after = page.getByRole("region", {
    name: dayName(offset),
    exact: true,
  });

  // The other one on the day still sells.
  const other = await openDeparture(
    page,
    offset,
    `Sunset paddle (stop fixture ${letter})`,
  );
  await expect(other).not.toContainText("closed to new bookings");
  await closeInspector(page);

  // And the DAY is not closed: only one departure was.
  await expect(
    dayMarks(after).getByText("Closed", { exact: true }),
  ).toHaveCount(0);

  /*
    Reopening it is offered on the day, and it puts exactly that departure back:
    `departuresReopened: 1`, which the API's note says in words.
  */
  await expect(after.getByText("One departure", { exact: true })).toBeVisible();
  await after.getByRole("button", { name: "Reopen" }).click();
  await expect(after.getByText("1 departure is back on sale.")).toBeVisible();
  // Without a reload, too: the board re-reads as soon as it is reopened, and
  // the departure no longer says Closed.
  await expect(
    departureOn(page, offset, kayak).first(),
  ).not.toHaveAccessibleName(/, Closed(,|$)/);

  await page.reload();
  const reopened = await openDeparture(page, offset, kayak);
  await expect(reopened).not.toContainText("closed to new bookings");
});

test("a called-off departure says what the API says, not what we used to", async ({
  page,
}) => {
  /*
    op#45 item 5. The portal wrote its own sentence here: "Called off. Everyone
    booked on it was cancelled and refunded." It existed because the API filed
    `cancelled` under `departure_closed` with "anybody already booked on it is
    unaffected", which was the opposite of the truth.

    `departure_called_off` is its own reason now, and ours had to go because it
    was never true of a CASH booking: nothing was refunded on one, the money
    never reached us, and the operator is the one holding it.
  */
  await signIn(page);

  await openDay(page, 0);
  // The calendar's word on the board, exactly, in the departure's name.
  await expect(
    departureOn(page, 0, "Private boat charter, whole day").first(),
  ).toHaveAccessibleName(/, Called off(,|$)/);
  const row = await openDeparture(page, 0, "Private boat charter, whole day");
  await expect(row).toContainText("This departure was called off.");
  await expect(row).toContainText("anything paid in cash is with the operator");
  await expect(row).not.toContainText("Everyone booked on it was cancelled");
  // A called-off departure has nothing left to change.
  await expect(row.getByLabel("Seats offered")).toHaveCount(0);
});

test("a staff login is told who can change this, in one sentence, and offered nothing to change", async ({
  page,
}) => {
  // op#45 item 7: three sentences opening "Your role cannot ..." became one
  // that says who to ask rather than what the reader is.
  await signInAs(page, "+919000000103");
  await page.goto("/calendar");

  await expect(
    page.getByText(
      "Only owners, admins and managers can change seats or close dates.",
    ),
  ).toBeVisible();
  /*
    And no control the API would refuse. Closing dates used to be drawn for
    staff and refused after the tap.
  */
  await expect(
    page.getByRole("button", { name: "Close dates to new bookings" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add departures" }),
  ).toHaveCount(0);
  const inspector = await openDeparture(page, 0, "Try-dive at Nemo Reef");
  // The departure's own controls, apart from the inspector's frame.
  const row = inspector.getByRole("region", { name: "Seats and sales" });
  await expect(row.getByRole("link", { name: "Who is booked" })).toBeVisible();
  await expect(row.getByLabel("Seats offered")).toHaveCount(0);
  /*
    A counter sale is the one control staff are given: the API has never
    role-gated it, and the person at the counter is often staff (owner ruling,
    23 Sep 2026). Seats and stopping a sale stay with managers.
  */
  await expect(row.getByRole("button")).toHaveCount(1);
  await expect(
    row.getByRole("button", { name: "I sold seats at my counter" }),
  ).toBeVisible();
});

test("/calendar has no accessibility violations", async ({ page }) => {
  await signIn(page);
  // Every form open, or the audit only ever sees collapsed ones.
  const tomorrow = await openDay(page, 1);
  await page.getByRole("button", { name: "Add departures" }).click();
  await page
    .getByRole("button", { name: "Close dates to new bookings" })
    .click();
  await tomorrow.getByRole("button", { name: /^Close this day/ }).click();
  await page.waitForLoadState("networkidle");

  await expectAccessible(page, "/calendar, every form open");

  // And the inspector, open over the board.
  await departureOn(page, 1, "Snorkel trip to Elephant Beach").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForLoadState("networkidle");

  await expectAccessible(page, "/calendar, a departure's inspector open");
});

/*
  The board's reach and its inspector (operator experiment B; audit 5.1).
*/
test("a departure past the old fortnight is on the board, and changes there", async ({
  page,
}, testInfo) => {
  /*
    The fortnight stopped at today plus thirteen, so a departure three weeks
    out could not have its seats changed. Made here, on a day per project far
    past anything else in the suite, and found on its own week.
  */
  test.setTimeout(60_000);
  await signIn(page);
  const mobile = testInfo.project.name === "mobile";
  const offset = mobile ? 20 : 23;
  const time = mobile ? "06:10" : "06:40";
  const title = mobile
    ? "Try-dive at Nemo Reef"
    : "Snorkel trip to Elephant Beach";

  const today = await openAddDepartures(page);
  const day = dayAfter(today, offset);
  await page.getByLabel("Which listing").selectOption({ label: title });
  await page.getByLabel("First day").fill(day);
  await page.getByLabel("Last day").fill(day);
  await page.getByRole("textbox", { name: "Departure time 1" }).fill(time);
  await page.getByLabel("Seats on each departure").fill("6");
  await page.getByRole("button", { name: "Add 1 departure" }).click();
  await expect(
    page.getByText(/1 departure added|Nothing to add/).first(),
  ).toBeVisible();

  const inspector = await openDeparture(page, offset, title, time);
  await expect(page.getByRole("heading", { name: /^Week of / })).toBeVisible();
  await inspector.getByLabel("Seats offered").fill("7");
  await inspector.getByRole("button", { name: "Set seats" }).click();
  await expect(inspector.getByText("Now offering 7.")).toBeVisible();
});

test("the inspector closes with Escape, back onto the departure that opened it", async ({
  page,
}) => {
  await signIn(page);
  await openDay(page, 0);
  const link = departureOn(page, 0, "Try-dive at Nemo Reef").first();
  await link.click();
  const inspector = page.getByRole("dialog");
  await expect(inspector).toBeVisible();
  // The address says which departure is open, so a reload or a pasted link
  // lands on it.
  expect(new URL(page.url()).searchParams.get("dep")).toBe("slot_dawn");

  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("dep")).toBeNull();
  await expect(link).toBeFocused();
});

test("on a desktop the arrow keys move along the board", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the grid is a desktop's");
  await signIn(page);
  await page.goto("/calendar");

  /*
    Where each departure sits, as the grid itself says (`data-row`,
    `data-col`), and a direction from today's dive that has a departure in
    it: today may be the week's last day, or its listing's only one.
  */
  const cells = await page
    .locator("[data-row][data-col]")
    .evaluateAll((links) =>
      links.map((link) => ({
        row: Number((link as HTMLElement).dataset.row),
        col: Number((link as HTMLElement).dataset.col),
        name: link.getAttribute("aria-label") ?? "",
      })),
    );
  const start = cells.find(
    (c) =>
      c.name.startsWith(`${shortDay(0)}, `) &&
      c.name.includes("Try-dive at Nemo Reef"),
  )!;
  const ways: [string, string, (c: (typeof cells)[number]) => boolean][] = [
    [
      "ArrowRight",
      "ArrowLeft",
      (c) => c.row === start.row && c.col > start.col,
    ],
    [
      "ArrowLeft",
      "ArrowRight",
      (c) => c.row === start.row && c.col < start.col,
    ],
    ["ArrowDown", "ArrowUp", (c) => c.row > start.row],
    ["ArrowUp", "ArrowDown", (c) => c.row < start.row],
  ];
  const way = ways.find(([, , has]) => cells.some(has));
  expect(way, "a departure next to today's on the board").toBeTruthy();
  const [go, back] = way!;

  const from = departureOn(page, 0, "Try-dive at Nemo Reef").first();
  await from.focus();
  await page.keyboard.press(go);
  // Somewhere else on the board, by the keys alone.
  await expect(page.locator(":focus")).not.toHaveAccessibleName(start.name);
  await expect(page.locator(":focus")).toHaveAttribute("data-row", /\d+/);
  // And back to today's cell the other way.
  await page.keyboard.press(back);
  await expect(page.locator(":focus")).toHaveAttribute(
    "data-col",
    String(start.col),
  );
  await expect(page.locator(":focus")).toHaveAttribute(
    "data-row",
    String(start.row),
  );
});

/*
  With no signal (operator experiment B's offline state, built 4 Oct 2026).
  The board is server-rendered: offline there is no other week, day or
  inspector to fetch, and Next falls back to a full browser navigation that
  lands on the browser's own "no internet" page. So the board stays readable,
  nothing that changes something can be pressed, and a link that needs the
  server is held with the reason.
*/
test("with no signal the calendar stays readable, changes nothing, and says so", async ({
  page,
  context,
}) => {
  await signIn(page);
  await openDay(page, 1);
  const notice = page.getByRole("status").filter({ hasText: "No signal" });
  await expect(notice).toHaveCount(0);

  await context.setOffline(true);
  await expect(notice).toContainText(
    "The calendar is read-only until you are back online. What it shows may be out of date.",
  );
  await expect(
    page.getByRole("button", { name: "Add departures" }),
  ).toBeDisabled();

  // Another week needs the server: held where it is, with the reason.
  const here = page.url();
  await page
    .getByRole("navigation", { name: "Weeks" })
    .getByRole("link", { name: "Later" })
    .click();
  await expect(notice).toContainText("That opens once you are back online.");
  expect(page.url()).toBe(here);
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

  await expectAccessible(page, "/calendar, with no signal");

  // Back online: the notice goes, and the board is usable again.
  await context.setOffline(false);
  await expect(notice).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add departures" }),
  ).toBeEnabled();
});

test("with no signal the inspector closes on the phone, and changes nothing", async ({
  page,
  context,
}) => {
  await signIn(page);
  const inspector = await openDeparture(
    page,
    1,
    "Snorkel trip to Elephant Beach",
  );
  await context.setOffline(true);
  await expect(
    page.getByRole("status").filter({ hasText: "No signal" }),
  ).toBeVisible();

  // Everything inside that changes the departure is off; Close is not.
  const buttons = inspector.getByRole("button");
  const names = (await buttons.allTextContents()).map((n) => n.trim());
  expect(names.length, "the inspector offers something to do").toBeGreaterThan(
    1,
  );
  for (let i = 0; i < names.length; i += 1) {
    const button = buttons.nth(i);
    const label = (await button.getAttribute("aria-label")) ?? names[i];
    if (label === "Close") await expect(button).toBeEnabled();
    else await expect(button).toBeDisabled();
  }

  await inspector.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has("dep")).toBe(false);
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await context.setOffline(false);
});
