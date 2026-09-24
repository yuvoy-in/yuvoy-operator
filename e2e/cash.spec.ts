import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * yuvoy-operator#40 §2 — what the operator owes us on cash we never handled.
 *
 * Read-only, so the assertions are about what the screen SAYS. Two claims
 * carry the whole design:
 *
 *   - **Every line is checkable.** A total on its own invites "that cannot be
 *     right" and gives nobody a way to answer it. So the trips behind the
 *     number are listed, with reference, date, guests, fare and share.
 *   - **Nothing implies Yuvoy is holding the fare.** We are not: the traveller
 *     paid the operator directly and `capturedAmountPaise` is `0` on these
 *     bookings for their whole life.
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";
/** Dev Kapoor. A MANAGER, and the fixture that owes nothing. */
const MANAGER = "+919000000102";
/** Arun Biswas. STAFF — the money is not theirs to see. */
const STAFF = "+919000000103";

async function signIn(page: Page, phone: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("Money leads to it, and it goes back to Money", async ({ page }) => {
  /*
    Cash sits behind the Money tab (yuvoy-operator#96), not behind Settings,
    so the way in is the cash summary there and the way back is to Money.
  */
  await signIn(page, OWNER);
  await page.goto("/earnings");
  await page.getByRole("link", { name: /Cash you.{1,3}ve collected/ }).click();
  await page.waitForURL("**/cash");
  await expect(
    page.getByRole("heading", { name: /Cash you.{1,3}ve collected/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to Money" }),
  ).toHaveAttribute("href", "/earnings");
});

test("it leads with what was collected, and the share reads as a share", async ({
  page,
}) => {
  await signIn(page, OWNER);
  await page.goto("/cash");

  /*
    Collected first, share second. The order is the argument: our cut reads as
    a share of money already in their hand rather than a bill out of nowhere.

    And ALL of what is in their hand (op#94 item 4): ₹27,000 recorded on the
    completed trips plus ₹15,000 taken for trips still to run. It showed the
    first half only, which is how ₹10,000 sat on screen against ₹25,000 taken.
  */
  await expect(page.getByText("₹42,000")).toBeVisible();
  await expect(
    page.getByText("recorded as taken from travellers"),
  ).toBeVisible();
  /*
    The two shares, read off the summary's own rows: a trip line can carry the
    same figure (YV-7T4WPZ's share is ₹2,250 too).
  */
  const share = (label: RegExp) =>
    page.locator("dl > div").filter({ hasText: label }).locator("dd");
  await expect(share(/owed now/)).toHaveText("₹4,500");
  await expect(share(/trips still to run/)).toHaveText("₹2,250");

  /*
    The wording rules, as assertions. "Cash taken" and "collected", never
    "paid" — they were paid, we were not. And never "commission due" or
    "outstanding", which make a share of their own money sound like a demand.
  */
  const body = (await page.locator("body").textContent()) ?? "";
  expect(body).not.toMatch(/commission due|amount due|outstanding balance/i);
  expect(body).not.toMatch(/we are holding|held by Yuvoy/i);

  /*
    Nothing above the heading: not the signed-in person's name, which read as
    one staff member's takings on a shared phone (op#87 t3), and not an
    eyebrow saying "The money" over a heading that already said it (op#80 t2).
  */
  const main = await page.locator("main").innerText();
  expect(main).not.toContain("Priya Raut");
  expect(main).not.toMatch(/the money/i);
});

test("every trip behind the number is listed and checkable", async ({
  page,
}) => {
  await signIn(page, OWNER);
  await page.goto("/cash");

  // Reference, date, guests, fare and share: the five things that let an
  // operator check a line against their own book.
  const owed = page.getByRole("region", { name: "Owed now" });
  await expect(owed.getByText("YV-8F3K2A")).toBeVisible();
  await expect(owed.getByText("YV-2M9QX1")).toBeVisible();
  await expect(owed.getByText("YV-7T4WPZ")).toBeVisible();
  await expect(owed.getByText("2 guests")).toBeVisible();
  await expect(owed.getByText("1 guest", { exact: true })).toBeVisible();

  // Most recent first, so two loads do not disagree about the top row. A
  // waiting assertion: a bare read can land on the loading skeleton.
  await expect(owed.locator("li p.font-mono")).toHaveText([
    "YV-8F3K2A",
    "YV-2M9QX1",
    "YV-7T4WPZ",
  ]);
});

test("cash taken for trips still to run is shown apart from what is owed", async ({
  page,
}) => {
  /*
    op#94 item 4. Held cash is the operator's, with our share owed only once
    the trip is done, so it is its own list, soonest trip first: the next one
    is the one they are about to take money for.
  */
  await signIn(page, OWNER);
  await page.goto("/cash");

  const held = page.getByRole("region", { name: "Held, trip still to run" });
  // Waiting, not a bare read: a bare read landed on the loading skeleton and
  // found nothing.
  await expect(held.locator("li p.font-mono")).toHaveText([
    "YV-H3LD0A1",
    "YV-H3LD0B2",
  ]);
  await expect(
    page.getByRole("region", { name: "Owed now" }),
  ).not.toContainText("YV-H3LD0A1");
});

test("a trip that ran with no cash recorded is named, with the way to close it", async ({
  page,
}) => {
  /*
    yuvoy-api#221. The trip happened and nothing says whether the business was
    paid, so it is in no held or owed figure, and only the operator can close
    it: record the cash, or mark the party a no-show.
  */
  await signIn(page, OWNER);
  await page.goto("/cash");

  const unrecorded = page.getByRole("region", { name: "No cash recorded" });
  await expect(
    unrecorded.getByText("1 past cash trip has no payment recorded"),
  ).toBeVisible();
  await expect(unrecorded.getByText("YV-UNR3C0D")).toBeVisible();
  await expect(
    unrecorded.getByRole("link", { name: "Open the booking" }),
  ).toHaveAttribute("href", "/bookings?view=past&q=YV-UNR3C0D");
});

test("a shortfall is explained rather than left looking like an error", async ({
  page,
}) => {
  /*
    "Our commission is owed on the fare, not on what you chose to take. A
    discount you gave is yours to have given." Without a sentence, that row's
    share looks like the wrong percentage of the amount beside it — which is
    the one line an operator would ring us about.
  */
  await signIn(page, OWNER);
  await page.goto("/cash");

  const row = page.locator("li").filter({ hasText: "YV-7T4WPZ" });
  await expect(row.getByText(/You recorded taking ₹12,000/)).toBeVisible();
  await expect(row.getByText(/worked out on the fare/)).toBeVisible();
});

test("owing nothing is a sentence, not a table of zeroes", async ({ page }) => {
  // Real and common: every cash trip settled, or none taken yet. Not an error
  // and not a spinner.
  await signIn(page, MANAGER);
  await page.goto("/cash");

  await expect(page.getByText("Nothing owed")).toBeVisible();
  await expect(page.getByText(/Everything.{1,3}s settled/)).toBeVisible();
  await expect(page.getByText("₹0")).toHaveCount(0);
});

test("there is no way to pay from this screen, and why is one tap away", async ({
  page,
}) => {
  /*
    Deliberate. Settling is money moving back to us, the same class of act as
    money leaving, and the payout run spends two tables and three signatures
    getting that right. The reason used to close every visit as a paragraph
    ("There is nothing to tap here", op#80 t4); it is an answer in Help now,
    one tap from the foot of the screen.
  */
  await signIn(page, OWNER);
  await page.goto("/cash");

  await expect(page.getByRole("button", { name: /pay|settle/i })).toHaveCount(
    0,
  );
  await expect(page.getByText(/nothing to tap here/i)).toHaveCount(0);

  await page.getByRole("link", { name: /How to settle Yuvoy.s share/ }).click();
  await page.waitForURL(/\/account\/help\?from=%2Fcash#settling-cash$/);
  const answer = page.locator("#settling-cash");
  await expect(answer).toHaveAttribute("open", "");
  await expect(answer.getByText(/There is no pay button/)).toBeVisible();
});

test("staff are told, not refused into the error boundary", async ({
  page,
}) => {
  /*
    Refused before the request rather than after it: "a staff member who can
    see today's manifest does not need the margin on it." A 403 landing on the
    error boundary says "that did not load — try again", which is false and
    unactionable.
  */
  await signIn(page, STAFF);
  await page.goto("/cash");

  await expect(page.getByText(/for whoever handles the money/i)).toBeVisible();
  await expect(page.getByText(/did not load/i)).toHaveCount(0);
});

test("/cash has no accessibility violations", async ({ page }) => {
  await signIn(page, OWNER);
  await page.goto("/cash");
  await expect(
    page.getByRole("heading", { name: /Cash you.{1,3}ve collected/ }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

/* =========================================== §1 · taking cash at the counter */

/**
 * yuvoy-operator#40 §1 — recording that the money was taken.
 *
 * `slot_cash` is tomorrow's Reef dive, and it carries a party for every state
 * the collection has to tell apart. Recording mutates the Next server both
 * projects share, so each walkthrough takes a party of its own; the rest are
 * read and never touched.
 */
const CASH_DEPARTURE = "/today/slot_cash";

function mineToCollect(project: string) {
  return project === "mobile"
    ? { whole: "Kavya Iyer", less: "Lena Park" }
    : { whole: "Tom Becker", less: "Omar Haddad" };
}

test("a cash booking says what to take, and a card booking says nothing", async ({
  page,
}) => {
  await signIn(page, OWNER);
  await page.goto(CASH_DEPARTURE);

  const owed = page.locator("li").filter({ hasText: "Anil Kumar" });
  await expect(owed.getByText("₹9,000 to take in cash")).toBeVisible();
  // One button that names the amount it records (yuvoy-operator#81 s5).
  await expect(owed.getByRole("button", { name: "Take ₹9,000" })).toBeVisible();
  // A separate act from arriving — "somebody can turn up and not pay".
  await expect(
    owed.getByRole("button", { name: "Check in", exact: true }),
  ).toBeVisible();

  // Paid online: nothing to collect, and nothing said about cash.
  const card = page.locator("li").filter({ hasText: "Sofia Alves" });
  await expect(card.getByRole("button", { name: /^Take / })).toHaveCount(0);
  await expect(card.getByText(/to take in cash|taken ·/)).toHaveCount(0);

  // Already taken: read plainly, "with no way to tap it again".
  const taken = page.locator("li").filter({ hasText: "Meera Das" });
  await expect(taken.getByText("₹9,000 taken · 08:10")).toBeVisible();
  await expect(
    taken.getByRole("button", { name: /^Take |different amount/ }),
  ).toHaveCount(0);
});

test("the whole fare is one tap, and a second phone's tap is not an error", async ({
  page,
}, testInfo) => {
  const who = mineToCollect(testInfo.project.name).whole;
  await signIn(page, OWNER);
  await page.goto(CASH_DEPARTURE);

  // A second phone at the same business, loaded before the first one taps.
  const second = await page.context().newPage();
  await second.goto(CASH_DEPARTURE);
  const theirs = second.locator("li").filter({ hasText: who });
  await expect(
    theirs.getByRole("button", { name: "Take ₹9,000" }),
  ).toBeVisible();

  const mine = page.locator("li").filter({ hasText: who });
  await mine.getByRole("button", { name: "Take ₹9,000" }).click();
  await expect(mine.getByText(/^₹9,000 taken · \d\d:\d\d$/)).toBeVisible();
  await expect(mine.getByRole("button", { name: "Take ₹9,000" })).toHaveCount(
    0,
  );

  /*
    The retry, which "will happen" and "must not be punished": the API answers
    it with the first report and `alreadyRecorded`. The stale phone shows the
    recorded state — not an error, and not a second confirmation.
  */
  await theirs.getByRole("button", { name: "Take ₹9,000" }).click();
  await expect(theirs.getByText(/^₹9,000 taken · \d\d:\d\d$/)).toBeVisible();
  await expect(theirs.getByRole("alert")).toHaveCount(0);
  await expect(theirs.getByText(/short of the fare/)).toHaveCount(0);
  await second.close();

  // A fact on the booking, not a state of the page: it survives a reload.
  await page.reload();
  await expect(
    page
      .locator("li")
      .filter({ hasText: who })
      .getByText(/₹9,000 taken/),
  ).toBeVisible();
});

test("taking less says the gap before it is recorded, and once after", async ({
  page,
}, testInfo) => {
  const who = mineToCollect(testInfo.project.name).less;
  await signIn(page, OWNER);
  await page.goto(CASH_DEPARTURE);

  const row = page.locator("li").filter({ hasText: who });
  await row
    .getByRole("button", { name: "They paid a different amount" })
    .click();
  const box = row.getByLabel("What you took, in rupees");

  // More than the fare is refused before anything is sent.
  await box.fill("14000");
  await expect(row.getByText(/more than the fare of ₹13,500/)).toBeVisible();
  await expect(row.getByRole("button", { name: /^Record/ })).toBeDisabled();

  // The mis-key is visible while it can still be fixed.
  await box.fill("3000");
  await expect(
    row.getByText("That is ₹10,500 less than the fare of ₹13,500."),
  ).toBeVisible();
  await row.getByRole("button", { name: "Record ₹3,000" }).click();

  await expect(
    row.getByText("Recorded ₹3,000. That is ₹10,500 short of the fare."),
  ).toBeVisible();
  await expect(
    row.getByText(/^₹3,000 taken of ₹13,500 · \d\d:\d\d$/),
  ).toBeVisible();

  // "Say it once, quietly": a reload keeps the fact and drops the sentence.
  await page.reload();
  const after = page.locator("li").filter({ hasText: who });
  await expect(after.getByText(/₹3,000 taken of ₹13,500/)).toBeVisible();
  await expect(after.getByText(/short of the fare/)).toHaveCount(0);
});

test("the bookings list asks for the cash, and never says a payment is clearing", async ({
  page,
}) => {
  /*
    YV-5DT6RKVQ in production: a cash booking read "Payment clearing", because
    `paid_pending_ops` was all the screen had. Nothing was clearing.
  */
  await signIn(page, OWNER);
  // The Upcoming pill, which is where the rows are since yuvoy-operator#57
  // replaced the three anchored sections with four.
  await page.goto("/bookings?view=upcoming");

  const owed = page
    .locator("main")
    .getByRole("link")
    .filter({ hasText: "Anil Kumar" });
  await expect(owed.getByText("Collect ₹9,000")).toBeVisible();

  const body = await page.locator("body").innerText();
  expect(body).not.toContain("Payment clearing");
});

test("a cash booking's own page offers the collection, and no card arithmetic", async ({
  page,
}) => {
  await signIn(page, OWNER);
  await page.goto("/bookings/bkg_cash_owed");

  await expect(
    page.getByRole("heading", { name: "Cash at the counter" }),
  ).toBeVisible();
  /*
    The screen's one primary action while the fare is owed (yuvoy-operator#81
    s5): a filled button naming the amount, and a quieter link for any other.
  */
  const take = page.getByRole("button", { name: "Take ₹9,000" });
  await expect(take).toBeVisible();
  await expect(take).toHaveClass(/bg-forest/);
  await page
    .getByRole("button", { name: "They paid a different amount" })
    .click();
  await expect(page.getByLabel("What you took, in rupees")).toBeVisible();

  /*
    The API sends `money` on a cash booking as gross ₹0, the share as
    commission and a NEGATIVE net. As arithmetic that says the operator lost
    money on a trip they were paid for in full.
  */
  await expect(page.getByText("Yuvoy's commission")).toHaveCount(0);
  await expect(page.getByText(/−\s*₹/)).toHaveCount(0);
  await expect(page.getByText(/No money has moved/)).toHaveCount(0);
});

test("staff can take the cash — whoever holds the phone at the gangway", async ({
  page,
}) => {
  // Not role-gated in the contract, so not gated here: "a crew member who
  // cannot record it records it later from memory".
  await signIn(page, STAFF);
  await page.goto(CASH_DEPARTURE);
  const owed = page.locator("li").filter({ hasText: "Anil Kumar" });
  await expect(owed.getByRole("button", { name: "Take ₹9,000" })).toBeEnabled();
});

test("/today/slot_cash has no accessibility violations", async ({ page }) => {
  await signIn(page, OWNER);
  await page.goto(CASH_DEPARTURE);
  await expect(page.getByText("₹9,000 taken · 08:10")).toBeVisible();
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
