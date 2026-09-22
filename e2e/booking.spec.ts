import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * One booking: why it ended, what the party answered, and cancelling it —
 * yuvoy-operator#43.
 *
 * Two claims run through this, and both are about telling an operator the
 * truth when something has gone wrong:
 *
 *   - **Who ended it.** Read "cancelled" with no attribution and an operator
 *     assumes we did it. The most common truth is that the traveller did it
 *     themselves, and the difference turns a routine cancellation into a
 *     support message or an accusation.
 *   - **Cancelling cannot be done by accident.** The reference is typed back
 *     because "this cannot be undone, and a checkbox is one mis-tap away from
 *     the wrong party" — on a manifest of eleven names with wet hands.
 *
 * ## State this suite shares
 *
 * Cancelling is not reversible and the mock's state lives in the Next server
 * process both Playwright projects share, so every test that cancels uses its
 * own booking, one per project. The read-only tests use the pre-cancelled
 * fixtures, which nothing writes to.
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";
/** Arun, STAFF: sees the booking and nothing to act on. */
const STAFF = "+919000000103";

/** Called off by the team. Card, so the money rows are the cancelled shape. */
const CALLED_OFF_CARD = "bkg_calledoff_card";
/** Called off, and its cash is still in the till. */
const CALLED_OFF_CASH = "bkg_calledoff_cash";
/** The traveller cancelled it from their own link. */
const TRAVELLER_LEFT = "bkg_traveller_left";
/** Asha: answered, including one question the listing no longer asks. */
const ANSWERED = "bkg_1";
/** Priya: asked and not answered. */
const UNANSWERED = "bkg_3";

/**
 * A booking this test alone may cancel, one per Playwright project.
 *
 * Cancelling is one-way, so a shared booking would mean the second project
 * finds it already cancelled and reports a product failure that is not there.
 */
function cancellable(testInfo: TestInfo) {
  /*
    Fixtures that exist for this and nothing else. The first version of this
    reused the two cash parties `cash.spec.ts` claims by name for its collection
    walkthroughs, and cancelling one takes its Cash taken button away: that
    suite went red on a booking it had every right to expect.
  */
  return testInfo.project.name === "mobile"
    ? { id: "bkg_cancel_a", reference: "YV-CANCEL1A" }
    : { id: "bkg_cancel_b", reference: "YV-CANCEL2B" };
}

async function signIn(page: Page, phone = OWNER) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("a called-off booking says who called it off, when, and why", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/bookings/${CALLED_OFF_CARD}`);

  await expect(
    page.getByText(/^Called off by your team on \d+ \w+: Weather$/),
  ).toBeVisible();

  /*
    And the money reads as a cancelled booking's: commission is 0, and the net
    is gross less refunds. A payout pays that net when it is above zero, so the
    figure is one an operator reconciles against.
  */
  await expect(page.getByText("Yuvoy's commission")).toBeVisible();
  await expect(page.getByText("Refunds")).toBeVisible();
});

test("a booking the traveller ended says so, rather than implying we did", async ({
  page,
}) => {
  /*
    The most common cancellation there is. Without the attribution an operator
    reads "cancelled" and assumes Yuvoy did it to them, which is the one
    misreading that turns a routine event into a message to support.
  */
  await signIn(page);
  await page.goto(`/bookings/${TRAVELLER_LEFT}`);

  await expect(
    page.getByText(
      /^Cancelled by the traveller on \d+ \w+: the traveller asked$/,
    ),
  ).toBeVisible();
});

test("a booking that is on says nothing about ending", async ({ page }) => {
  // `cancellation` is "present only on a booking that was cancelled or
  // declined", and a live booking must not carry a line about one.
  await signIn(page);
  await page.goto(`/bookings/${ANSWERED}`);

  const body = await page.locator("main").innerText();
  expect(body).not.toContain("Called off");
  expect(body).not.toContain("Cancelled by");
});

test("the answers are shown in order, and an unanswered one is never blank", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/bookings/${ANSWERED}`);

  await expect(page.getByText("What shoe size are you?")).toBeVisible();
  await expect(page.getByText("44", { exact: true })).toBeVisible();

  /*
    "Only an answered question appears with `current: false`", kept "so an
    answer to a reworded question stays readable with the words it answered".
    Marked, because otherwise an operator comparing two parties cannot tell why
    one was asked something the listing does not ask.
  */
  await expect(page.getByText("Can you swim 200m unaided?")).toBeVisible();
  await expect(page.getByText(/no longer asked/)).toBeVisible();

  await page.goto(`/bookings/${UNANSWERED}`);
  await expect(page.getByText("What shoe size are you?")).toBeVisible();
  await expect(page.getByText("Not answered yet")).toBeVisible();
});

