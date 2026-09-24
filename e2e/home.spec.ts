import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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

const DEV_CODE = "424242";
const OWNER = "+919000000101";
/** Dev Kapoor, MANAGER: can manage, and owes nothing on cash. */
const MANAGER = "+919000000102";
/** Arun, STAFF: gets the day and nothing to change. */
const STAFF = "+919000000103";
/** A new account with two documents to send. */
const PROSPECT = "+919000000105";
/** Signs in fine; the business is on hold. */
const SUSPENDED = "+919000000109";
/** A business with nothing on it yet: the start-selling checklist. */
const NEW_BUSINESS = "+919000000118";
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

const needsYou = (page: Page) =>
  page.getByRole("region", { name: "Needs you" });
const today = (page: Page) =>
  page.getByRole("region", { name: /^Today · \d+ departures? · \d+ guests?$/ });

/* ---------------------------------------------------------------- Home -- */

test("Home opens on whether the business is selling, and never on a name", async ({
  page,
}) => {
  await signIn(page);

  /*
    Block 1, always, and first: one line. The owner's account can sell and
    has listings live, so it says so, with a "but" whenever something is off
    sale or has nothing to sell, which other suites change as they run.
  */
  const main = page.locator("main");
  await expect(main.getByText(/^Selling(, but | · )/).first()).toBeVisible();

  /*
    And nobody's name. Home opened with `me.name` once, a greeting rather than
    information on the screen an operator opens most.
  */
  expect(await main.innerText(), "Home greets nobody").not.toContain(
    "Priya Raut",
  );
});

test("Needs you leads with the requests, each with its clock", async ({
  page,
}) => {
  /*
    #82 s2: "requests waiting first, then messages, then anything else, and
    each labelled with the time pressure". `req_urgent` is never answered and
    has 24 minutes on it, so it is always the first row.
  */
  await signIn(page);
  const first = needsYou(page).getByRole("listitem").first();
  await expect(first).toContainText("Snorkel trip to Elephant Beach");
  await expect(first).toContainText(
    /2 people · (today|tomorrow|[A-Z][a-z]{2}( \d+ [A-Z][a-z]{2})?) \d\d:\d\d · answer within 24 min/,
  );
  await expect(first.getByRole("button", { name: "Accept" })).toBeEnabled();
  await expect(first.getByRole("button", { name: "Decline" })).toBeEnabled();

  /*
    No more than three requests on Home, the rest one row that opens
    Bookings. Asserted as a ceiling, not a count: other suites answer requests
    against the same server while this runs.
  */
  expect(
    await needsYou(page).getByRole("button", { name: "Accept" }).count(),
  ).toBeLessThanOrEqual(3);
  const more = needsYou(page).getByRole("link", {
    name: /more requests? waiting/,
  });
  if (await more.count()) {
    await expect(more).toHaveAttribute("href", "/bookings?view=requests");
  }
});

