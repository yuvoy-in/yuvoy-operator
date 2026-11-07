import { test, expect } from "@playwright/test";
import {
  signInAs,
  signIn,
  shortDay,
  dayName,
  escape,
  openDay,
  departureOn,
  openDeparture,
  dayMarks,
  closeInspector,
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
