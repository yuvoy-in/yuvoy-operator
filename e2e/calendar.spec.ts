import { test, expect } from "@playwright/test";
import {
  signIn,
  departureOn,
  openDeparture,
  dayAfter,
  openAddDepartures,
} from "./calendar-kit";

/**
 * O9's capacity half — the single most important number in the system.
 *
 * The assertions here are all about refusals, because that is what this screen
 * is for. A capacity screen that only proves you can raise a number has proved
 * nothing: the failure it exists to prevent is a boat leaving with people
 * still on the jetty.
 */

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
