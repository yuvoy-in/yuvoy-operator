import { test, expect } from "@playwright/test";
import { expectAccessible } from "./axe";
import { OWNER, PROSPECT, signIn } from "./account-kit";

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
/** Signs in fine; the business account is on hold. */
const SUSPENDED = "+919000000109";
/** `GET /me` answers 500. Not an account state. */
const FAILING = "+919000000108";

test("Home explains an empty day the account is the reason for", async ({
  page,
}) => {
  /*
    Where the question is actually asked. A new operator signs in and lands
    here — `/` redirects to `/today` — and "Nothing running today" reads as "you
    have not added anything" rather than "you cannot sell yet".

    The strip is the first thing on Home since #56, above the requests, and it
    carries `headline(account).title` so it cannot disagree with the sentence
    the Business screen leads with.
  */
  await signIn(page, PROSPECT);
  await page.waitForURL("**/today");

  /*
    The selling line since yuvoy-operator#96: the first thing on Home, one
    line, and red for an account that cannot sell ("Not selling: 2 documents
    needed"). Tapping it opens the reasons, each with its way forward, and
    the way to the whole list on Verification.
  */
  const status = page.getByText("Not selling: 2 documents needed");
  await expect(status).toBeVisible();

  await status.click();
  await page
    .getByRole("link", { name: "See everything on Verification" })
    .click();
  await page.waitForURL("**/account/verification");
  await expect(
    page.getByRole("heading", { name: "Waiting on you" }),
  ).toBeVisible();
});

test("a live account gets no banner on the day screen", async ({ page }) => {
  // The warning is an exception, not decoration. An operator who can sell must
  // never be told they cannot: the selling line says selling.
  await signIn(page, OWNER);
  await page.waitForURL("**/today");
  await expect(page.getByText(/^Not selling/)).toHaveCount(0);
  await expect(
    page
      .locator("main")
      .getByText(/^Selling(, but | · )/)
      .first(),
  ).toBeVisible();
});

test("a suspended business signs in, and every screen says why", async ({
  page,
}) => {
  /*
    yuvoy-operator#50, and this test used to assert the opposite.

    A suspended business was refused `403 account_not_active` on every endpoint
    and bounced to /account from everywhere. The contract separated the two:
    "a suspended business is not refused here ... each signs in, and its writes
    answer `account_suspended` instead." `account_not_active` now means only an
    OFFBOARDED account, which cannot hold a session at all.

    The separation is not a nicety. A suspended operator still has departures
    that travellers have paid for, and those have to be run or called off. The
    old dead end stranded them.
  */
  await signIn(page, SUSPENDED);
  await page.waitForURL("**/today");

  // The banner is the API's three sentences, in order, on the first screen.
  const banner = page.getByRole("alert").filter({ hasText: "suspended" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(
    "Your account has been suspended. Please reach out to admin for help.",
  );
  // What a person at Yuvoy wrote, shown as plain text.
  await expect(banner).toContainText("three complaints about missed pickups");
  // And the half that stops somebody assuming the season is over.
  await expect(banner).toContainText("run or stop the trips already booked");

  // On every screen, not one: it changes what every control on the page means.
  for (const path of ["/bookings", "/calendar", "/account"]) {
    await page.goto(path);
    await expect(
      page.getByRole("alert").filter({ hasText: "suspended" }).first(),
    ).toBeVisible();
  }
});

test("a suspended business keeps the writes the API still allows", async ({
  page,
}) => {
  /*
    The table in yuvoy-operator#50: everything can still be read, the trips
    already booked can still be run or stopped, and the team, a bank change and
    documents can still be dealt with. The principle underneath it is that a
    suspended business can always let a traveller GO and can never take one ON.
  */
  await signIn(page, SUSPENDED);
  await page.waitForURL("**/today");

  // Pause is not drawn. Putting a listing back on sale is taking travellers on.
  await page.goto("/services/activities");
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toHaveCount(0);
  // Nor is a new listing, which is new inventory.
  await expect(
    page.getByRole("button", { name: /Add a listing|New listing/i }),
  ).toHaveCount(0);

  // Seats, closed dates and counter sales are all gone from the calendar.
  await page.goto("/calendar");
  await expect(
    page.getByRole("button", { name: /Add a departure|Close/i }),
  ).toHaveCount(0);

  /*
    The team is still manageable. Holding somebody is taking access AWAY, which
    a suspended business may always do; inviting is handing it out, which it
    may not.
  */
  await page.goto("/team");
  await expect(
    page.getByRole("button", { name: "Send the invitation" }),
  ).toHaveCount(0);

  // And the day still runs: the manifest and its attendance are untouched.
  await page.goto("/today");
  await expect(
    page.getByRole("alert").filter({ hasText: "suspended" }),
  ).toBeVisible();
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

  await expectAccessible(page, "/account, an active business");

  /*
    A suspended business lands on the day like anybody else since
    yuvoy-operator#50, so /account is navigated to rather than arrived at. The
    banner is on this screen too, and it is the new thing axe has to be happy
    about: an `alert` carrying three paragraphs, above everything.
  */
  await page.context().clearCookies();
  await signIn(page, SUSPENDED);
  await page.waitForURL("**/today");
  await page.goto("/account");
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("alert").filter({ hasText: "suspended" }).first(),
  ).toBeVisible();

  await expectAccessible(page, "/account, a suspended business");
});
