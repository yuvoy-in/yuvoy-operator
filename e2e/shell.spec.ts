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

test("a tab root names exactly five destinations, and says where you are", async ({
  page,
}) => {
  /*
    FIVE since yuvoy-operator#96: Money became a stop of its own, because it
    was three taps away behind Business and it is the second reason an
    operator opens the portal. The owner can manage, so the owner sees it.

    The count and the order are asserted rather than left loose: a stop is a
    width decision on a 360px phone, and a stop that moves is a mis-tap.
  */
  await signIn(page);
  const nav = page.getByRole("navigation", { name: /Primary/i }).first();
  await expect(nav.getByRole("link")).toHaveCount(5);
  await expect(nav.getByRole("link")).toHaveText([
    /Today/,
    /Bookings/,
    /Calendar/,
    /Money/,
    /Business/,
  ]);
  await expect(nav.locator('a[aria-current="page"]')).toHaveText(/Today/i);
});

test("every stop on the bar carries its word, not only the current one", async ({
  page,
  isMobile,
}) => {
  /*
    yuvoy-operator#80 t6. The bar labelled only the stop you were on, so a
    ticket and a briefcase had to be guessed as Bookings and Business. Every
    label is visible text now, on the phone's bar as on the rail.
  */
  test.skip(
    !isMobile,
    "the floating bar is the phone's; the rail was always labelled",
  );
  await signIn(page);
  const nav = page.getByRole("navigation", { name: /Primary/i }).first();
  for (const word of ["Today", "Bookings", "Calendar", "Money", "Business"]) {
    await expect(nav.getByText(word, { exact: true })).toBeVisible();
  }
});

test("all five stops fit a 360px phone, with no sideways scroll", async ({
  page,
  isMobile,
}) => {
  /*
    The bar used to scroll sideways below about 330px of room. Five labelled
    stops share the width now, so on the narrowest common phone every stop is
    on screen at once and still a comfortable target.
  */
  test.skip(!isMobile, "the floating bar is the phone's");
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page);
  const nav = page.getByRole("navigation", { name: /Primary/i }).first();
  const links = nav.getByRole("link");
  await expect(links).toHaveCount(5);
  for (const link of await links.all()) {
    const box = await link.boundingBox();
    if (!box) throw new Error("a stop has no box");
    expect(box.x, "starts on screen").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "ends on screen").toBeLessThanOrEqual(360);
    expect(box.height, "a thumb-sized target").toBeGreaterThanOrEqual(44);
    expect(box.width, "a thumb-sized target").toBeGreaterThanOrEqual(44);
  }
  // Nothing on the page scrolls sideways either.
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("the stage names the business beside the mark, with no tagline", async ({
  page,
}) => {
  /*
    yuvoy-operator#80 t1: "Use the compact mark with no tagline, at half the
    height, and put the business name beside it." The name is the business's
    (`displayName`), never the signed-in person's.
  */
  await signIn(page);
  await expect(
    page.getByText("Reef Divers Havelock", { exact: true }).filter({
      visible: true,
    }),
  ).toBeVisible();
  const mark = page
    .getByRole("img", { name: "Yuvoy" })
    .filter({ visible: true })
    .first();
  await expect(mark).toHaveAttribute("src", /yuvoy-mark-compact/);
  // The marketing caption went with the marketing lockup. Visible only: the
  // sign-in door keeps its caption, and the router keeps the page it left in
  // the document, hidden.
  await expect(
    page.getByText("For operators").filter({ visible: true }),
  ).toHaveCount(0);
  // And the person holding the phone is not the business.
  await expect(
    page.getByText("Priya Raut", { exact: true }).filter({ visible: true }),
  ).toHaveCount(0);
});

