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

test("a tab root names exactly five destinations, and says where you are", async ({
  page,
}) => {
  /*
    Five since yuvoy-operator#22. Services joined the bar because the catalogue
    — what a business sells and the footage that sells it — is the work rather
    than the back office, and burying it behind the Business door is what made
    it unreachable.

    The count is asserted rather than left loose: a sixth stop is a width
    decision, not a routing one, and the bar is already about 330px at its
    longest.
  */
  await signIn(page);
  const nav = page.getByRole("navigation", { name: /Primary/i }).first();
  await expect(nav.getByRole("link")).toHaveCount(5);
  await expect(nav.locator('a[aria-current="page"]')).toHaveText(/Today/i);
});

test("the bar reaches every destination", async ({ page }) => {
  await signIn(page);
  for (const [name, path, heading] of [
    ["Requests", "/requests", "Requests"],
    ["Capacity", "/capacity", "Capacity"],
    ["Services", "/services/activities", "Activities"],
    ["Business", "/account", "Your account is live"],
  ] as const) {
    await page
      .getByRole("navigation", { name: /Primary/i })
      .first()
      .getByRole("link", { name })
      .click();
    await page.waitForURL(`**${path}`);
    /*
      `exact`, because Activities carries a section heading counting them —
      "4 activities" — and a substring match resolves to both. The page's own
      h1 is what says you arrived.
    */
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
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
    await expect(primary.getByRole("link")).toHaveCount(5);
  }
});

for (const route of [
  "/today",
  "/requests",
  "/capacity",
  "/services/activities",
  "/services/reels",
  "/account",
]) {
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

/**
 * The rail is pinned, and it is the height of the WINDOW.
 *
 * As an ordinary flex item it scrolled away, and every screen in this portal
 * is long enough for that to bite: all six measured taller than a 720px
 * window, /team at 2339px. An operator halfway down the team list had no
 * navigation at all. Being a flex item also stretched it to the DOCUMENT's
 * height, so the rail was 2339px of chrome drawing 250px of links.
 *
 * Neither is visible in a screenshot of the top of the page, which is why this
 * measures. Desktop only: below `lg` there is no rail and the bar is fixed.
 */
test("the rail stays put while the page scrolls", async ({
  page,
  isMobile,
}) => {
  test.skip(Boolean(isMobile), "no rail below lg");
  await signIn(page);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport");
  const rail = page.locator("aside");

  // /team is the longest screen in the portal, and the one an operator scrolls.
  await page.goto("/team");
  await page.waitForLoadState("networkidle");

  const before = await rail.boundingBox();
  if (!before) throw new Error("no rail");

  expect(
    before.height,
    "the rail is as tall as the window, not the document",
  ).toBeLessThanOrEqual(viewport.height + 1);

  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(250);

  expect(
    await page.evaluate(() => window.scrollY),
    "the page scrolled",
  ).toBeGreaterThan(500);

  const after = await rail.boundingBox();
  if (!after) throw new Error("no rail after scrolling");
  expect(
    Math.abs(after.y - before.y),
    "the rail did not move with the page",
  ).toBeLessThan(2);

  // And it is still a usable navigation once you are down the page.
  await expect(
    page.getByRole("navigation", { name: /Primary/i }).getByRole("link"),
  ).toHaveCount(5);
});