test("a request accepted on Home keeps its receipt through a refresh", async ({
  page,
}, testInfo) => {
  /*
    The one thing an accept leaves behind: the traveller holds seats and
    "still has to pay". The request leaves the queue the moment it is
    accepted, and the list re-reads on every focus, so the receipt must live
    above the rows. One fixture per project: accepting is one-way.
  */
  const mine =
    testInfo.project.name === "mobile"
      ? { clock: "answer within 1h 30m", who: "Meenakshi Rao" }
      : { clock: "answer within 1h 35m", who: "Tobias Klein" };
  await signIn(page);

  const row = needsYou(page)
    .getByRole("listitem")
    .filter({ hasText: mine.clock });
  await row.getByRole("button", { name: "Accept" }).click();

  const receipt = needsYou(page)
    .getByRole("listitem")
    .filter({ hasText: `Seats granted to ${mine.who}` });
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("still have to pay");

  // The page re-reads on focus; the request is gone from it, the receipt is not.
  const refreshed = page.waitForResponse((r) => r.url().includes("_rsc"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await expect(receipt).toBeVisible();
  await expect(
    needsYou(page).getByRole("listitem").filter({ hasText: mine.clock }),
  ).toHaveCount(0);
});

test("cash to take today is on Home twice: what needs doing, and its departure", async ({
  page,
}) => {
  /*
    #96 block 2d and block 3. `slot_cash_today` carries one party paying at
    the counter whom no test records, so both projects read the same.
  */
  await signIn(page);
  await expect(
    needsYou(page).getByRole("link", {
      name: /^Collect ₹4,500 from 1 party on the 20:30/,
    }),
  ).toHaveAttribute("href", "/today/slot_cash_today");
  await expect(
    today(page)
      .getByRole("link")
      .filter({ hasText: "Reef dive (cash today fixture)" }),
  ).toContainText("₹4,500 to collect");
});

test("the day leaves out what nobody can be on, and says each state in words", async ({
  page,
}) => {
  /*
    #82 s1 and #96 block 3: "Only departures that can hold people." The
    charter was called off, so everybody on it was cancelled and it is not
    part of the day. Every row says its state in words beside sold/seats.
  */
  await signIn(page);
  const day = today(page);
  await expect(day).toBeVisible();
  await expect(day).not.toContainText("Private boat charter");

  // The dawn dive has always left by the time anybody looks.
  const dawn = day
    .getByRole("link")
    .filter({ hasText: "Try-dive at Nemo Reef" });
  await expect(dawn).toContainText("Departed");
  await expect(dawn).toContainText(/\d+\/\d+/);
});

test("Tomorrow is one tap away, and needs no second read", async ({ page }) => {
  await signIn(page);
  await page.getByText("Tomorrow", { exact: true }).click();

  const tomorrow = page.getByRole("region", {
    name: /^Tomorrow · \d+ departures? · \d+ guests?$/,
  });
  await expect(tomorrow).toBeVisible();
  // Tomorrow's cash dive, which today's sheet does not carry.
  await expect(
    tomorrow.getByRole("link").filter({ hasText: "Reef dive" }),
  ).toHaveCount(1);
  await expect(today(page)).toHaveCount(0);
});

test("money today is one line for a login that can manage", async ({
  page,
}) => {
  /*
    #96 block 4: the payout week, when it can be paid, and what is owed on
    cash. The owner owes on three cash trips; the manager's figures owe
    nothing, so the cash half is left out rather than said as zero.
  */
  await signIn(page);
  const owner = page.getByRole("region", { name: "Money" }).getByRole("link");
  await expect(owner).toContainText("₹40,150");
  await expect(owner).toContainText(
    /payout (due|from [A-Z][a-z]{2} \d+ [A-Z][a-z]{2})/,
  );
  await expect(owner).toContainText("cash owed to Yuvoy ₹4,500");
  await expect(owner).toHaveAttribute("href", "/earnings");

  await page.context().clearCookies();
  await signIn(page, MANAGER);
  const manager = page.getByRole("region", { name: "Money" }).getByRole("link");
  await expect(manager).toContainText("₹40,150");
  await expect(manager).not.toContainText("cash owed");
});

test("past cash trips nobody recorded are a row, opening what closes them", async ({
  page,
}) => {
  // yuvoy-api#221, on #96: "7 past cash trips have no payment recorded".
  await signIn(page);
  await expect(
    needsYou(page).getByRole("link", {
      name: /^1 past cash trip has no payment recorded/,
    }),
  ).toHaveAttribute("href", "/cash#unrecorded");
});

test("the listings are one line that opens Business", async ({ page }) => {
  await signIn(page);
  const glance = page
    .getByRole("region", { name: "Listings" })
    .getByRole("link");
  await expect(glance).toContainText(/^\d+ live/);
  await expect(glance).toContainText(/draft/);
  await glance.click();
  await page.waitForURL("**/account");

  // And the listing tiles are not on Home any more.
  await page.goto("/today");
  await expect(page.getByRole("region", { name: "Your listings" })).toHaveCount(
    0,
  );
});

test("a staff phone gets the day, the queue as one row, and nothing it would be refused", async ({
  page,
}) => {
  /*
    Every money read refuses STAFF, and so do answering a request, confirming
    seats and adding departures. So: no money block, and no button that would
    come back as a refusal. The queue is still said, because a request nobody
    sees is a request that expires.
  */
  await signIn(page, STAFF);
  await expect(page.getByRole("region", { name: "Money" })).toHaveCount(0);
  await expect(needsYou(page).getByRole("button")).toHaveCount(0);
  await expect(
    needsYou(page).getByRole("link", {
      name: /requests? (is|are) waiting on an answer/,
    }),
  ).toHaveAttribute("href", "/bookings?view=requests");
  await expect(today(page)).toBeVisible();
});

test("an account that cannot sell says so first, and leads with what fixes it", async ({
  page,
}) => {
  /*
    #96 "States": "Blocked: block 1 red, and Needs you leads with the one
    thing that unblocks selling". This account owes two documents.
  */
  await signIn(page, PROSPECT);
  const status = page.getByText("Not selling: 2 documents needed");
  await expect(status).toBeVisible();

  // Tapping the line opens the reasons, each with its way forward.
  await status.click();
  await expect(
    page.getByRole("link", { name: "Send us the document" }).first(),
  ).toBeVisible();

  const first = needsYou(page).getByRole("link").first();
  await expect(first).toContainText(
    "We still need your tourism department registration",
  );
  await expect(first).toHaveAttribute("href", "/profile#documents");
});

test("an account on hold is told so, offered the call, and never offered a sale", async ({
  page,
}) => {
  await signIn(page, SUSPENDED);
  await expect(
    page.getByText("Not selling: your account is on hold"),
  ).toBeVisible();
  const call = needsYou(page).getByRole("link").first();
  await expect(call).toContainText("Your account is on hold");
  await expect(call).toHaveAttribute("href", "tel:+918121657657");
  /*
    Accepting takes a traveller on, which an account on hold may not do; a
    decline lets one go, which it always may (yuvoy-operator#50).
  */
  await expect(
    needsYou(page).getByRole("button", { name: "Accept" }),
  ).toHaveCount(0);
  await expect(
    needsYou(page).getByRole("button", { name: "Decline" }).first(),
  ).toBeVisible();
});

test("a new business gets the start-selling checklist in place of the day", async ({
  page,
}) => {
  /*
    #96 "States": "New operator, nothing live: a start-selling checklist
    (details, documents, first listing, first departure, first reel) replaces
    blocks 3 to 5 until the first sale."
  */
  await signIn(page, NEW_BUSINESS);
  const steps = page.getByRole("region", { name: "Start selling" });
  await expect(steps).toBeVisible();
  await expect(steps).toContainText("1 of 5 done");
  await expect(steps.getByRole("listitem")).toHaveText([
    /Tell us about your business/,
    /Send your documents/,
    /Write your first listing/,
    /Add your first departure/,
    /Add your first reel/,
  ]);
  await expect(
    steps.getByRole("link", { name: "Write your first listing" }),
  ).toHaveAttribute("href", "/account/listings/new");

  // Blocks 3 to 5 are what it replaced.
  await expect(page.getByRole("region", { name: /departures?/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("region", { name: "Money" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Listings" })).toHaveCount(0);

  /*
    And nothing needs them but the two documents. A business that has sold
    nothing can have no cash to take, no request waiting and no past trip
    with cash unrecorded, so a row saying otherwise is this portal reading
    somebody else's figures.
  */
  await expect(needsYou(page).getByRole("listitem")).toHaveCount(2);
  await expect(needsYou(page).getByRole("listitem").first()).toContainText(
    "We still need your tourism department registration",
  );
});

test("Home has no paragraph explaining itself", async ({ page }) => {
  await signIn(page);

  const main = await page.locator("main").innerText();
  for (const gone of [
    "Everyone who has booked you",
    "No departures today. If that is wrong",
    "A departure that is not here is one Yuvoy cannot sell",
    "Nothing scheduled",
    "Your listings",
  ]) {
    expect(main, `"${gone}" came off Home`).not.toContain(gone);
  }
});

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
  await expect(today(page)).toBeVisible();
  // The selling line open too, when it has reasons, so they are audited.
  const reasons = page.locator("main details summary");
  if (await reasons.count()) await reasons.first().click();

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

    await page
      .getByRole("button", { name: "Confirm seats for the next 12 months" })
      .click();

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
