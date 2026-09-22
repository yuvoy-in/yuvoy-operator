import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Home and the listing hub — yuvoy-operator#56.
 *
 * ## What Home is for
 *
 * One glance at six in the morning on one bar of signal: what is waiting on an
 * answer, what is running today, and every listing with its state. It was
 * Today, which showed the day and nothing else, while the listings lived behind
 * a tab nobody found.
 *
 * ## And what it must not do
 *
 * Explain itself. "One heading per block, and body text only for an error or an
 * empty day." The previous screen opened with the operator's own name and a
 * paragraph about what a manifest is.
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";
/** Arun, STAFF: gets the manifest and nothing to change. */
const STAFF = "+919000000103";
/** The dive listing: live, and its only departure has already left today. */
const TRY_DIVE = "exp_try_dive";
/**
 * The snorkel listing, which is the one with departures STILL TO COME.
 *
 * The hub reads `workspace.departures`, "the ones that have not yet left", so a
 * listing whose only boat sailed this morning has an empty list and no action
 * to offer. Every action test below uses this one.
 */
const SNORKEL = "exp_snorkel";

async function signIn(page: Page, phone = OWNER) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("Home leads with what is waiting, and never with a name", async ({
  page,
}) => {
  await signIn(page);

  /*
    The requests strip, first, because it is the only thing on this screen with
    a clock on it. "{n} requests waiting · {u} within the hour" when any are
    close to expiring.
  */
  const strip = page.getByRole("link", { name: /requests? waiting/ });
  await expect(strip).toBeVisible();
  await expect(strip).toContainText(/within the hour/);
  await strip.click();
  await page.waitForURL(/view=requests/);

  /*
    And nobody's name. The screen opened with `me.name` in an eyebrow, which is
    a greeting rather than information, on the screen an operator opens most.
  */
  await page.goto("/today");
  const main = await page.locator("main").innerText();
  expect(main, "Home does not greet anybody").not.toContain("Priya Raut");
});

test("the day says what is running, and a called-off departure says so", async ({
  page,
}) => {
  await signIn(page);

  /*
    "{Today} · {n} departure(s) · {g} guest(s)", where the guests are only the
    ones still going: a called-off departure's seats were cancelled and
    refunded, and counting them would tell an operator to expect people who are
    not coming.
  */
  await expect(
    page.getByRole("heading", {
      name: /^Today · \d+ departures? · \d+ guests?$/,
    }),
  ).toBeVisible();

  const off = page
    .getByRole("region", { name: /departures?/ })
    .getByRole("link")
    .filter({ hasText: "Private boat charter" });
  await expect(off).toContainText("Called off");
});

test("every listing is on Home, with its state and its next departure", async ({
  page,
}) => {
  await signIn(page);

  const listings = page.getByRole("region", { name: "Your listings" });
  await expect(listings).toBeVisible();

  const dive = listings
    .getByRole("link")
    .filter({ hasText: "Try-dive at Nemo Reef" });
  await expect(dive).toContainText("Live");

  /*
    "Next: {day} {time} · {sold}/{seats}", found inside the ONE fortnight read
    rather than a request per listing. "Never one call per listing", and a shop
    with nine would otherwise make nine on the screen opened first.

    SOME listing carries it, rather than a named one, and no listing is asserted
    to lack it. Every listing with a future departure is one another suite
    closes, calls off or moves, and `calendar.spec.ts` CREATES departures on the
    dive listing nine days out — so both halves of a named assertion are coupled
    to whatever ran first.

    `nextDeparture` being "later than NOW" rather than "later than today" is
    covered where it belongs, in `home.test.ts`, against a fixed clock.
  */
  /*
    SOME listing carries it, rather than a named one. Every listing with a
    future departure is a listing another suite closes, calls off or moves —
    `slot_late_morning` alone is acted on by the calendar, the day and the hub
    tests — so naming one here couples this assertion to whatever ran first.

    What is named is the listing that must NOT carry it: the dive fixture's only
    departure is this morning's, which has left. `nextDeparture` is "later than
    NOW", not "later than today", so a 06:00 boat is not next at 09:00, and a
    listing whose boats have gone says nothing rather than "Next:" with a blank
    after it.
  */
  await expect(
    listings.getByText(/^Next: .+\d\d:\d\d · \d+\/\d+$/).first(),
  ).toBeVisible();
});

test("Home has no paragraph explaining itself", async ({ page }) => {
  await signIn(page);

  const main = await page.locator("main").innerText();
  for (const gone of [
    "Everyone who has booked you",
    "No departures today. If that is wrong",
    "A departure that is not here is one Yuvoy cannot sell",
    "Nothing scheduled",
  ]) {
    expect(main, `"${gone}" came off Home`).not.toContain(gone);
  }
});

