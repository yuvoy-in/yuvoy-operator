import { test, expect, type Locator } from "@playwright/test";
import { expectAccessible } from "./axe";
import { STAFF, signIn, needsYou, today } from "./home-kit";

/**
 * Home and the listing hub: yuvoy-operator#96 and #82 for Home, #56 for the
 * hub.
 *
 * ## What Home is for
 *
 * "Run today, miss nothing." Top to bottom: whether the business is selling,
 * what needs the operator sorted by deadline, today's departures with
 * Tomorrow one tap away, money today for a login that can manage, and the
 * listings at a glance. The listing list itself left for Business.
 *
 * ## And what it must not do
 *
 * Explain itself, greet anybody, or put a departure nobody can be on beside
 * the ones that run.
 */

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

test("a listing's hub has everything about it", async ({ page }) => {
  await signIn(page);
  await page.goto(`/today/listing/${TRY_DIVE}`);

  await expect(
    page.getByRole("heading", { name: "Try-dive at Nemo Reef" }),
  ).toBeVisible();
  // Price, duration and party size: what the listing IS, before what can be
  // done to it.
  await expect(page.getByText(/₹4,500 per person/)).toBeVisible();
  await expect(
    page.getByText(/180 minutes · Up to 6 per booking/),
  ).toBeVisible();

  // A focused screen, and its way back is where the listings live: Business.
  await expect(
    page.getByRole("link", { name: /Back to your business/i }),
  ).toBeVisible();
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
  /*
    The fixture's two days are read back, not invented: Tuesday and Thursday
    at 09:00, ticked on the picker (yuvoy-operator#111).
  */
  for (const day of ["Tuesday", "Thursday"]) {
    await expect(
      page.getByRole("button", { name: day, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByLabel("Leaves at", { exact: true })).toHaveValue(
    "09:00",
  );

  // Unticking every day turns the save into a question rather than a save.
  for (const day of ["Tuesday", "Thursday"]) {
    await page.getByRole("button", { name: day, exact: true }).click();
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

/** Every row's Manage opened, so what is behind it can be read. */
async function openEveryManage(departures: Locator) {
  const manage = departures.getByRole("button", { name: /^Manage/ });
  const rows = await manage.count();
  for (let i = 0; i < rows; i += 1) await manage.nth(i).click();
  return rows;
}

test("a departure shows one tap, and keeps the rest behind Manage", async ({
  page,
}) => {
  /*
    yuvoy-operator#85 s8: "each departure row offers five choices of equal
    weight, of which one cancels a trip." The row carries the time, what is
    sold and the way into the manifest; Change time, Seats, Stop selling and
    Call off sit behind one Manage.

    Stop selling and Call off stay two controls with those words (op#56 item
    9): they are the two acts an operator confuses, and the difference is
    everything. "Cancel departure" is not one of the product's words and is
    gone. And op#56's other rule holds, "the money effect is said only in the
    confirm step, never in text on the row."
  */
  await signIn(page);
  await page.goto(`/today/listing/${SNORKEL}`);

  const departures = page.getByRole("region", { name: "Next departures" });
  await expect(
    departures.getByRole("link", { name: "Who is booked" }).first(),
  ).toBeVisible();
  for (const act of ["Change time", "Seats", "Stop selling", "Call off"]) {
    await expect(
      departures.getByRole("button", { name: act }).first(),
    ).toBeHidden();
  }

  expect(await openEveryManage(departures)).toBeGreaterThan(0);
  await expect(
    departures.getByRole("button", { name: "Stop selling" }).first(),
  ).toBeVisible();
  await expect(
    departures.getByRole("button", { name: "Call off" }).first(),
  ).toBeVisible();
  await expect(
    departures.getByRole("button", { name: "Cancel departure" }),
  ).toHaveCount(0);

  // And no money on the row itself, opened or not.
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
    Every row's Manage first, because Change time only exists once one is
    opened (#85 s8). Then a row that actually offers the move, not the first
    one: Change time is drawn on an `open` or `closed` departure and withheld
    on a called-off one, and this listing's departures are acted on by the
    calendar and day suites, so whichever ran first decides what the first row
    is.
  */
  const departures = page.getByRole("region", { name: "Next departures" });
  await openEveryManage(departures);

  const row = departures
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

  // Not even the control that would open the rest: there is nothing behind it.
  await expect(page.getByRole("button", { name: /^Manage/ })).toHaveCount(0);
  for (const act of ["Change time", "Seats", "Stop selling", "Call off"]) {
    await expect(page.getByRole("button", { name: act })).toHaveCount(0);
  }
  await expect(
    page.getByRole("heading", { name: "Weekly schedule" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause" })).toHaveCount(0);

  // What they do get: the way into each departure.
  await expect(
    page.getByRole("link", { name: "Who is booked" }).first(),
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
    would be a second chance to get the confirm wrong.
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
  await row.getByRole("button", { name: "Cancel this booking" }).click();

  // Named, so the one tap is made on the right party of eleven (a named
  // confirm, owner ruling 3 Oct 2026). Kept, so nothing is cancelled.
  await expect(
    row.getByText("Cancel Sofia Alves's booking, YV-CARD6N7P?"),
  ).toBeVisible();
  await row.getByRole("button", { name: "Keep it" }).click();
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
  await expect(today(page)).toBeVisible();
  // The selling line open too, when it has reasons, so they are audited.
  const reasons = page.locator("main details summary");
  if (await reasons.count()) await reasons.first().click();

  await expectAccessible(page, "Home, its selling line open");
});

test("the listing hub has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto(`/today/listing/${TRY_DIVE}`);
  await expect(
    page.getByRole("heading", { name: "Try-dive at Nemo Reef" }),
  ).toBeVisible();

  await expectAccessible(page, "the listing hub");
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

/*
  Confirming seats is one-way in the mock, and Home confirms EVERY listing's
  at once, so the listing hub's own walkthrough and Home's cannot share a
  fixture or run in parallel. Serial, on one project, the hub's first: it
  confirms `slot_unconfirmed` on its listing, and `slot_unconfirmed_home` is
  what is still off sale when Home's turn comes.
*/
test.describe.serial("confirming seats", () => {
  test("departures off sale for unconfirmed seats are named, and one tap confirms them", async ({
    page,
  }, testInfo) => {
    /*
      yuvoy-operator#94 items 1 and 2. "Seats set by hand stop being offered to
      travellers once nobody has confirmed them for two days", and no screen said
      so: Sky diving had 19 of 20 departures off sale for it. `exp_nofootage`
      has one such departure, ten days out.

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

    // One call with no dates (yuvoy-api#241): no horizon on the button.
    await page.getByRole("button", { name: "Confirm all" }).click();

    await expect(
      page.getByText("Seats confirmed on 1 departure"),
    ).toBeVisible();
    // The hub re-read underneath the receipt: it has a date to sell now.
    await expect(
      page.getByText("Live, but no dates in the next 30 days"),
    ).toHaveCount(0);
    await expect(page.getByText("1 departure is not on sale")).toHaveCount(0);
  });

  test("Home confirms every listing's seats in one tap, and keeps the receipt", async ({
    page,
  }, testInfo) => {
    /*
      yuvoy-operator#94 item 1, on Home (#96 block 2b): the counts added up
      across listings, with one control that confirms them all. The receipt
      is the half that matters: confirming revalidates Home, and the row that
      offered it is gone in the very render that carries the answer.
    */
    test.skip(
      testInfo.project.name !== "mobile",
      "confirming seats is one-way in the shared mock, so single-tenant by design",
    );
    await signIn(page);

    const row = needsYou(page)
      .getByRole("listitem")
      .filter({ hasText: "off sale: seats not confirmed" });
    await expect(row).toContainText("1 departure is off sale");
    await row.getByRole("button", { name: "Confirm all" }).click();

    await expect(
      needsYou(page).getByText("Seats confirmed on 1 departure"),
    ).toBeVisible();
    // The re-read has nothing off sale left, and the receipt still stands.
    await expect(
      needsYou(page).getByRole("button", { name: "Confirm all" }),
    ).toHaveCount(0);
    await expect(
      needsYou(page).getByText("Seats confirmed on 1 departure"),
    ).toBeVisible();
  });
});
