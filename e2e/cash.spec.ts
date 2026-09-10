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
  await page.goto("/account");
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
