import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
    ? { title: "Try-dive at Nemo Reef", day: "Today" }
    : { title: "Snorkel trip to Elephant Beach", day: "Tomorrow" };
}

/**
 * One day of the fortnight, opened. Each day is one row until it is opened
 * (yuvoy-operator#84 s7), a native disclosure, so a test opens it the way a
 * thumb does: by its summary. Opening one that is already open would close
 * it, so it is only clicked when shut.
 */
async function openDay(page: Page, name: string | RegExp): Promise<Locator> {
  const day = page.getByRole("region", { name, exact: true });
  const details = day.locator(":scope > details");
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) {
    await day.locator(":scope > details > summary").click();
  }
  await expect(details).toHaveJSProperty("open", true);
  return day;
}

/** A departure inside an opened day, opened too. The first one by that title. */
async function openDeparture(day: Locator, title: string): Promise<Locator> {
  const row = day.locator("li").filter({ hasText: title }).first();
  const details = row.locator(":scope > details");
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) {
    await row.locator(":scope > details > summary").click();
  }
  await expect(details).toHaveJSProperty("open", true);
  return row;
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

test("the bar links to capacity, and capacity lists the fortnight", async ({
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
    shared across projects, so "the fortnight lists this trip" is what this
    asserts, not "exactly once". Inside its day, which is opened first.
  */
  const today = await openDay(page, "Today");
  await expect(today.getByText("Try-dive at Nemo Reef").first()).toBeVisible();
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
  const row = await openDeparture(await openDay(page, mine.day), mine.title);
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
  const row = await openDeparture(await openDay(page, mine.day), mine.title);
  const sold = testInfo.project.name === "mobile" ? "5" : "1";

  await row.getByLabel("Seats offered").fill(sold);
  await row.getByRole("button", { name: "Set seats" }).click();

  // That closes the departure without stranding anyone: the operator's way
  // out of a full boat, and the one reduction the API permits.
  await expect(row.getByText(`Now offering ${sold}.`)).toBeVisible();
  await expect(row.getByRole("alert")).toHaveCount(0);

  /*
    And the row itself now says so, with the day and the departure still open:
    the action revalidates the page, and the receipt is read inside the day it
    was made in (yuvoy-operator#84 s7). For a month the mock's reads ignored
    its writes, and "Now offering 5." rendered beside "5 of 8 sold · 3 left".
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
  const row = await openDeparture(await openDay(page, mine.day), mine.title);
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

  // The second walk-up sale of the morning does not need a navigation: the
  // receipt offers a fresh form.
  await row.getByRole("button", { name: "Record another sale" }).click();
  await expect(row.getByLabel("Seats you sold at your counter")).toBeVisible();
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

  // It is on the list, read back from the server rather than assumed.
  await page.goto("/calendar");
  const row = page.locator("li").filter({ hasText: mine.title });
  await expect(row.filter({ hasText: mine.time })).toHaveCount(1);

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
  // Still one row, not two.
  await page.goto("/calendar");
  await expect(
    page
      .locator("li")
      .filter({ hasText: mine.title })
      .filter({ hasText: mine.time }),
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
  await page.goto("/calendar");

  // Said as a fact inside the opened departure, not as a paragraph on every one.
  const today = await openDay(page, "Today");
  const held = await openDeparture(today, "Try-dive at Nemo Reef");
  await expect(held).toContainText("Instant booking");

  const tomorrow = await openDay(page, "Tomorrow");
  const asked = await openDeparture(tomorrow, "Snorkel trip to Elephant Beach");
  await expect(asked).toContainText("You answer each request");

  // The charter fixture carries no mode. The row says nothing either way.
  const silent = today
    .locator("li")
    .filter({ hasText: "Private boat charter" });
  await expect(silent).toHaveCount(1);
  await openDeparture(today, "Private boat charter");
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
  const row = await openDeparture(
    await openDay(page, "Today"),
    "Try-dive at Nemo Reef",
  );
  await expect(row.getByLabel("Seats offered")).toBeVisible();

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
  Fourteen days, one row each: yuvoy-operator#45, laid out by #84 s7.

  "Calendar controls sellable capacity; Bookings owns customer obligation
  resolution." The assertions that matter most are the two sentences a closure
  must say before it happens, word for word, and that a fortnight is a few
  phone screens rather than thirty.
*/
test("fourteen days, each one row saying what is on it", async ({ page }) => {
  await signIn(page);
  await page.goto("/calendar");

  const days = page
    .getByRole("region", { name: "The next fourteen days" })
    .getByRole("region");
  await expect(days).toHaveCount(14);
  await expect(
    days.first().getByRole("heading", { name: "Today" }),
  ).toBeVisible();
  await expect(
    days.nth(1).getByRole("heading", { name: "Tomorrow" }),
  ).toBeVisible();

  // A day with boats says how many times they leave, and what is sold.
  await expect(days.nth(1)).toContainText(/\d+ start times? · \d+ sold/);
  // A day with none says so, rather than leaving a gap in the list.
  await expect(days.nth(3)).toContainText("No departures scheduled");

  // Every day is shut until it is opened, so no departure is on screen yet.
  for (let i = 0; i < 14; i += 1) {
    await expect(days.nth(i).locator(":scope > details")).toHaveJSProperty(
      "open",
      false,
    );
  }
  // Their controls are in the page and hidden: none of them is on screen.
  await expect(
    page.getByLabel("Seats offered").filter({ visible: true }),
  ).toHaveCount(0);
});

test("a fortnight fits a few phone screens, not thirty", async ({ page }) => {
  /*
    yuvoy-operator#84 s7: "fourteen days is a 26,000-pixel page", because every
    departure was an open form. Collapsed, the fortnight is fourteen rows.
  */
  await signIn(page);
  await page.goto("/calendar");

  const fortnight = page.getByRole("region", {
    name: "The next fourteen days",
  });
  await expect(fortnight).toBeVisible();
  const box = await fortnight.boundingBox();
  const screen = page.viewportSize()!.height;
  expect(box!.height, "the fortnight's height in screens").toBeLessThan(
    3 * screen,
  );
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
  await page.goto("/calendar");

  const row = await openDeparture(
    await openDay(page, "Today"),
    "Try-dive at Nemo Reef",
  );
  await expect(
    row.getByRole("link", { name: "Who is booked" }),
  ).toHaveAttribute("href", "/today/slot_dawn");
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
  await page.goto("/calendar");

  const day = await openDay(page, dayLabel(10));
  const summary = day.locator(":scope > details > summary");
  const rows = day.locator("li");
  let offSale = 0;
  for (let i = 0, n = await rows.count(); i < n; i++) {
    offSale += await rows
      .nth(i)
      .locator(":scope > details > summary")
      .getByText("Not on sale", { exact: true })
      .count();
  }

  if (offSale > 0) {
    await expect(summary).toContainText(`${offSale} not on sale`);
  } else {
    await expect(summary).not.toContainText("not on sale");
  }

  // Blue lagoon's own departure, while it is off sale: one tap to confirm,
  // and the reason one link away.
  const lagoon = rows
    .filter({ hasText: "Blue lagoon (no footage fixture)" })
    .first();
  const lagoonOffSale = await lagoon
    .locator(":scope > details > summary")
    .getByText("Not on sale", { exact: true })
    .count();
  if (lagoonOffSale > 0) {
    const opened = await openDeparture(day, "Blue lagoon (no footage fixture)");
    await expect(
      opened.getByRole("button", { name: /^Confirm \d+ seats?$/ }),
    ).toBeVisible();
    await expect(
      opened.getByRole("link", { name: "Why seats need confirming" }),
    ).toHaveAttribute("href", "/account/help#confirming-seats");
  }
});

test("closing a day says what closing does not do, before anything is closed", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/calendar");

  // Tomorrow: never closed by any test, and it has people confirmed on it.
  const tomorrow = await openDay(page, "Tomorrow");
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
  await page.goto("/calendar");

  const day = await openDay(page, dayLabel(13));
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
    day
      .locator(":scope > details > summary")
      .getByText("Closed", { exact: true }),
  ).toBeVisible();
  // The departure says why it is not selling, in the API's own sentence.
  const departure = await openDeparture(
    day,
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
    test builds on +9 and +11, the closing fixtures are +12 and +13, and the
    stop-selling ones are +7 and +8. +5 and +6 are empty and stay empty, which
    is the whole premise of this test.
  */
  const offset = testInfo.project.name === "mobile" ? 5 : 6;
  await signIn(page);
  await page.goto("/calendar");

  const region = page.getByRole("region", { name: dayLabel(offset) });
  const summary = region.locator(":scope > details > summary");
  await expect(summary).toContainText("No departures scheduled");
  await expect(summary.getByText("Closed", { exact: true })).toHaveCount(0);

  await openDay(page, dayLabel(offset));
  await region.getByRole("button", { name: /^Close this day/ }).click();
  await region.getByRole("radio", { name: "Maintenance" }).check();
  await region.getByRole("button", { name: /^Close / }).click();

  // Closed, with its reason, on a day that has no departures at all.
  await expect(summary.getByText("Closed", { exact: true })).toBeVisible();
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
    closed and never reopened. The day is still open from the close above: the
    close revalidates the calendar, and React never touches a disclosure's
    `open`, so what the operator opened stays open.
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
  await expect(summary.getByText("Closed", { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(
    page
      .getByRole("region", { name: dayLabel(offset) })
      .locator(":scope > details > summary")
      .getByText("Closed", { exact: true }),
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
  await signIn(page);
  await page.goto("/calendar");

  const region = await openDay(page, dayLabel(offset));
  const stopping = await openDeparture(
    region,
    `Lagoon kayak (stop fixture ${letter})`,
  );
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
    And the day re-reads underneath it, with no tap (op#89 f16): the
    departure now says why it is not selling, in the API's sentence, and the
    departure and its day are still open.
  */
  await expect(
    stopping.getByText(/^This departure is closed to new bookings\./),
  ).toBeVisible();

  await page.reload();
  const after = await openDay(page, dayLabel(offset));

  // The departure says why, in the API's sentence. The other one still sells.
  const closedRow = await openDeparture(
    after,
    `Lagoon kayak (stop fixture ${letter})`,
  );
  await expect(closedRow).toContainText(
    "This departure is closed to new bookings.",
  );
  const stillSelling = after
    .locator("li")
    .filter({ hasText: `Sunset paddle (stop fixture ${letter})` })
    .first();
  await expect(stillSelling).not.toContainText("closed to new bookings");

  // And the DAY is not closed: only one departure was.
  await expect(
    after
      .locator(":scope > details > summary")
      .getByText("Closed", { exact: true }),
  ).toHaveCount(0);

  /*
    Reopening it is offered on the day, and it puts exactly that departure back:
    `departuresReopened: 1`, which the API's note says in words.
  */
  await expect(after.getByText("One departure", { exact: true })).toBeVisible();
  await after.getByRole("button", { name: "Reopen" }).click();
  await expect(after.getByText("1 departure is back on sale.")).toBeVisible();
  // Without a reload, too: the day re-reads as soon as it is reopened, and
  // no departure on it says it is closed any more.
  await expect(
    after.getByText(/^This departure is closed to new bookings\./),
  ).toHaveCount(0);

  await page.reload();
  await expect(
    page
      .getByRole("region", { name: dayLabel(offset) })
      .locator("li")
      .filter({ hasText: `Lagoon kayak (stop fixture ${letter})` })
      .first(),
  ).not.toContainText("closed to new bookings");
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
  await page.goto("/calendar");

  const today = await openDay(page, "Today");
  const row = today
    .locator("li")
    .filter({ hasText: "Private boat charter, whole day" })
    .first();
  // The chip, exactly: the API's sentence inside it also contains the words.
  await expect(row.getByText("Called off", { exact: true })).toBeVisible();
  await openDeparture(today, "Private boat charter, whole day");
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
      "Only owners, admins and managers can change seats, close dates or record counter sales.",
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
  const row = await openDeparture(
    await openDay(page, "Today"),
    "Try-dive at Nemo Reef",
  );
  await expect(row.getByRole("link", { name: "Who is booked" })).toBeVisible();
  await expect(row.getByLabel("Seats offered")).toHaveCount(0);
  await expect(row.getByRole("button")).toHaveCount(0);
});

test("/calendar has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/calendar");
  // Every form open, or the audit only ever sees collapsed rows.
  await page.getByRole("button", { name: "Add departures" }).click();
  await page
    .getByRole("button", { name: "Close dates to new bookings" })
    .click();
  const tomorrow = await openDay(page, "Tomorrow");
  await openDeparture(tomorrow, "Snorkel trip to Elephant Beach");
  await tomorrow.getByRole("button", { name: /^Close this day/ }).click();
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
