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
    ["Bookings", "/bookings", "Bookings"],
    ["Calendar", "/calendar", "Calendar"],
    ["Services", "/services/activities", "Listings"],
    ["Business", "/account", "Nemo Reef Watersports"],
  ] as const) {
    await page
      .getByRole("navigation", { name: /Primary/i })
      .first()
      .getByRole("link", { name })
      .click();
    await page.waitForURL(`**${path}`);
    /*
      `exact`, because Listings carries a section heading counting them and a
      substring match resolves to both. The page's own h1 is what says you
      arrived.
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
  "/bookings",
  "/calendar",
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

/*
  The two renamed URLs still answer — yuvoy-operator#32.

  `/requests` and `/capacity` are 308s to `/bookings` and `/calendar` rather
  than deletions, because both are in operators' browser history and both have
  been sent in messages from us. A 404 on a screen somebody used yesterday
  reads as the portal being broken, and the operators most likely to hold an
  old link are the ones we onboarded by hand.
*/
for (const [old, moved, heading] of [
  ["/requests", "/bookings", "Bookings"],
  ["/capacity", "/calendar", "Calendar"],
] as const) {
  test(`${old} still lands on ${moved}`, async ({ page }) => {
    await signIn(page);
    await page.goto(old);
    await page.waitForURL(`**${moved}`);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  });
}

/*
  Security headers, asserted against the running portal — yuvoy-operator#37.

  `next.config.ts` builds the policy from environment, so the only place the
  real one exists is a deployed response. A green unit test on the builder says
  the string is right; only this says the string arrived.
*/
test.describe("security headers", () => {
  test("every response carries the enforced policy", async ({ request }) => {
    const headers = (await request.get("/sign-in")).headers();

    /*
      The WHOLE policy is enforced as of 9 Sep 2026 — yuvoy-operator#37. It
      shipped report-only in the morning and was enforced the same day against
      this suite rather than a waiting period: 342 tests drive the real
      production build in a real browser, across every screen including both
      media uploaders and every role gate.
    */
    const enforced = headers["content-security-policy"] ?? "";
    expect(enforced).toContain("default-src 'none'");
    expect(enforced).toContain("connect-src");
    expect(enforced).toContain("form-action 'self'");
    expect(enforced).not.toContain("'unsafe-eval'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["strict-transport-security"]).toContain("preload");
    expect(headers["cache-control"]).toContain("no-store");
  });

  test("the reported policy never names the API origin", async ({
    request,
  }) => {
    /*
      Nothing here talks to the API from a browser — `/operator/v1` refuses
      CORS, the client is `server-only`, and `OPERATOR_API_URL` is deliberately
      not `NEXT_PUBLIC_`. Putting it in a header would publish on every
      response the origin that variable is kept server-side to hide.
    */
    const policy =
      (await request.get("/sign-in")).headers()[
        "content-security-policy-report-only"
      ] ?? "";

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).not.toContain("/operator/v1");
    expect(policy).not.toContain("api.yuvoy.in");
  });

  test("the enforced and reported policies are the same", async ({
    request,
  }) => {
    /*
      Both headers carry one directive list. Report-only is kept alongside the
      enforced copy because an enforced-only header blocks SILENTLY, and the
      first upload after this deploys is the thing to watch — a console line
      naming the directive is what makes that watchable.
    */
    const headers = (await request.get("/sign-in")).headers();
    expect(headers["content-security-policy-report-only"]).toBe(
      headers["content-security-policy"],
    );
  });
});
