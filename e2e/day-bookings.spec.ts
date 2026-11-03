import { test, expect } from "@playwright/test";
import { signIn, NEVER_ANSWERED } from "./day-kit";

/**
 * O10 end to end, through the real architecture.
 *
 * Everything here goes sign-in → cookie → server render → Server Action. There
 * is no API call from the browser anywhere in this file because there is no
 * way to make one: `/operator/v1` refuses CORS and this repo ships no proxy
 * route. If that ever changes, these tests keep passing and the security
 * posture quietly leaves — which is why `pnpm qa` guards the route handlers
 * separately.
 */

/*
  The bookings half of the tab — yuvoy-operator#34.

  An operator could not see who had booked them. There was a Requests tab
  holding only request-mode bookings awaiting an answer, a manifest per
  departure reached by opening a day, and money lines inside Earnings.
  `GET /bookings` and `GET /bookings/{id}` both existed and were called by
  nothing — and migration 0054 made `allotment` the default, so an operator on
  it has an empty queue and, before this, no bookings screen at all.
*/
test("bookings lists who is coming, in the operator's words", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/bookings");

  /*
    The Upcoming pill, which is where the rows are since yuvoy-operator#57
    replaced the three anchored sections with four pills.
  */
  await page.goto("/bookings?view=upcoming");

  /*
    Not a single raw state anywhere on the screen. These are
    `fulfilment_state` column values served verbatim by the endpoint, so an
    unmapped one is not hypothetical — `paid_pending_ops` is what a traveller
    who has just paid looks like.
  */
  const body = (await page.locator("body").innerText()).toLowerCase();
  for (const token of [
    "paid_pending_ops",
    "pending_request",
    "no_show",
    "fulfilment",
  ]) {
    expect(body, `"${token}" is a column value, not a word`).not.toContain(
      token,
    );
  }
});

test("a booking is never listed twice on one screen", async ({ page }) => {
  await signIn(page);
  await page.goto("/bookings");

  /*
    An open request is on the Requests pill and on NO other, which is now the
    API's own rule rather than this screen's: "open requests are not bookings
    and are in no view." It used to be a portal-side filter over two overlapping
    reads that both carried the row.
  */
  await page.goto("/bookings?view=requests");
  await expect(page.locator("main")).toContainText(NEVER_ANSWERED.urgent);

  await page.goto("/bookings?view=upcoming");
  await expect(page.locator("main")).not.toContainText(NEVER_ANSWERED.urgent);
});

test("a booking opens, and shows no phone number", async ({ page }) => {
  await signIn(page);
  await page.goto("/bookings");

  await page.goto("/bookings?view=upcoming");
  await page
    .locator("main")
    .getByRole("link", { name: /\d\d:\d\d/ })
    .first()
    .click();
  await page.waitForURL(/\/bookings\/.+/);

  // A focused screen: the bar goes, a way back arrives.
  await expect(
    page.getByRole("link", { name: /Back to bookings/i }),
  ).toBeVisible();

  /*
    `contact` carries the name and only the name — `whatsapp` was removed in
    M13 per D-018. "A traveller gives us a number so we can tell them about
    their booking, not so it can be added to an operator's contacts." No
    contact column is added here because the endpoint returns something that
    looks like one.
  */
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/\+91[\s\d]{8,}/);
  /*
    Why there is none is one tap away in help rather than a paragraph at the
    foot of every booking (yuvoy-operator#80 t4).
  */
  await expect(
    page.getByRole("link", { name: "Why there is no phone number" }),
  ).toHaveAttribute(
    "href",
    /^\/account\/help\?from=%2Fbookings%2F[\w-]+#traveller-phone-numbers$/,
  );
});

test("a booking that is not yours is a 404, never a 403", async ({ page }) => {
  await signIn(page);
  // "A 403 confirms the booking exists, which is exactly what somebody probing
  // ids wants to learn." One answer for both, and the client must not branch.
  const res = await page.goto("/bookings/bk_not_yours");
  expect(res?.status()).toBe(404);
});

/*
  The three anchored sections are GONE — yuvoy-operator#57.

  Requests, Confirmed and Past were three places on one screen with a link to
  each, over two overlapping reads of a fixed window. They are four pills now,
  each a URL of its own, each counted by the server. The test that asserted the
  anchor nav went with them; `e2e/bookings.spec.ts` covers what replaced it.
*/

test("bookings are grouped by the day they run, with that day's totals", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/bookings?view=upcoming");

  // "Grouped by date, summarised as total bookings and guests."
  await expect(
    page.getByRole("heading", { level: 2, name: /^Tomorrow · / }),
  ).toBeVisible();
  await expect(
    page.getByText(/· \d+ bookings? · \d+ guests?$/).first(),
  ).toBeVisible();
});

test("a request says when the trip is, and how long ago they asked", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/bookings");

  const row = page.getByRole("listitem", {
    name: `Seat request from ${NEVER_ANSWERED.urgent}`,
  });
  await expect(row).toContainText(
    /(Today|Tomorrow|[A-Z][a-z]+day,? \d+ [A-Z][a-z]+) at \d\d:\d\d/,
  );
  // How long they have waited, beside when the answer is due.
  await expect(row).toContainText(
    /Asked (just now|\d+ (min|h|d) ago) · Answer by \d\d:\d\d/,
  );
});
