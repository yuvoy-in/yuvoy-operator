import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * O3 — whether an operator can trade, and the screens that say so when
 * something has gone wrong.
 *
 * Three of these tests cover states that had **never once been rendered**
 * before this change: `requireOperator()` described itself as throwing "to the
 * error boundary, which says what is actually true", and there was no error
 * boundary in the repository at all. The two extra mock identities exist for
 * exactly this reason — an unreachable screen is an untested screen.
 *
 * The claim they are really defending is the last one: **a server having a bad
 * minute must never render as "your business account has been suspended".**
 */

/*
  Headings are asserted by role, not by text. Next mirrors the page's heading
  into its own `role="alert"` route announcer, so `getByText` on an h1 resolves
  to two elements on every navigation.
*/
const DEV_CODE = "424242";
const OWNER = "+919000000101";
/** Signs in fine; the business account is on hold. */
const SUSPENDED = "+919000000109";
/** `GET /me` answers 500. Not an account state. */
const FAILING = "+919000000108";
/** Signed up, verified nothing. `bookable: false`, both blockers theirs. */
const PROSPECT = "+919000000105";
/** Everything sent; it is in Yuvoy's queue. `waitingOn: yuvoy`. */
const AWAITING = "+919000000106";
/**
 * `GET /me` answers 200 with no `account` block at all.
 *
 * The same identity `reels.spec.ts` uses for a dropped upload — deliberately.
 * Every mock identity that exists for another purpose gets no account block,
 * so "absent" is a shape the suite meets by accident as well as on purpose.
 * Read-only here, so it cannot race that spec's uploads.
 */
const NO_STANDING = "+919000000107";