test("a needs-review party is chipped, and nothing else from screening shows", async ({
  page,
}) => {
  /*
    `needsAttention` is the server's flag and is NOT derivable from the answers:
    the fixture carries a party the API flagged with `clear: true` beside it. A
    portal that computed one would clear somebody the server held back.

    And nothing else from screening ever reaches a screen (O12, D-018).
  */
  await signIn(page);
  await page.goto("/bookings/bkg_2");
  await expect(page.getByText("Needs review")).toBeVisible();

  await page.goto(`/bookings/${ANSWERED}`);
  await expect(page.getByText("Needs review")).toHaveCount(0);

  const body = (await page.locator("main").innerText()).toLowerCase();
  for (const leak of ["declared", "clear", "medical", "health"]) {
    expect(
      body,
      `"${leak}" is not something this screen may say`,
    ).not.toContain(leak);
  }
});

test("cancelling asks for the reference, and another one changes nothing", async ({
  page,
}, testInfo) => {
  /*
    op#43 item 4's own acceptance. `confirmReference` is "not a boolean: this
    cannot be undone, and a checkbox is one mis-tap away from the wrong party."
  */
  const who = cancellable(testInfo);
  await signIn(page);
  await page.goto(`/bookings/${who.id}`);

  await page.getByRole("button", { name: "Cancel this booking" }).click();

  // A cash booking refunds nothing, because nothing reached us. Saying
  // "refunded in full" here would promise money that was never taken.
  await expect(page.getByText("Nothing is refunded online.")).toBeVisible();

  await page.getByRole("radio", { name: "Weather" }).check();
  await page.getByLabel(/^Type/).fill("YV-SOMEONE-ELSE");
  await page.getByRole("button", { name: "Cancel the booking" }).click();

  /*
    Scoped to the form. Next renders its own `role="alert"` route announcer on
    every page, so an unscoped alert query resolves to two elements, always.
  */
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "That is not this booking's reference.",
  );
  // And nothing happened: the form is still open, on the same booking.
  await expect(
    page.getByRole("button", { name: "Cancel the booking" }),
  ).toBeVisible();
});