test("every signed-in screen carries the inbox, and it opens the conversations", async ({
  page,
}) => {
  /*
    yuvoy-operator#96: a guest writes whatever screen the operator is on, so
    the way to the conversations is on every stage rather than behind a tab.
    Its count is conversations waiting on a reply, said in the link's name,
    and absent at zero. Asserted as a shape: `messages.spec.ts` reads the one
    unread conversation on the mobile project.
  */
  await signIn(page);
  const inbox = /^Messages(, \d+ unread conversations?)?$/;
  for (const path of ["/today", "/calendar", "/today/slot_dawn"]) {
    await page.goto(path);
    await expect(
      page.getByRole("link", { name: inbox }),
      `the inbox on ${path}`,
    ).toBeVisible();
  }
  await page.getByRole("link", { name: inbox }).click();
  await page.waitForURL("**/messages");
  // Not a link to the page already open.
  await expect(page.getByRole("link", { name: inbox })).toHaveCount(0);
});

test("a signed-out door carries no inbox", async ({ page }) => {
  /*
    Every door, not only sign-in: /signup drew the signed-in chrome by default
    and so offered "Messages" to somebody with no account, which bounced them
    to sign-in (the audit before the #96 release).
  */
  for (const path of [
    "/sign-in",
    "/signup",
    "/join",
    "/join/jn_reefdivers",
    "/no-such-page",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 1 }),
      `the heading on ${path}`,
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^Messages/ }),
      `no inbox on ${path}`,
    ).toHaveCount(0);
  }
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

  /*
    Money, the stop yuvoy-operator#96 added. Asserted by where it lands and by
    the stop it lights rather than by the screen's heading, which the Money
    screen's own rework owns.
  */
  await page
    .getByRole("navigation", { name: /Primary/i })
    .first()
    .getByRole("link", { name: "Money" })
    .click();
  await page.waitForURL("**/earnings");
  await expect(
    page
      .getByRole("navigation", { name: /Primary/i })
      .first()
      .getByRole("link", { name: "Money" }),
  ).toHaveAttribute("aria-current", "page");
});

test("a focused screen hides the bar and offers a way back", async ({
  page,
  isMobile,
}) => {
  await signIn(page);
  /*
    A departure on the day's sheet, found by its region rather than by its
    words: every row on it opens that departure's manifest, and the titles are
    a fixture other suites edit. The listings left Home for Business in
    yuvoy-operator#96, so nothing else here shares a row's name.
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
    await expect(primary.getByRole("link")).toHaveCount(5);
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
  ).toHaveCount(5);
});

/*
  The two counts on the bar — yuvoy-operator#42.

  "These badges turn unfinished obligations into visible work queues." Bookings
  counts the requests its queue shows; Business counts what stops the business
  selling (#96 item 6). Each is SAID, not just drawn: the bubble is decorative
  and the link carries the number in words, so a screen reader hears what it
  counts.

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

test("Business counts what stops the business selling", async ({ page }) => {
  // A new account that cannot sell until it sends two documents.
  await signIn(page, "+919000000105");
  const business = page
    .getByRole("navigation", { name: /Primary/i })
    .first()
    .getByRole("link", { name: /^Business/ });
  await expect(business).toHaveAccessibleName("Business, 2 stopping sales");

  await business.click();
  await page.waitForURL("**/account");

  /*
    The profile carries the COUNT and the list lives one tap further in, on
    Verification (#58 items 2 and 10). Both documents stop sales, so here the
    badge and the list are the same two things.
  */
  const strip = page.getByRole("link", { name: /things? waiting on you/ });
  await expect(strip).toContainText("2 things waiting on you");

  await strip.click();
  await page.waitForURL("**/account/verification");
  await expect(
    page.getByRole("region", { name: "Waiting on you" }).getByRole("listitem"),
  ).toHaveCount(2);
});

test("Business carries no count for items that stop nothing", async ({
  page,
}) => {
  /*
    yuvoy-operator#96 item 6: "The Business badge reads '2' (two non-blocking
    verification items)", a label that does not scan. This business is
    selling with three things outstanding: they are named on Business, and
    the bar carries no number for them.
  */
  await signIn(page, "+919000000115");
  const business = page
    .getByRole("navigation", { name: /Primary/i })
    .first()
    .getByRole("link", { name: /^Business/ });
  await expect(business).toHaveAccessibleName("Business");

  await business.click();
  await page.waitForURL("**/account");
  await expect(
    page.getByRole("link", { name: /things? waiting on you/ }),
  ).toBeVisible();
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
