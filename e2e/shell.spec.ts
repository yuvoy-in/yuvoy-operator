import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The chassis (v2.7): the floating bar on a tab root, the back control on a
 * focused screen, no chrome at all on a signed-out door — and accessibility
 * on the screens that carry the new chrome.
 */

const DEV_CODE = "424242";

async function signIn(page: Page, phone = "+919000000101") {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
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
  /*
    FOUR since D-036 (yuvoy-operator#56). Listings had two pages under it and
    the tab pointed at the first, so the footage was a stop nobody found. Every
    listing is on Home now, where an operator already looks, and creating or
    editing one moved to the Business profile.

    The count is asserted rather than left loose: a fifth stop is a width
    decision, not a routing one, and the bar was already about 330px at its
    longest with five.
  */
  await signIn(page);
  const nav = page.getByRole("navigation", { name: /Primary/i }).first();
  await expect(nav.getByRole("link")).toHaveCount(4);
  await expect(nav.locator('a[aria-current="page"]')).toHaveText(/Home/i);
});

test("the bar reaches every destination", async ({ page }) => {
  await signIn(page);
  for (const [name, path, heading] of [
    ["Bookings", "/bookings", "Bookings"],
    ["Calendar", "/calendar", "Calendar"],
    // The profile is headed by `displayName` since #58, not the legal name.
    ["Business", "/account", "Reef Divers Havelock"],
  ] as const) {
    await page
      .getByRole("navigation", { name: /Primary/i })
      .first()
      .getByRole("link", { name })
      .click();
    await page.waitForURL(`**${path}`);
    // `exact`: a page may carry a section heading whose words overlap its own,
    // and the `h1` is what says you arrived.
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
  /*
    The DEPARTURE row, not the listing tile. Home carries both since #56, and
    they share a title: the row goes to that day's manifest and the tile goes to
    the listing hub. Scoped by the region rather than by the words.
  */
  await page
    .getByRole("region", { name: /departures?/ })
    .getByRole("link")
    .first()
    .click();
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

for (const route of [
  "/today",
  "/bookings",
  "/calendar",
  /*
    `/services/*` are redirects since #58: the listings are on Home and the
    library is a tab of the profile, so the two tabs of `/account` are what
    replaced them and are audited in their place.
  */
  "/account",
  "/account?tab=reels",
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
  ).toHaveCount(4);
});

/*
  The two counts on the bar — yuvoy-operator#42.

  "These badges turn unfinished obligations into visible work queues." Each is
  the number of rows under "Waiting on you" on the screen its stop opens, and
  each is SAID, not just drawn: the bubble is decorative and the link carries
  the number in words, so a screen reader hears what it counts.

  Asserted as a shape rather than a figure on Bookings: other specs answer
  requests against the same server while this runs.
*/
test("Bookings carries the number of requests waiting on an answer", async ({
  page,
}) => {
  await signIn(page);
  const bookings = page
    .getByRole("navigation", { name: /Primary/i })
    .first()
    .getByRole("link", { name: /^Bookings/ });
  await expect(bookings).toHaveAccessibleName(
    /^Bookings, \d+ waiting on your answer$/,
  );
});

test("Business carries no count when nothing is waiting on the operator", async ({
  page,
}) => {
  // The fixture owner owes us nothing: no badge, and no zero either.
  await signIn(page);
  const business = page
    .getByRole("navigation", { name: /Primary/i })
    .first()
    .getByRole("link", { name: /^Business/ });
  await expect(business).toHaveAccessibleName("Business");
});

test("Business counts exactly the list it opens", async ({ page }) => {
  // A new account with two documents to send.
  await signIn(page, "+919000000105");
  const business = page
    .getByRole("navigation", { name: /Primary/i })
    .first()
    .getByRole("link", { name: /^Business/ });
  await expect(business).toHaveAccessibleName("Business, 2 waiting on you");

  await business.click();
  await page.waitForURL("**/account");

  /*
    The profile carries the COUNT and the list lives one tap further in, on
    Verification (#58 items 2 and 10). The badge and the strip agree because
    both count `splitByWaitingOn(blocking).operator`; the list is what the strip
    opens, and it is the list the badge is a count of.
  */
  const strip = page.getByRole("link", { name: /things? waiting on you/ });
  await expect(strip).toContainText("2 things waiting on you");

  await strip.click();
  await page.waitForURL("**/account/verification");
  await expect(
    page.getByRole("region", { name: "Waiting on you" }).getByRole("listitem"),
  ).toHaveCount(2);
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