test("a listing opens its hub, with everything about it", async ({ page }) => {
  await signIn(page);
  await page
    .getByRole("region", { name: "Your listings" })
    .getByRole("link")
    .filter({ hasText: "Try-dive at Nemo Reef" })
    .click();
  await page.waitForURL(`**/today/listing/${TRY_DIVE}`);

  await expect(
    page.getByRole("heading", { name: "Try-dive at Nemo Reef" }),
  ).toBeVisible();
  // Price, duration and party size: what the listing IS, before what can be
  // done to it.
  await expect(page.getByText(/₹4,500 per person/)).toBeVisible();
  await expect(
    page.getByText(/180 minutes · Up to 6 per booking/),
  ).toBeVisible();

  // A focused screen: the way back is to Home.
  await expect(page.getByRole("link", { name: /Back to home/i })).toBeVisible();
});

test("the hub carries the weekly schedule, and asks before removing it", async ({
  page,
}) => {
  /*
    `PUT /experiences/{id}/schedule` replaces what is there, so a row removed
    here is a row removed from the business. An empty save on a listing that has
    a schedule is therefore a question: "departures it made are closed to new
    bookings. Bookings on them stay."

    Closed, not cancelled. That distinction is why the confirmation says it.
  */
  await signIn(page);
  await page.goto(`/today/listing/${TRY_DIVE}`);

  await expect(
    page.getByRole("heading", { name: "Weekly schedule" }),
  ).toBeVisible();
  // The fixture's two days are read back, not invented.
  await expect(page.getByLabel("Day").first()).toHaveValue("2");

  // Clearing every row turns the save into a question rather than a save.
  for (let i = 0; i < 2; i += 1) {
    await page
      .getByRole("button", { name: /^Remove/ })
      .first()
      .click();
  }
  await page
    .getByRole("button", { name: "Remove the weekly schedule" })
    .click();
  await expect(
    page.getByText("Departures it made are closed to new bookings."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep it" })).toBeVisible();
  // Not removed: the question is the point, and this test does not answer it.
  await page.getByRole("button", { name: "Keep it" }).click();
});

test("a departure offers Stop selling and Cancel departure as two buttons", async ({
  page,
}) => {
  /*
    op#56 item 9's own words: "always two separate buttons with these exact
    labels", and "the money effect is said only in the confirm step, never in
    text on the row." They are the two acts an operator confuses, and the
    difference is everything.
  */
  await signIn(page);
  await page.goto(`/today/listing/${SNORKEL}`);

  const departures = page.getByRole("region", { name: "Next departures" });
  await expect(
    departures.getByRole("button", { name: "Stop selling" }).first(),
  ).toBeVisible();
  await expect(
    departures.getByRole("button", { name: "Cancel departure" }).first(),
  ).toBeVisible();

  // And no money on the row itself.
  const rows = await departures.innerText();
  expect(rows).not.toContain("refund");
});

test("moving a departure says what it did, and to how many", async ({
  page,
}, testInfo) => {
  /*
    Single-tenant: a moved departure stays moved in the mock's shared process,
    and the other project would find it at a time its own assertion did not
    expect.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "a moved departure stays moved, and both projects share the mock's state",
  );

  await signIn(page);
  await page.goto(`/today/listing/${SNORKEL}`);

  /*
    A row that actually offers the move, not the first one. Change time is drawn
    on an `open` or `closed` departure and withheld on a called-off one, and
    this listing's departures are acted on by the calendar and day suites —
    whichever ran first decides what the first row is.
  */
  const row = page
    .getByRole("region", { name: "Next departures" })
    .locator("li")
    .filter({ has: page.getByRole("button", { name: "Change time" }) })
    .first();
  await row.getByRole("button", { name: "Change time" }).click();

  /*
    The consequence, before the tap: everyone booked is told, and each of them
    may cancel for a full refund until it leaves. That is what makes moving a
    departure a decision rather than an edit.
  */
  await expect(row.getByText(/can cancel for a full refund/)).toBeVisible();

  await row.getByLabel("New time").fill("10:30");
  await row.getByRole("button", { name: "Move it" }).click();

  await expect(row.getByText("This departure has moved")).toBeVisible();
  // The API's own sentence, which says how many travellers were told.
  await expect(row.getByText(/have been told|has been told/)).toBeVisible();
});

test("a staff login gets the manifest and nothing to change", async ({
  page,
}) => {
  /*
    "Only View as a traveller. No sentence explaining why" — not offering a
    control already says it, and a paragraph about roles on a screen full of
    things somebody cannot do is the screen arguing with the reader.
  */
  await signIn(page, STAFF);
  await page.goto(`/today/listing/${SNORKEL}`);

  await expect(page.getByRole("button", { name: "Stop selling" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Cancel departure" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Weekly schedule" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);

  // What they do get: the way into each departure.
  await expect(
    page.getByRole("link", { name: "Who is coming" }).first(),
  ).toBeVisible();
  // And no sentence about why.
  const main = await page.locator("main").innerText();
  expect(main.toLowerCase()).not.toContain("only owners");
});

test("a listing that is not yours is a 404", async ({ page }) => {
  await signIn(page);
  const res = await page.goto("/today/listing/exp_not_yours");
  expect(res?.status()).toBe(404);
});

test("the manifest offers to cancel one booking", async ({ page }) => {
  /*
    op#56 item 10, and the same component the booking's own screen uses (#43):
    the act is the same, and a second confirmation written for the manifest
    would be a second chance to get the typed reference wrong.
  */
  await signIn(page);
  await page.goto("/today/slot_cash");

  /*
    Sofia's booking, which nothing cancels. `booking.spec.ts` cancels Ritu's and
    Jonas's on this same departure (#43's own fixtures), and a cancelled booking
    is not one this control is offered for — so naming either of those here is a
    race with whichever suite ran first.
  */
  const row = page.locator("li").filter({ hasText: "Sofia Alves" });
  await expect(
    row.getByRole("button", { name: "Cancel this booking" }),
  ).toBeVisible();
});

test("a staff login cannot cancel a booking from the manifest", async ({
  page,
}) => {
  await signIn(page, STAFF);
  await page.goto("/today/slot_cash");
  await expect(
    page.getByRole("button", { name: "Cancel this booking" }),
  ).toHaveCount(0);
});

test("Home has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await expect(
    page.getByRole("region", { name: "Your listings" }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("the listing hub has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto(`/today/listing/${TRY_DIVE}`);
  await expect(
    page.getByRole("heading", { name: "Try-dive at Nemo Reef" }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("a live listing with no dates to sell says so, and one with dates does not", async ({
  page,
}) => {
  /*
    yuvoy-operator#95 item 3. `bookableDatesNext30Days` counts the days a
    traveller could book in the next 30, by checkout's own rules. A live
    listing reading 0 is on the traveller app and sells nothing, and nothing
    said so: "test2Activity reads Live with no next departure and no warning."

    `exp_cover` is live with no departures at all; `exp_snorkel` has them.
  */
  await signIn(page);

  await page.goto("/today/listing/exp_cover");
  await expect(
    page.getByText("Live, but no dates in the next 30 days"),
  ).toBeVisible();

  await page.goto(`/today/listing/${SNORKEL}`);
  await expect(
    page.getByRole("heading", { level: 1, name: /Snorkel trip/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Live, but no dates in the next 30 days"),
  ).toHaveCount(0);

  // And its tile on the profile carries the fact, where live tiles carry none.
  await page.goto("/account");
  await expect(
    page.getByRole("link", { name: /^Coral wall \(cover fixture\)/ }),
  ).toContainText("No dates in 30 days");
});

test("departures off sale for unconfirmed seats are named, and one tap confirms them", async ({
  page,
}, testInfo) => {
  /*
    yuvoy-operator#94 items 1 and 2. "Seats set by hand stop being offered to
    travellers once nobody has confirmed them for two days", and no screen said
    so: Sky diving had 19 of 20 departures off sale for it. `exp_nofootage`
    has one such departure, three days out.

    Confirming is one-way in the mock, so this runs on one project.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "confirming seats is one-way in the shared mock, so single-tenant by design",
  );
  await signIn(page);
  await page.goto("/today/listing/exp_nofootage");

  await expect(page.getByText("1 departure is not on sale")).toBeVisible();
  // Its only departure is off sale, so it is also live with nothing to sell.
  await expect(
    page.getByText("Live, but no dates in the next 30 days"),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Confirm seats for the next 30 days" })
    .click();

  await expect(page.getByText("Seats confirmed on 1 departure")).toBeVisible();
  // The hub re-read underneath the receipt: it has a date to sell now.
  await expect(
    page.getByText("Live, but no dates in the next 30 days"),
  ).toHaveCount(0);
  await expect(page.getByText("1 departure is not on sale")).toHaveCount(0);
});
