import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * O11 — what the operator is owed, and why it is that number.
 *
 * Read-only, so the assertions are about what the screen SAYS rather than what
 * it does. The two that matter: an operator must not plan against a figure
 * that can still move, and must know when a bank change is holding the money.
 */

const DEV_CODE = "424242";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill("+919000000101");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("the day links to earnings", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Earnings →" }).click();
  await page.waitForURL("**/earnings");
  await expect(page.getByRole("heading", { name: "Earnings" })).toBeVisible();
});

test("the arithmetic is shown, not just the total", async ({ page }) => {
  await signIn(page);
  await page.goto("/earnings");

  /*
    "An operator asking 'why is this ₹200 less than I expected' should be able
    to answer it here rather than by messaging us." A headline with the
    workings hidden answers a different question.
  */
  await expect(page.getByText("Gross", { exact: true })).toBeVisible();
  await expect(page.getByText("Yuvoy's commission")).toBeVisible();
  await expect(page.getByText("Refunds", { exact: true })).toBeVisible();
  await expect(page.getByText("Net", { exact: true })).toBeVisible();

  // Paise rendered as rupees, in the Indian grouping.
  await expect(page.getByText("₹54,000")).toBeVisible();
  await expect(page.getByText("− ₹8,100")).toBeVisible();
  await expect(page.getByText("₹41,400")).toBeVisible();

  // And it must not claim the figures disagree when they do not.
  await expect(page.getByText("These figures do not add up")).toHaveCount(0);
});

test("a figure that can still move says so; a settled one does not", async ({
  page,
}) => {
  await signIn(page);

  // This month is provisional.
  await page.goto("/earnings");
  await expect(page.getByText(/Still adding up/)).toBeVisible();

  // Last month is settled — no warning, and a different sentence.
  await page.goto("/earnings?month=last");
  await expect(page.getByText(/This period is closed/)).toBeVisible();
  await expect(page.getByText(/Still adding up/)).toHaveCount(0);
});

test("the per-booking gap is stated rather than hidden", async ({ page }) => {
  await signIn(page);
  await page.goto("/earnings");

  // The API returns totals only. Saying so beats an operator hunting for a
  // breakdown that is not there — and it is raised on yuvoy-api, not worked
  // around on the client.
  await expect(page.getByText(/per-booking breakdown/)).toBeVisible();
});

test("/earnings has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/earnings");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
