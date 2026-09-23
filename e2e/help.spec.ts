import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Settings, and the help behind it: yuvoy-operator#88 s12 and #80 t4.
 *
 * Settings: "Three groups exist to hold one row each, and the group heading
 * repeats the row ... Group only where there are two or more rows." Help: "Cut
 * every sentence that explains what the screen is ... Move the rest into a
 * single help entry under the gear." Read-only, so it runs on both projects.
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";

async function signIn(page: Page, phone = OWNER) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("Settings groups only what has two or more rows, and Money is not in it", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/account/settings");

  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();
  // A heading over three rows stays.
  await expect(
    page.getByRole("heading", { name: "Business", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Help", exact: true }),
  ).toBeVisible();
  // A heading over one row that repeats the row is gone; the row is not.
  for (const name of ["Verification", "Notifications", "Team", "Money"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(
      0,
    );
  }
  for (const name of ["Verification", "Notifications", "Team access"]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }

  // Money is a tab of its own (yuvoy-operator#96): no second way in from here.
  for (const name of [
    /^Earnings/,
    /Cash you.{1,3}ve collected/,
    /^Payout details/,
  ]) {
    await expect(page.getByRole("link", { name })).toHaveCount(0);
  }

  await expect(page.getByRole("link", { name: /^Call Yuvoy/ })).toHaveAttribute(
    "href",
    "tel:+918121657657",
  );
});

test("Help is behind the gear, one closed question per row", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/account/settings");
  await page.getByRole("link", { name: "Help", exact: true }).click();
  await page.waitForURL("**/account/help");

  await expect(
    page.getByRole("heading", { level: 1, name: "Help" }),
  ).toBeVisible();
  // Grouped by where the question comes up.
  await expect(
    page.getByRole("heading", { name: "Money", exact: true }),
  ).toBeVisible();

  // Closed until asked, and open once asked.
  const answer = page.locator("#cash-owed");
  await expect(answer).not.toHaveAttribute("open", "");
  await answer.getByText("When is Yuvoy's share of cash owed?").click();
  await expect(answer).toHaveAttribute("open", "");
  await expect(answer.getByText(/A trip finishes on its own/)).toBeVisible();

  // The way out when the answer is not here, and the way back.
  await expect(page.getByRole("link", { name: /^Call Yuvoy/ })).toHaveAttribute(
    "href",
    "tel:+918121657657",
  );
  await expect(
    page.getByRole("link", { name: "Back to settings" }),
  ).toHaveAttribute("href", "/account/settings");
});

test("a link to an answer lands on it already open, and on nothing else", async ({
  page,
}) => {
  /*
    The fragment never reaches the server, so the answers render closed and
    the named one opens once the page has hydrated. Loaded cold, as a link
    from another screen or a message would be.
  */
  await signIn(page);
  await page.goto("/account/help#bank-change-two-days");

  const answer = page.locator("#bank-change-two-days");
  await expect(answer).toHaveAttribute("open", "");
  await expect(answer.getByText(/It is slow on purpose/)).toBeVisible();
  await expect(page.locator("#cash-owed")).not.toHaveAttribute("open", "");
});

test("/account/help has no accessibility violations, with an answer open", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/account/help#how-payouts-work");
  await expect(page.locator("#how-payouts-work")).toHaveAttribute("open", "");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("/account/settings has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/account/settings");
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
