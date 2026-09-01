import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * What each role is offered, and what it is told it cannot do.
 *
 * Every branch in this file **had never been rendered** before it was written.
 * The mock knew one identity — an OWNER — so the `!canManage` half of four
 * screens was written straight from the contract and shipped unexercised.
 * `yuvoy-operator#14`.
 *
 * The rule they all follow is the one the capacity ceiling states: **the
 * refusal is knowable from what is already on screen, so it is said there** —
 * rather than fetched, or discovered after a tap, on one bar of signal, with a
 * clock running down on a traveller.
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";
const MANAGER = "+919000000102";
const STAFF = "+919000000103";

async function signIn(page: Page, phone: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("The code we sent").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("a staff phone is offered the day and nothing else", async ({ page }) => {
  await signIn(page, STAFF);

  /*
    "The crew phone goes out on the boat and gets left on a bench. It should be
    able to tick people off a manifest and nothing else." Three of these are
    OWNER-or-MANAGER on the server, so offering them would be offering a 403.
  */
  await expect(page.getByRole("link", { name: /Earnings/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Payout details/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: /Team access/ })).toHaveCount(0);

  // What they DO get: the day, and the seats they may look at but not change.
  await expect(
    page.getByRole("link", { name: /Seats and closed dates/ }),
  ).toBeVisible();
});

test("a manager is offered all three, because the server allows them", async ({
  page,
}) => {
  await signIn(page, MANAGER);

  // The positive control. A test that only ever asserts an absence passes just
  // as well when the links have been deleted for everybody.
  await expect(page.getByRole("link", { name: /Earnings/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Payout details/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Team access/ })).toBeVisible();
});

test("a staff login sees the queue and cannot answer it — including the buttons", async ({
  page,
}) => {
  await signIn(page, STAFF);
  await page.goto("/requests");

  /*
    The contract refuses the WRITE, not the read: `GET /requests` has no role
    gate, `POST /requests/{id}/accept` is 403 "STAFF cannot commit seats".
    So the queue is visible — a request nobody sees is a request that expires.
  */
  await expect(
    page.getByText("You can see these, but not answer them"),
  ).toBeVisible();
  await expect(
    page.getByText(/Pass it on rather than letting the clock run out/),
  ).toBeVisible();

  /*
    And the controls are disabled, not merely explained. A banner and a working
    button disagree, and the one that gets believed is the button.
  */
  const accept = page.getByRole("button", { name: "Accept" }).first();
  await expect(accept).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Decline" }).first(),
  ).toBeDisabled();
});

test("an owner can still answer the queue", async ({ page }) => {
  await signIn(page, OWNER);
  await page.goto("/requests");

  // The control for the test above: the buttons are disabled by ROLE, not by
  // something that had quietly disabled them for everybody.
  await expect(
    page.getByText("You can see these, but not answer them"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Accept" }).first(),
  ).toBeEnabled();
});

test("a staff login sees capacity and is told it cannot change it", async ({
  page,
}) => {
  await signIn(page, STAFF);
  await page.goto("/capacity");

  await expect(
    page.getByText("You can see these, but not change them"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Seats, closed dates and counter sales need an owner or a manager.",
    ),
  ).toBeVisible();
});

test("earnings refuses a staff login before the request, not after", async ({
  page,
}) => {
  await signIn(page, STAFF);
  await page.goto("/earnings");

  /*
    This page used to call `GET /earnings` anyway. The 403 threw, landed on the
    error boundary, and said "That did not load — try again": false, and
    unactionable, because nothing went wrong and retrying will never work.
  */
  await expect(
    page.getByText("Earnings are for an owner or a manager"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "That did not load" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);

  // And no figures leaked past the gate on the way to refusing.
  await expect(page.getByText("Gross")).toHaveCount(0);
});

test("the staff earnings refusal has no accessibility violations", async ({
  page,
}) => {
  await signIn(page, STAFF);
  await page.goto("/earnings");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
