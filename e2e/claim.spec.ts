import { test, expect, type Page } from "@playwright/test";
import { expectAccessible } from "./axe";

/**
 * `/claim/{slug}` on a phone or a computer without Yuvoy Host
 * (yuvoy-operator#171, cases 3 to 5). The traveller app's "Claim in Yuvoy
 * Host" opens it; with the app installed the phone hands it over and this
 * page never draws, which only a real phone can show.
 *
 * Runs in both projects, so case 3 (a phone) is the mobile one and case 4
 * (a computer) the desktop one. Signed out throughout: the person reading
 * it may have no account yet.
 */

const HEADING = "Claim this listing in Yuvoy Host";

async function expectClaimPage(page: Page) {
  await expect(
    page.getByRole("heading", { level: 1, name: HEADING }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Claiming happens in our app for businesses. Get Yuvoy Host, sign up or sign in as your business, then open this link again.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Yuvoy Host on the App Store" }),
  ).toHaveAttribute("href", "https://apps.apple.com/app/id6820854539");
  await expect(
    page.getByRole("link", { name: "Yuvoy Host on Google Play" }),
  ).toHaveAttribute(
    "href",
    "https://play.google.com/store/apps/details?id=in.yuvoy.operator",
  );
}

test("a listing's claim link: both stores, and Open in the app on the same link", async ({
  page,
}) => {
  const response = await page.goto("/claim/example-reef-divers");
  expect(response?.status()).toBe(200);
  await expectClaimPage(page);
  await expect(
    page.getByRole("link", { name: "Open in the app" }),
  ).toHaveAttribute(
    "href",
    "https://operators.yuvoy.in/claim/example-reef-divers",
  );
  // A signed-out door: no bounce to sign-in (`shell.spec.ts` pins no chrome).
  await expect(page).toHaveURL(/\/claim\/example-reef-divers$/);
  await expectAccessible(page, "the claim page");
});

test("an unknown slug is the same page, never a 404", async ({ page }) => {
  const response = await page.goto("/claim/no-such-business-here");
  expect(response?.status()).toBe(200);
  await expectClaimPage(page);
  await expect(
    page.getByRole("link", { name: "Open in the app" }),
  ).toHaveAttribute(
    "href",
    "https://operators.yuvoy.in/claim/no-such-business-here",
  );
});

for (const path of ["/claim", "/claim/"]) {
  test(`${path} with no slug: the page, with nothing to open`, async ({
    page,
  }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expectClaimPage(page);
    await expect(
      page.getByRole("link", { name: "Open in the app" }),
    ).toHaveCount(0);
    await expectAccessible(page, `the claim page at ${path}`);
  });
}
