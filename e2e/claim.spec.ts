import { test, expect, type Page } from "@playwright/test";
import { expectAccessible } from "./axe";

/**
 * `/claim/{slug}` signed out, on a phone or a computer (yuvoy-operator#171,
 * cases 3 to 5, and #388). The traveller app's "Claim in Yuvoy Host" opens
 * it, and the person reading it may have no account yet, so it is a door:
 * "Sign up or sign in to claim this listing", both carrying the link back,
 * and the stores under it. The claim itself, signed in, is
 * `claim-flow.spec.ts`.
 *
 * Runs in both projects, so case 3 (a phone) is the mobile one and case 4
 * (a computer) the desktop one.
 *
 * "Open in the app" depends on the phone (manager decision, 29 Oct 13:07):
 * the mobile project is an Android phone, so it gets an `intent://` link to
 * Yuvoy Host; an iPhone gets the Smart App Banner and no button; a computer
 * keeps the claim link.
 */

const HEADING = "Claim a listing";

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

/** The page with its stores; with a slug, the door that brings the person back to it. */
async function expectClaimPage(page: Page, slug: string | null = null) {
  await expect(
    page.getByRole("heading", { level: 1, name: HEADING }),
  ).toBeVisible();
  if (slug === null) {
    await expect(
      page.getByText("There is no listing to claim here."),
    ).toBeVisible();
  } else {
    const next = encodeURIComponent(`/claim/${slug}`);
    await expect(
      page.getByText("Sign up or sign in to claim this listing"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", `/signup?next=${next}`);
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/sign-in?next=${next}`,
    );
  }
  await expect(
    page.getByText("You can also claim in our app, Yuvoy Host."),
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

test("a listing's claim link: the door, both stores, and Open in the app on the same link", async ({
  page,
}) => {
  const response = await page.goto("/claim/example-reef-divers");
  expect(response?.status()).toBe(200);
  await expectClaimPage(page, "example-reef-divers");
  await expect(
    page.getByRole("link", { name: "Open in the app" }),
  ).toHaveAttribute("href", openHref("example-reef-divers"));
  // A signed-out door: no bounce to sign-in (`shell.spec.ts` pins no chrome).
  await expect(page).toHaveURL(/\/claim\/example-reef-divers$/);
  await expectAccessible(page, "the claim page");
});

test("an unknown slug is the same door signed out, never a 404", async ({
  page,
}) => {
  const response = await page.goto("/claim/no-such-business-here");
  expect(response?.status()).toBe(200);
  await expectClaimPage(page, "no-such-business-here");
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
    await expectClaimPage(page, "example-reef-divers");
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
    const headEnd = html.indexOf("</head>");
    expect(headEnd).toBeGreaterThan(0);
    const head = html.slice(0, headEnd);
    expect(head).toMatch(
      /<meta name="apple-itunes-app" content="app-id=6820854539, app-argument=https:\/\/operators\.yuvoy\.in\/claim\/example-reef-divers"\s*\/?>/,
    );
  });
});
