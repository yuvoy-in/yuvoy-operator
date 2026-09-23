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
    able to tick people off a manifest and nothing else." Money is a tab of its
    own now (yuvoy-operator#96) and not in Settings for anybody, and Team access
    is offered to an owner, an admin or a manager only.
  */
  await page.goto("/account/settings");
  await expect(page.getByRole("link", { name: /Earnings/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Payout details/ })).toHaveCount(
    0,
  );
  await expect(page.getByRole("link", { name: /Team access/ })).toHaveCount(0);

  /*
    What they DO get: the day, the seats they may look at but not change, and
    the media upload the contract puts no role on.

    The "Add a reel" door came off this screen with yuvoy-operator#33 §4, and
    the Listings TAB that replaced it came off the bar with #56: every listing
    is on Home now. What is here instead is the LOGO, which is mandatory before
    an operator can be booked and is ungated — `PUT /logo` declares a generic
    Forbidden and names no role.
  */
  await expect(page.getByRole("link", { name: /Add a reel/ })).toHaveCount(0);
  /*
    The logo is on the profile itself now — tapping it opens the screen that
    sets it — and it is ungated: `PUT /logo` declares a generic Forbidden and
    names no role. Settings carries the labelled row.
  */
  await expect(page.getByRole("link", { name: /Logo/ }).first()).toBeVisible();

  /*
    Home and Calendar are on the bar for every role, and there is no Listings
    stop for anybody. Asserted on the day rather than here: everything under
    `/account/` is a focused screen since #58, so the bar is deliberately not
    drawn on settings at all.

    And no Money stop (yuvoy-operator#96). Every money read refuses STAFF, so
    the stop would open onto a refusal: a staff phone sees four stops, in the
    same order everybody else's are in.
  */
  await page.goto("/today");
  const nav = page.getByRole("navigation", { name: /Primary/i }).first();
  await expect(nav.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Calendar" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Listings" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Money" })).toHaveCount(0);
  await expect(nav.getByRole("link")).toHaveText([
    /Home/,
    /Bookings/,
    /Calendar/,
    /Business/,
  ]);
});

