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
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("a staff phone is offered the day and nothing else", async ({ page }) => {
  await signIn(page, STAFF);

  /*
    "The crew phone goes out on the boat and gets left on a bench. It should be
    able to tick people off a manifest and nothing else." Three of these are
    OWNER-or-MANAGER on the server, so offering them would be offering a 403.
    The doors live behind the Business tab, so that is where the absence is
    asserted.
  */
  await page.goto("/account");
  await expect(page.getByRole("link", { name: /Earnings/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Payout details/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: /Team access/ })).toHaveCount(0);

  /*
    What they DO get: the day, the seats they may look at but not change, and
    the media upload the contract puts no role on.

    The "Add a reel" door came off this screen with yuvoy-operator#33 §4 — it
    opened what is now Listings, which is its own tab, and one screen should
    not live in two places. The Listings stop in the bar is the way there, and
    it is not role-gated. What replaced it here is the LOGO, which is mandatory before an
    operator can be booked and is also ungated: `PUT /logo` declares a generic
    Forbidden and names no role.
  */
  await expect(page.getByRole("link", { name: /Add a reel/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Your logo/ })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: /Primary/i })
      .first()
      .getByRole("link", { name: "Listings" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: /Primary/i })
      .first()
      .getByRole("link", { name: "Calendar" }),
  ).toBeVisible();
});

test("a manager is offered all three, because the server allows them", async ({
  page,
}) => {
  await signIn(page, MANAGER);
  await page.goto("/account");

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
  await page.goto("/bookings");

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

test("a staff phone that forces the button through is refused by the action itself", async ({
  page,
}) => {
  await signIn(page, STAFF);
  await page.goto("/bookings");

  /*
    `disabled` is a courtesy. A Server Action is a public POST endpoint, and
    for a month the only thing between a STAFF phone and a granted request
    was the attribute this test removes — the mock refused nothing by role,
    so the 403 branch in the action had never once run. The action now
    re-reads the role at the moment of the tap, and the mock refuses like
    the contract does; either alone would render this line.
  */
  const accept = page.getByRole("button", { name: "Accept" }).first();
  await accept.evaluate((button) => button.removeAttribute("disabled"));
  await accept.click();

  await expect(
    page.getByRole("alert").filter({ hasText: "Your role cannot answer" }),
  ).toHaveText(
    "Your role cannot answer requests. An owner, admin or manager has to.",
  );

  // And nothing was granted: the request is still in the queue.
  await expect(
    page.getByRole("button", { name: "Accept" }).first(),
  ).toBeVisible();
});

test("an owner can still answer the queue", async ({ page }) => {
  await signIn(page, OWNER);
  await page.goto("/bookings");

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
  await page.goto("/calendar");

  await expect(
    page.getByText("You can see these, but not change them"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Seats, closed dates and counter sales need an owner, an admin or a manager.",
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
    page.getByText("Earnings are for an owner, an admin or a manager"),
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

/* ------------------------------------------------ the other sign-in door -- */

test("somebody who already holds a code never asks for one to be sent", async ({
  page,
}) => {
  /*
    yuvoy-api#59, ruled **keep** on 2 September: Yuvoy staff can issue a
    sign-in code out of band, as the hedge for an operator whose phone is gone.

    That operator must not be made to press "Send me a code". It messages a
    phone they do not have — which is the whole reason they are on this path —
    and if issuing a code supersedes an outstanding one, it destroys the code
    they are holding at the moment they are using it.
  */
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(OWNER);
  await page.getByRole("button", { name: "I already have a code" }).click();

  // Straight to the code field, and the screen does not claim it sent anything.
  await expect(page.getByLabel("Your code")).toBeVisible();
  await expect(page.getByText("We have not messaged you.")).toBeVisible();

  // And the code still works, because skipping the send skips nothing that
  // authorises anybody — `POST /auth/session` is the only gate.
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
});

test("that door still needs a whole number, and still says nothing about channels", async ({
  page,
}) => {
  /*
    This used to assert a "country code" refusal after pressing. Since
    yuvoy-operator#19 the field cannot produce a number without one — `+91` is
    fixed furniture and it takes ten digits — so the refusal is unreachable
    rather than merely handled, and the button waits instead of failing.

    The stronger property is asserted in its place: an incomplete number never
    reaches the code step by EITHER door, and neither door names a channel.
  */
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill("98765");

  await expect(
    page.getByRole("button", { name: "I already have a code" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Send me a code" }),
  ).toBeDisabled();
  await expect(page.getByText("5 more digits.")).toBeVisible();
  await expect(page.getByLabel("Your code")).toHaveCount(0);

  // Nothing anywhere on the screen claims a code was sent by anything.
  await expect(page.getByText(/we (sent|have sent|messaged)/i)).toHaveCount(0);
  await expect(page.getByText(/WhatsApp|SMS/i)).toHaveCount(0);
});
