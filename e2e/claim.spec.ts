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
 *
 * "Open in the app" depends on the phone (manager decision, 29 Oct 13:07):
 * the mobile project is an Android phone, so it gets an `intent://` link to
 * Yuvoy Host; an iPhone gets the Smart App Banner and no button; a computer
 * keeps the claim link.
 */

const HEADING = "Claim this listing in Yuvoy Host";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** What Open in the app links to in this project, for one slug. */
function openHref(slug: string) {
  const link = `https://operators.yuvoy.in/claim/${slug}`;
  if (test.info().project.name !== "mobile") return link;
  const fallback = encodeURIComponent(
    "https://play.google.com/store/apps/details?id=in.yuvoy.operator",
  );
  return `intent://operators.yuvoy.in/claim/${slug}#Intent;scheme=https;package=in.yuvoy.operator;S.browser_fallback_url=${fallback};end`;
}

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
  ).toHaveAttribute("href", openHref("example-reef-divers"));
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
  ).toHaveAttribute("href", openHref("no-such-business-here"));
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

test.describe("on an iPhone", () => {
  test.use({ userAgent: IPHONE });

  test("the Smart App Banner hands Yuvoy Host the claim link, with no button", async ({
    page,
  }) => {
    const response = await page.goto("/claim/example-reef-divers");
    expect(response?.status()).toBe(200);
    await expectClaimPage(page);
    await expect(
      page.getByRole("link", { name: "Open in the app" }),
    ).toHaveCount(0);
    await expect(page.locator('meta[name="apple-itunes-app"]')).toHaveAttribute(
      "content",
      "app-id=6820854539, app-argument=https://operators.yuvoy.in/claim/example-reef-divers",
    );
    await expectAccessible(page, "the claim page on an iPhone");
  });

  test("/claim with no slug still offers the app, with nothing to open", async ({
    page,
  }) => {
    await page.goto("/claim");
    await expect(page.locator('meta[name="apple-itunes-app"]')).toHaveAttribute(
      "content",
      "app-id=6820854539",
    );
  });

  /*
    Safari reads the banner from the page's <head> as it arrives, and Next
    streams some metadata into <body> once it resolves. So this reads the
    HTML the server sends, not the DOM after scripts have run.
  */
  test("the banner is in the <head> the server sends", async ({ request }) => {
    const response = await request.get("/claim/example-reef-divers", {
      headers: { "user-agent": IPHONE },
    });
    const html = await response.text();
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toMatch(
      /<meta name="apple-itunes-app" content="app-id=6820854539, app-argument=https:\/\/operators\.yuvoy\.in\/claim\/example-reef-divers"\s*\/?>/,
    );
  });
});
