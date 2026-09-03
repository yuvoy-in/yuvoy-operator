import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The chassis (v2.7): the floating bar on a tab root, the back control on a
 * focused screen, no chrome at all on a signed-out door — and accessibility
 * on the screens that carry the new chrome.
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

test("the sign-in door draws no navigation", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("navigation", { name: /Primary/i })).toHaveCount(
    0,
  );
});

test("a tab root names exactly four destinations, and says where you are", async ({
  page,
}) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: /Primary/i }).first();
  await expect(nav.getByRole("link")).toHaveCount(4);
  await expect(nav.locator('a[aria-current="page"]')).toHaveText(/Today/i);
});

test("the bar reaches every destination", async ({ page }) => {
  await signIn(page);
  for (const [name, path, heading] of [
    ["Requests", "/requests", "Requests"],
    ["Capacity", "/capacity", "Capacity"],
    ["Business", "/account", "Your account is live"],
  ] as const) {
    await page
      .getByRole("navigation", { name: /Primary/i })
      .first()
      .getByRole("link", { name })
      .click();
    await page.waitForURL(`**${path}`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("a focused screen hides the bar and offers a way back", async ({
  page,
  isMobile,
}) => {
  await signIn(page);
  await page.getByText("Try-dive at Nemo Reef").click();
  await page.waitForURL(/\/today\/.+/);

  await expect(
    page.getByRole("link", { name: "Back to the day" }),
  ).toBeVisible();

  const primary = page.getByRole("navigation", { name: /Primary/i });
  if (isMobile) {
    await expect(primary).toHaveCount(0);
  } else {
    await expect(primary.getByRole("link")).toHaveCount(4);
  }
});

for (const route of ["/today", "/requests", "/capacity", "/account"]) {
  test(`${route} has no accessibility violations with the new chrome`, async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