test("a manager is offered Money and the team, because the server allows them", async ({
  page,
}) => {
  await signIn(page, MANAGER);

  /*
    The positive control. A test that only ever asserts an absence passes just
    as well when the links have been deleted for everybody. Money is a tab of
    its own (yuvoy-operator#96), so its screens are reached from the tab's
    page, and Payout details is its last door.
  */
  await page.goto("/earnings");
  await expect(
    page.getByRole("heading", { level: 1, name: "Money" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Payout details/ }).last(),
  ).toBeVisible();

  await page.goto("/account/settings");
  await expect(page.getByRole("link", { name: /Team access/ })).toBeVisible();

  // And the Money stop, which a manager may open (yuvoy-operator#96).
  await page.goto("/today");
  await expect(
    page
      .getByRole("navigation", { name: /Primary/i })
      .first()
      .getByRole("link", { name: "Money" }),
  ).toBeVisible();
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
  /*
    ONE line, on the Requests pill only, since yuvoy-operator#57 item 9. It was
    a `Problem` panel at the top of the whole screen, which told somebody who
    had come to read their bookings that they could not do something they had
    not tried.
  */
  await expect(
    page.getByText("Only owners, admins and managers can answer requests"),
  ).toBeVisible();
  await expect(
    page.getByText("You can see these, but not answer them"),
  ).toHaveCount(0);

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

  /*
    Reworded on 15 September (yuvoy-operator#43 item 6). It read "Your role
    cannot answer requests. An owner, admin or manager has to." — two sentences
    to say one thing, and the first of them addresses somebody by their role
    rather than saying who to ask.
  */
  await expect(
    page.getByRole("alert").filter({ hasText: "can answer requests" }),
  ).toHaveText("Only owners, admins and managers can answer requests.");

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
  /*
    Reworded on 15 September (yuvoy-operator#45 item 7). Three sentences on this
    screen opened "Your role cannot ...", which addresses the reader by their
    role rather than saying who to ask; they are one `canManage` gate, so they
    are one sentence now and the banner uses it too.
  */
  await expect(
    page.getByText(
      "Only owners, admins and managers can change seats, close dates or record counter sales.",
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
  /*
    The sentence changed with yuvoy-operator#47 item 8. The rule did not: say it
    first rather than let somebody meet a refusal they cannot read.
  */
  await expect(
    page.getByText(
      "Only owners, admins and managers can see what the business is paid",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "That did not load" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);

  // And no figures leaked past the gate on the way to refusing. "Fares" is
  // the label the new screen uses where "Gross" was.
  await expect(page.getByText("Fares")).toHaveCount(0);
  await expect(page.getByText("Next settlement")).toHaveCount(0);
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
  /*
    And it does not send them to an inbox. Where a requested code goes is said
    only on the path that requested one (yuvoy-operator#91); this operator is
    holding theirs already.
  */
  await expect(page.getByText(/We email the code/)).toHaveCount(0);

  // And the code still works, because skipping the send skips nothing that
  // authorises anybody — `POST /auth/session` is the only gate.
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
});

test("that door still needs a whole number, and never promises a phone", async ({
  page,
}) => {
  /*
    This used to assert a "country code" refusal after pressing. Since
    yuvoy-operator#19 the field cannot produce a number without one — `+91` is
    fixed furniture and it takes ten digits — so the refusal is unreachable
    rather than merely handled, and the button waits instead of failing.

    The stronger property is asserted in its place: an incomplete number never
    reaches the code step by EITHER door, and neither door promises a phone.
    Email is named now, as where a requested code goes (yuvoy-operator#91);
    WhatsApp and SMS carry no code today, so neither is.
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
  // The hint that promised a phone message. "Your phone number" is the
  // field's own label, so the pattern is the promise, not the words.
  await expect(page.getByText(/messag\w* your phone/i)).toHaveCount(0);
});

test("asking for a code says it goes to the email on the account, on both steps", async ({
  page,
}) => {
  /*
    yuvoy-operator#91 f22. The screen said nothing about where a code goes, and
    its one hint said the other button skipped "messaging your phone", so every
    operator waited on a phone for a WhatsApp that has never been sent. Since
    yuvoy-api 67e3213 every code goes to the email address on the account.

    Said as where codes go, never as "we sent you one": `POST /auth/otp`
    answers identically for a number we know and one we do not, so the screen
    is never told that this code went anywhere.
  */
  await page.goto("/sign-in");
  await expect(
    page.getByText(/We email the code to the address on your account/),
  ).toBeVisible();
  // The way in for an account with no email, on the same line.
  await expect(
    page.getByRole("link", { name: "+91 81216 57657" }),
  ).toHaveAttribute("href", "tel:+918121657657");
  // Announced with the button it describes, not only drawn under it.
  await expect(
    page.getByRole("button", { name: "Send me a code" }),
  ).toHaveAttribute("aria-describedby", /.+/);

  await page.getByLabel("Your phone number").fill(OWNER);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByLabel("Your code")).toBeVisible();
  await expect(
    page.getByText(/We email the code to the address on your account/),
  ).toBeVisible();
  await expect(page.getByText(/we (sent|have sent|messaged)/i)).toHaveCount(0);
  await expect(page.getByText(/WhatsApp|SMS/i)).toHaveCount(0);
});

test("an offboarded account is told it cannot sign in, and who to call", async ({
  page,
}) => {
  /*
    `403 account_not_active` on `POST /auth/session`: the right code, for a
    number whose account "cannot sign in or use a session". It fell through to
    "We could not sign you in just now. Try again shortly", which no retry can
    ever make true, so the owner went round the same two screens until they
    gave up (yuvoy-operator#91).
  */
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill("+919000000198");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();

  const alert = page.locator("form").getByRole("alert");
  await expect(alert).toHaveText(
    "This business account is on hold, so it cannot be signed into. Call us on +91 81216 57657.",
  );
  await expect(alert).not.toContainText(/Try again/i);
  await expect(page).toHaveURL(/\/sign-in/);
});
