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

/** Signs in without asserting where it lands — that is the thing under test. */
async function signIn(page: Page, phone: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("The code we sent").fill(DEV_CODE);
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
    The gap is stated rather than left as a silence. O3 asks for exactly what
    is outstanding — a missing credential, an unverified document — and the
    pinned contract publishes none of it: `GET /me` returns id, name, roles,
    operatorId and canManage, full stop. An operator who came looking for a
    review checklist must not read a blank page as "everything is approved".
  */
  await expect(
    page.getByText(
      /licences, documents and their expiry dates are not on this screen/,
    ),
  ).toBeVisible();
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
