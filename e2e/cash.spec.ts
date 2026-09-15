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

test("the business door leads to it", async ({ page }) => {
  await signIn(page, OWNER);
  // The doors moved behind the gear on the profile, #58 item 9.
  await page.goto("/account/settings");
  await page.getByRole("link", { name: /Cash you.{1,3}ve collected/ }).click();
  await page.waitForURL("**/cash");
  await expect(
    page.getByRole("heading", { name: /Cash you.{1,3}ve collected/ }),
  ).toBeVisible();
});

test("it leads with what was collected, and the share reads as a share", async ({
  page,
}) => {
  await signIn(page, OWNER);
  await page.goto("/cash");

  /*
    Collected first, share second. The order is the argument: our cut reads as
    a share of money already in their hand rather than a bill out of nowhere.
  */
  await expect(page.getByText("₹30,000")).toBeVisible();
  await expect(page.getByText("taken from travellers")).toBeVisible();
  await expect(page.getByText("₹4,500")).toBeVisible();
  await expect(page.getByText(/Yuvoy.{1,3}s share/)).toBeVisible();

  /*
    The wording rules, as assertions. "Cash taken" and "collected", never
    "paid" — they were paid, we were not. And never "commission due" or
    "outstanding", which make a share of their own money sound like a demand.
  */
  const body = (await page.locator("body").textContent()) ?? "";
  expect(body).not.toMatch(/commission due|amount due|outstanding balance/i);
  expect(body).not.toMatch(/we are holding|held by Yuvoy/i);
});

test("every trip behind the number is listed and checkable", async ({
  page,
}) => {
  await signIn(page, OWNER);
  await page.goto("/cash");

  // Reference, date, guests, fare and share — the five things that let an
  // operator check a line against their own book.
  await expect(page.getByText("YV-8F3K2A")).toBeVisible();
  await expect(page.getByText("YV-2M9QX1")).toBeVisible();
  await expect(page.getByText("YV-7T4WPZ")).toBeVisible();
  await expect(page.getByText("2 guests")).toBeVisible();
  await expect(page.getByText("1 guest", { exact: true })).toBeVisible();

  // Most recent first, so two loads do not disagree about the top row.
  const refs = await page.locator("li p.font-mono").allTextContents();
  expect(refs).toEqual(["YV-8F3K2A", "YV-2M9QX1", "YV-7T4WPZ"]);
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

test("there is no way to pay from this screen, and it says why", async ({
  page,
}) => {
  /*
    Deliberate. Settling is money moving back to us — the same class of act as
    money leaving — and the payout run spends two tables and three signatures
    getting that right. A silence here would read as an omission.
  */
  await signIn(page, OWNER);
  await page.goto("/cash");

  await expect(page.getByRole("button", { name: /pay|settle/i })).toHaveCount(
    0,
  );
  await expect(page.getByText(/nothing to tap here/i)).toBeVisible();
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
  await expect(owed.getByRole("button", { name: "Cash taken" })).toBeVisible();
  // A separate act from arriving — "somebody can turn up and not pay".
  await expect(
    owed.getByRole("button", { name: "Here", exact: true }),
  ).toBeVisible();

  // Paid online: nothing to collect, and nothing said about cash.
  const card = page.locator("li").filter({ hasText: "Sofia Alves" });
  await expect(card.getByRole("button", { name: /Cash taken/ })).toHaveCount(0);
  await expect(card.getByText(/to take in cash|taken ·/)).toHaveCount(0);

  // Already taken: read plainly, "with no way to tap it again".
  const taken = page.locator("li").filter({ hasText: "Meera Das" });
  await expect(taken.getByText("₹9,000 taken · 08:10")).toBeVisible();
  await expect(
    taken.getByRole("button", { name: /Cash taken|Took less/ }),
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
    theirs.getByRole("button", { name: "Cash taken" }),
  ).toBeVisible();

  const mine = page.locator("li").filter({ hasText: who });
  await mine.getByRole("button", { name: "Cash taken" }).click();
  await expect(mine.getByText(/^₹9,000 taken · \d\d:\d\d$/)).toBeVisible();
  await expect(mine.getByRole("button", { name: "Cash taken" })).toHaveCount(0);

  /*
    The retry, which "will happen" and "must not be punished": the API answers
    it with the first report and `alreadyRecorded`. The stale phone shows the
    recorded state — not an error, and not a second confirmation.
  */
  await theirs.getByRole("button", { name: "Cash taken" }).click();
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
  await row.getByRole("button", { name: "Took less" }).click();
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
  await expect(page.getByRole("button", { name: "Cash taken" })).toBeVisible();

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
  await expect(owed.getByRole("button", { name: "Cash taken" })).toBeEnabled();
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