test("cancelling works, reports what it cost, and a second press is not an error", async ({
  page,
}, testInfo) => {
  const who = cancellable(testInfo);
  await signIn(page);
  await page.goto(`/bookings/${who.id}`);

  await page.getByRole("button", { name: "Cancel this booking" }).click();
  await page.getByRole("radio", { name: "Not enough people" }).check();
  await page.getByLabel(/^Type/).fill(who.reference.toLowerCase());
  await page.getByRole("button", { name: "Cancel the booking" }).click();

  /*
    Typed in lower case on purpose: "letter case and surrounding spaces are
    ignored", and a portal that uppercased to be safe would hide the day the API
    stopped ignoring it.
  */
  await expect(page.getByText("This booking is cancelled")).toBeVisible();
  await expect(page.getByText(/seats are back on the departure/)).toBeVisible();

  /*
    The booking itself now reads cancelled, with why and by whom, and with no
    tap: the page re-reads underneath the receipt (op#89 f16). It used to keep
    "Collect" and a Cash taken button under the words "This booking is
    cancelled" until somebody pressed "Show the booking".
  */
  await expect(
    page.getByText(/^Cancelled by your team on \d+ \w+: Not enough people$/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Cash taken" })).toHaveCount(0);
  // And the receipt is still there, beside the new state rather than gone.
  await expect(page.getByText("This booking is cancelled")).toBeVisible();

  /*
    And the control is gone rather than offered again. "Retrying after it worked
    answers `409 already_cancelled` and refunds nothing twice" — the portal does
    not get that far, because a cancelled booking is not one it offers to
    cancel.
  */
  await expect(
    page.getByRole("button", { name: "Cancel this booking" }),
  ).toHaveCount(0);
});

test("a cancelled cash booking offers to record the money going back, once", async ({
  page,
}, testInfo) => {
  /*
    op#43 item 5. We refunded nothing because nothing reached us, so the notes
    are with the business and the only thing that closes it out is them handing
    the money over and saying so.

    Single-tenant: recording it cannot be undone, and both projects share the
    mock's process.
  */
  test.skip(
    testInfo.project.name !== "mobile",
    "recording the cash back cannot be undone, and both projects share the mock's state",
  );

  await signIn(page);
  await page.goto(`/bookings/${CALLED_OFF_CASH}`);

  await page.getByRole("button", { name: "I gave the cash back" }).click();
  await expect(page.getByText(/This cannot be undone/)).toBeVisible();
  await page.getByRole("button", { name: "Yes, I gave it back" }).click();

  await expect(page.getByText(/recorded as given back/)).toBeVisible();

  // Once. The button is gone and the booking says what went back and when.
  await page.getByRole("button", { name: "Show the booking" }).click();
  await expect(
    page.getByRole("button", { name: "I gave the cash back" }),
  ).toHaveCount(0);
  await expect(page.getByText(/^Given back ₹4,500 on /)).toBeVisible();
});

test("a staff login is offered neither cancelling nor the cash record", async ({
  page,
}) => {
  /*
    `me.canManage` is the gate, and both endpoints answer 403 to STAFF. The
    controls are withheld rather than offered and refused, the same call the
    capacity ceiling and the team screen make.
  */
  await signIn(page, STAFF);
  await page.goto("/bookings/bkg_1");
  await expect(
    page.getByRole("button", { name: "Cancel this booking" }),
  ).toHaveCount(0);

  await page.goto(`/bookings/${CALLED_OFF_CASH}`);
  await expect(
    page.getByRole("button", { name: "I gave the cash back" }),
  ).toHaveCount(0);
});

test("a departure that has left cannot be cancelled from the portal", async ({
  page,
}) => {
  /*
    The API answers `409 departure_started`, and the refusal is knowable from
    what is already on screen: the departure time is on this page. Withheld
    rather than offered and refused.
  */
  await signIn(page);
  await page.goto("/bookings/bkg_1");
  await expect(
    page.getByRole("button", { name: "Cancel this booking" }),
  ).toHaveCount(0);
});

test("the manifest carries what each party answered", async ({ page }) => {
  /*
    Behind a disclosure, because a manifest is a scanning surface: eleven
    parties with two questions each would push the attendance buttons off a
    phone at 06:30. These questions "never ask about health, which stays with
    `screening`", so unlike the screener there is nothing here that must not be
    read aloud on a jetty.
  */
  await signIn(page);
  await page.goto("/today/slot_dawn");

  const row = page.locator("li").filter({ hasText: "Asha Menon" });
  await row.getByText("What they answered").click();
  await expect(row.getByText("What shoe size are you?")).toBeVisible();
  await expect(row.getByText("44", { exact: true })).toBeVisible();

  // And a party who has not answered says so rather than showing a blank.
  const priya = page.locator("li").filter({ hasText: "Priya Raghavan" });
  await priya.getByText("What they answered").click();
  await expect(priya.getByText("Not answered yet")).toBeVisible();
});

test("a cancelled booking has no accessibility violations", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/bookings/${CALLED_OFF_CARD}`);
  await expect(page.getByText(/^Called off by your team/)).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("the cancel form has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/bookings/bkg_cash_owed");
  await page.getByRole("button", { name: "Cancel this booking" }).click();
  await expect(page.getByLabel(/^Type/)).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
