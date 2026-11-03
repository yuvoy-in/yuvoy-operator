import { test, expect } from "@playwright/test";
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

/** Dev Kapoor, MANAGER: can manage, and owes nothing on cash. */
const MANAGER = "+919000000102";
/** A new account with two documents to send. */
const PROSPECT = "+919000000105";
/** Signs in fine; the business is on hold. */
const SUSPENDED = "+919000000109";
/** A business with nothing on it yet: the start-selling checklist. */
const NEW_BUSINESS = "+919000000118";

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
    has 24 minutes on it, so it is always the first card.

    The card is the one Bookings draws (operator experiment A, audit 5.3):
    the traveller and the party first, then the trip, the countdown with the
    time it runs out (one phrasing on both screens, 5.13), the seats left to
    give, and 56px answers.
  */
  await signIn(page);
  const first = needsYou(page).getByRole("listitem").first();
  await expect(first).toHaveAccessibleName("Seat request from Reuben Mathai");
  await expect(first).toContainText("Reuben Mathai, 2 people");
  await expect(first).toContainText(
    /Snorkel trip to Elephant Beach · (Today|Tomorrow|[A-Z][a-z]{2} \d+ [A-Z][a-z]{2,3}) at \d\d:\d\d/,
  );
  await expect(first).toContainText("24 min left");
  await expect(first).toContainText(/Answer by \d\d:\d\d/);
  await expect(first).toContainText("6 seats you can still give");
  for (const name of ["Accept", "Decline"]) {
    const button = first.getByRole("button", { name });
    await expect(button).toBeEnabled();
    const box = await button.boundingBox();
    expect(
      box!.height,
      `${name} is a wet thumb's height`,
    ).toBeGreaterThanOrEqual(56);
  }

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

test("an answer on Home waits five seconds with an Undo, and Undo sends nothing", async ({
  page,
}) => {
  /*
    `req_urgent` is never answered by any test, and Undo is what makes that
    still true here: nothing leaves the phone until the five seconds are up.
  */
  await signIn(page);
  const card = needsYou(page).getByRole("listitem", {
    name: "Seat request from Reuben Mathai",
  });
  await card.getByRole("button", { name: "Accept" }).click();

  const held = needsYou(page)
    .getByRole("listitem")
    .filter({ hasText: "Accepting Reuben Mathai, 2 people" });
  await expect(held).toContainText(/Sending in \d seconds?/);
  await held.getByRole("button", { name: "Undo" }).click();

  // The card is back, with focus on the button that was pressed.
  await expect(card.getByRole("button", { name: "Accept" })).toBeFocused();
  // Past the five seconds, and after a fresh read, it is still waiting.
  await page.waitForTimeout(6_000);
  await page.reload();
  await expect(
    needsYou(page).getByRole("listitem", {
      name: "Seat request from Reuben Mathai",
    }),
  ).toBeVisible();
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
  const who =
    testInfo.project.name === "mobile" ? "Meenakshi Rao" : "Tobias Klein";
  await signIn(page);

  const card = needsYou(page).getByRole("listitem", {
    name: `Seat request from ${who}`,
  });
  await card.getByRole("button", { name: "Accept" }).click();
  await expect(
    needsYou(page)
      .getByRole("listitem")
      .filter({ hasText: `Accepting ${who}, 2 people` }),
  ).toBeVisible();
  /*
    The held card, audited here rather than on req_urgent: it sends at five
    seconds whatever axe takes, and this fixture is meant to be sent.
  */
  await expectAccessible(page, "Home, an answer held with its Undo");

  // Sent once the five seconds are up, and then said in the API's words.
  const receipt = needsYou(page)
    .getByRole("listitem")
    .filter({ hasText: `Seats granted to ${who}` });
  await expect(receipt).toBeVisible({ timeout: 15_000 });
  await expect(receipt).toContainText("still have to pay");
  await expectAccessible(page, "Home, the receipt of an accepted request");

  // The page re-reads on focus; the request is gone from it, the receipt is not.
  const refreshed = page.waitForResponse((r) => r.url().includes("_rsc"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await expect(receipt).toBeVisible();
  await expect(
    needsYou(page).getByRole("listitem", { name: `Seat request from ${who}` }),
  ).toHaveCount(0);
});

test("cash to take today is on Home twice: taken party by party, and on its departure", async ({
  page,
}) => {
  /*
    #96 block 2d and block 3, finished in place (experiment A).
    `slot_cash_today` carries one party paying at the counter whom no test
    records, so both projects read the same: the card opens onto Hana's Take
    button, and nothing here presses it.
  */
  await signIn(page);
  const card = needsYou(page)
    .getByRole("listitem", { name: "Cash to take" })
    .filter({ hasText: "Collect ₹4,500 on the 20:30" });
  await expect(card).toContainText("Reef dive (cash today fixture) · 1 party");
  await expect(
    card.getByRole("link", { name: "Open the departure" }),
  ).toHaveAttribute("href", "/today/slot_cash_today");

  await card.getByRole("button", { name: "Take it party by party" }).click();
  await expect(card).toContainText("Hana Ito");
  await expect(card).toContainText("YV-T0DAY4K5");
  await expect(card.getByRole("button", { name: "Take ₹4,500" })).toBeVisible();
  await expect(
    card.getByRole("button", { name: "They paid a different amount" }),
  ).toBeVisible();
  await expectAccessible(page, "Home, the cash card open party by party");

  await expect(
    today(page)
      .getByRole("link")
      .filter({ hasText: "Reef dive (cash today fixture)" }),
  ).toContainText("₹4,500 to collect");
});

test("on a desktop the work and the day sit side by side", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "a desktop layout");
  await signIn(page);
  const work = await needsYou(page).boundingBox();
  const day = await today(page).boundingBox();
  expect(work && day, "both are drawn").toBeTruthy();
  // The day is to the right of the work, not under it.
  expect(day!.x).toBeGreaterThan(work!.x + work!.width - 1);
  expect(day!.y).toBeLessThan(work!.y + work!.height);
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
    #96 block 4: the payout week, when it can be paid, and what is owed.
    What is owed is the commission statements' since op#121: ₹3,550 on two of
    the owner's four, never `/commission-owed`'s ₹4,500, which counts paid
    trips too. The manager has no statement, so that half is left out rather
    than said as zero.
  */
  await signIn(page);
  const owner = page.getByRole("region", { name: "Money" }).getByRole("link");
  await expect(owner).toContainText("₹40,150");
  await expect(owner).toContainText(
    /payout (due|from [A-Z][a-z]{2} \d+ [A-Z][a-z]{2})/,
  );
  await expect(owner).toContainText("commission owed to Yuvoy ₹3,550");
  await expect(owner).not.toContainText("₹4,500");
  await expect(owner).toHaveAttribute("href", "/earnings");

  await page.context().clearCookies();
  await signIn(page, MANAGER);
  const manager = page.getByRole("region", { name: "Money" }).getByRole("link");
  await expect(manager).toContainText("₹40,150");
  await expect(manager).not.toContainText("owed");
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
  /*
    Nothing it would be refused. A guest's message and the cash at the
    gangway are anybody's to answer and take ("whoever is holding the phone"),
    so those cards stay; answering a request and confirming seats do not.
  */
  await expect(
    needsYou(page).getByRole("button", {
      name: /^(Accept|Decline|Confirm all)$/,
    }),
  ).toHaveCount(0);
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