/** Signs in without asserting where it lands — that is the thing under test. */
async function signIn(page: Page, phone: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an active account says so, and gets out of the way", async ({ page }) => {
  await signIn(page, OWNER);
  await page.waitForURL("**/today");
  await page.goto("/account");

  await expect(
    page.getByRole("heading", { name: "Your account is live" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to today" })).toBeVisible();

  /*
    The documents are on the screen now — `AccountStanding.credentials`
    (yuvoy-api#63, PR #83). A LIVE account still gets this section, because it
    is where the expiry lives and a lapse mid-season takes the listing down.
  */
  await expect(
    page.getByRole("heading", { name: "Your documents" }),
  ).toBeVisible();
  await expect(page.getByText("Directorate registration")).toBeVisible();

  /*
    The one warning this portal raises on its own, and it is arithmetic on a
    published date rather than a guess: a VERIFIED insurance certificate
    twenty-one days from expiry is not a green tick.
  */
  await expect(page.getByText("Expires in 21 days")).toBeVisible();

  // Editing is still not here — O6, and the contract has no write path. Said
  // out loud so somebody holding a renewed certificate knows where to send it.
  await expect(
    page.getByText(/You cannot send or replace a document here yet/),
  ).toBeVisible();
});

test("a signed-up account that cannot sell is never told it is live", async ({
  page,
}) => {
  /*
    The defect this change fixes, as a test.

    /account said "your account is live" to anybody whose `GET /me` returned
    200. After self-signup (D-029) a PROSPECT is the most common operator
    there is — real account, real session, cannot sell a thing — and that
    sentence was a lie to every one of them.
  */
  /*
    Wait for the sign-in redirect to land before navigating. `signIn` does not
    wait — where it lands is the thing under test elsewhere in this file — so a
    `goto` fired immediately is overtaken by the redirect and asserts against
    /today. Cost six failures to find.
  */
  await signIn(page, PROSPECT);
  await page.waitForURL("**/today");
  await page.goto("/account");

  await expect(
    page.getByRole("heading", { name: "You cannot be booked yet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your account is live" }),
  ).toHaveCount(0);

  // `state` is displayed, never branched on: it is a bare string in the
  // contract and PROSPECT is not even among the schema's own examples.
  await expect(page.getByText("Prospect")).toBeVisible();

  /*
    `waitingOn` gets its own heading. "'Pending' because we are slow and
    'pending' because they have sent nothing read identically, and an operator
    who cannot tell which has no choice but to ring somebody."
  */
  await expect(
    page.getByRole("heading", { name: "Waiting on you" }),
  ).toBeVisible();
  await expect(
    page.getByText("We still need your tourism department registration"),
  ).toBeVisible();
  await expect(
    page.getByText("We still need your insurance certificate"),
  ).toBeVisible();
  await expect(page.getByText("2 things are waiting on you")).toBeVisible();

  // No upload exists yet (O6), so the channel that does is named instead of
  // offering a control that would not work.
  await expect(
    page.getByText(/There is no upload on this screen yet/),
  ).toBeVisible();
});

test("an account waiting on Yuvoy is told not to chase it", async ({
  page,
}) => {
  /*
    Wait for the sign-in redirect to land before navigating. `signIn` does not
    wait — where it lands is the thing under test elsewhere in this file — so a
    `goto` fired immediately is overtaken by the redirect and asserts against
    /today. Cost six failures to find.
  */
  await signIn(page, AWAITING);
  await page.waitForURL("**/today");
  await page.goto("/account");

  await expect(
    page.getByRole("heading", { name: "You cannot be booked yet" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "With Yuvoy" })).toBeVisible();
  await expect(
    page.getByText("Everything is in. A person at Yuvoy is checking it."),
  ).toBeVisible();
  await expect(page.getByText(/Nothing for you to do/)).toBeVisible();

  /*
    And it must NOT tell somebody who cannot sell that nothing is outstanding
    — that reads as a fault in us and produces the phone call O3 exists to
    prevent.
  */
  await expect(page.getByText(/nothing is outstanding/i)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Waiting on you" }),
  ).toHaveCount(0);
});

test("an account block the API did not send is unknown, not approval", async ({
  page,
}) => {
  /*
    The contract's own instruction, as a test: "Absent means unknown — never
    'everything is fine'." An older deployment, a rollback or a partial
    response must not render as approval.
  */
  /*
    Wait for the sign-in redirect to land before navigating. `signIn` does not
    wait — where it lands is the thing under test elsewhere in this file — so a
    `goto` fired immediately is overtaken by the redirect and asserts against
    /today. Cost six failures to find.
  */
  await signIn(page, NO_STANDING);
  await page.waitForURL("**/today");
  await page.goto("/account");

  await expect(
    page.getByRole("heading", { name: "We cannot tell you where you stand" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your account is live" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/we should not tell you that nothing is/),
  ).toBeVisible();
});

test("the day screen explains an empty day the account is the reason for", async ({
  page,
}) => {
  /*
    Where the question is actually asked. A new operator signs in and lands
    here — `/` redirects to `/today` — and "Nothing scheduled" reads as "you
    have not added anything" rather than "you cannot sell yet".
  */
  await signIn(page, PROSPECT);
  await page.waitForURL("**/today");

  const banner = page.getByRole("link", { name: /You cannot be booked yet/ });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("See what is outstanding");

  await banner.click();
  await page.waitForURL("**/account");
  await expect(
    page.getByRole("heading", { name: "Waiting on you" }),
  ).toBeVisible();
});

test("a live account gets no banner on the day screen", async ({ page }) => {
  // The banner is an exception, not decoration. An operator who can sell must
  // never see a warning about selling.
  await signIn(page, OWNER);
  await page.waitForURL("**/today");
  await expect(
    page.getByRole("link", { name: /You cannot be booked yet/ }),
  ).toHaveCount(0);
});

test("an account on hold is told what it is, and is not signed out", async ({
  page,
}) => {
  await signIn(page, SUSPENDED);

  // Every authenticated page sends them here, so sign-in lands here too.
  await page.waitForURL("**/account");
  await expect(
    page.getByRole("heading", { name: "Your account cannot take bookings" }),
  ).toBeVisible();

  /*
    "The person is fine, the business relationship is not." Signing them out
    would say the opposite, so the session survives and the screen talks about
    the account rather than about them.
  */
  await expect(
    page.getByText("Your sign-in works.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  // A person, not a form. This screen does not know why, and says so.
  await expect(page.getByText("+91 81216 57657")).toBeVisible();
  await expect(
    page.getByText(/If you have travellers booked on departures today/),
  ).toBeVisible();
});

test("every screen sends an account on hold to the same place", async ({
  page,
}) => {
  await signIn(page, SUSPENDED);
  await page.waitForURL("**/account");

  // Not a special case on one route: `requireOperator()` is where it is known.
  for (const path of ["/today", "/team", "/earnings", "/capacity"]) {
    await page.goto(path);
    await page.waitForURL("**/account");
    await expect(
      page.getByRole("heading", { name: "Your account cannot take bookings" }),
    ).toBeVisible();
  }
});

test("a server having a bad minute is not an account state", async ({
  page,
}) => {
  await signIn(page, FAILING);

  /*
    The single most important line in this file. A 500 and a dropped
    connection are the common path on a jetty at 0.5 Mbps, and rendering
    either as "your business account has been suspended" would send an
    operator to cancel a season over a timeout.
  */
  await expect(
    page.getByRole("heading", { name: "That did not load" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your account cannot take bookings" }),
  ).toHaveCount(0);

  // What a retry screen owes somebody who was mid-action.
  await expect(
    page.getByText(/check whether it took effect before doing it again/),
  ).toBeVisible();
});

test("a URL this portal does not have says so, and offers the way back", async ({
  page,
}) => {
  await signIn(page, OWNER);
  await page.waitForURL("**/today");

  await page.goto("/no-such-screen");
  await expect(
    page.getByRole("heading", { name: "There is nothing at that address" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to today" })).toBeVisible();
});

test("/account has no accessibility violations, on hold or not", async ({
  page,
}) => {
  await signIn(page, OWNER);
  await page.waitForURL("**/today");
  await page.goto("/account");
  await page.waitForLoadState("networkidle");

  const active = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(active.violations).toEqual([]);

  await page.context().clearCookies();
  await signIn(page, SUSPENDED);
  await page.waitForURL("**/account");
  await page.waitForLoadState("networkidle");

  const held = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(held.violations).toEqual([]);
});
