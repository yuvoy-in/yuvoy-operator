import { test, expect } from "@playwright/test";
import { expectAccessible } from "./axe";
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

test("checking somebody in sticks, and a second tap is not an error", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/today/slot_dawn");

  /*
    A party per project, because the mock's attendance state lives in the Next
    server process and both projects share one. Two tests ticking off the same
    person in parallel is not a race the app has — it is a race the fixture
    has — and pinning one name per project keeps the assertion strict rather
    than softening it to "whichever button is there".
  */
  const who =
    testInfo.project.name === "mobile" ? "Asha Menon" : "Priya Raghavan";
  const row = page.locator("li").filter({ hasText: who });
  /*
    "Check in", and "Checked in" once done (yuvoy-operator#88 s3): "Here" is
    our word, and on a jetty it read as a question.
  */
  await row.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "Checked in", exact: true }),
  ).toBeVisible();

  // Idempotent server-side: "a second tap on a wet phone keeps the first
  // arrival time and is not an error somebody has to read while eleven people
  // wait."
  await row.getByRole("button", { name: "Checked in", exact: true }).click();
  await expect(row.getByRole("alert")).toHaveCount(0);
  await expect(
    row.getByRole("button", { name: "Checked in", exact: true }),
  ).toBeVisible();

  // It survives a reload, because the manifest is re-read rather than patched.
  await page.reload();
  const after = page.locator("li").filter({ hasText: who });
  await expect(
    after.getByRole("button", { name: "Checked in", exact: true }),
  ).toBeVisible();
});

test("terminal outcomes are absent before the departure has set off", async ({
  page,
}) => {
  await signIn(page);

  // slot_late_morning departs tomorrow morning, so it has never set off —
  // whatever hour this suite runs at. See `earlierToday` in the fixtures.
  await page.goto("/today/slot_late_morning");
  const row = page.locator("li").filter({ hasText: "Nadia Farouk" });
  await expect(
    row.getByRole("button", { name: "Check in", exact: true }),
  ).toBeVisible();
  // Offering a button the API will refuse is how an operator learns to
  // distrust the screen.
  await expect(row.getByRole("button", { name: "Completed" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "No-show" })).toHaveCount(0);

  // slot_dawn is anchored to a few hours ago, so it has always departed.
  await page.goto("/today/slot_dawn");
  const early = page.locator("li").filter({ hasText: "Daniel Okafor" });
  await expect(early.getByRole("button", { name: "Completed" })).toBeVisible();

  /*
    And a terminal outcome takes two taps. The API refuses to overwrite a
    settled booking, so one tap used to record a paying guest as a no-show
    for good. Armed, said out loud, and disarmed here — never confirmed,
    because Daniel is a shared fixture both projects read.
  */
  await early.getByRole("button", { name: "No-show" }).click();
  await expect(
    early.getByText(/Mark Daniel Okafor as a no-show\? This cannot be changed/),
  ).toBeVisible();
  await early.getByRole("button", { name: "Not that" }).click();
  await expect(early.getByRole("button", { name: "No-show" })).toBeVisible();
  await expect(early.getByRole("button", { name: /Confirm/ })).toHaveCount(0);
});

test("the departure has one title, and nothing repeats it", async ({
  page,
}) => {
  /*
    yuvoy-operator#80 t2 and #88 s3. The day moved from an eyebrow into the line
    under the title, beside where to meet; the "Manifest" caption and the "Tell
    everybody" heading over its own button are gone; the total says "Checked
    in", not "Here".
  */
  await signIn(page);
  await page.goto("/today/slot_dawn");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /^\d\d:\d\d Try-dive at Nemo Reef$/,
  );
  await expect(page.getByText(/ · Beach 3 dive hut, 06:30$/)).toBeVisible();
  await expect(page.getByText("Manifest", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Tell everybody", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator("dt", { hasText: "Checked in" })).toBeVisible();
  await expect(page.locator("dt", { hasText: /^Here$/ })).toHaveCount(0);
});

test("a called-off departure says so before anything else", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/today/slot_called_off");
  await expect(page.getByText("This departure is called off")).toBeVisible();
});

test("another operator's departure is a 404, never a 403", async ({ page }) => {
  await signIn(page);
  const res = await page.goto("/today/slot_belonging_to_somebody_else");
  expect(res?.status()).toBe(404);
});

test("signing out ends the session on the server too", async ({ page }) => {
  await signIn(page);
  // Sign out lives in Settings, behind the gear on the business profile, with
  // everything else about the account. The day carries nothing but the day.
  await page.goto("/account/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/sign-in");

  await page.goto("/today");
  await expect(page).toHaveURL(/\/sign-in$/);
});

for (const route of ["/sign-in", "/today", "/today/slot_dawn"]) {
  test(`${route} has no accessibility violations`, async ({ page }) => {
    if (route !== "/sign-in") await signIn(page);
    await page.goto(route);
    await page.waitForLoadState("networkidle");

    await expectAccessible(page, route);
  });
}

/* ============================================================ O9 · requests */

/** The party this project may answer, so the two never collide. */
function mine(testInfo: { project: { name: string } }) {
  return testInfo.project.name === "mobile"
    ? { accept: "Ingrid Sorensen", decline: "Aditi Bose" }
    : { accept: "Kwame Boateng", decline: "Yuki Tanabe" };
}

test("the day surfaces requests, because a request nobody sees expires", async ({
  page,
}) => {
  await signIn(page);
  /*
    First in Home's "Needs you" since yuvoy-operator#96, each with its clock
    (#82 s2). `req_urgent` is never answered and has 24 minutes on it, so it
    is always the first row.
  */
  const first = page
    .getByRole("region", { name: "Needs you" })
    .getByRole("listitem")
    .first();
  await expect(first).toBeVisible();
  await expect(first).toContainText("24 min left");
});

test("requests arrive soonest-to-expire, and that order is not ours to change", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/bookings");

  // The endpoint orders by how soon each expires, "because the queue's job is
  // to stop requests dying". Re-sorting by anything undoes what it is for.
  //
  // Asserted as RELATIVE position of two requests nothing answers, rather than
  // as the whole list — the list legitimately shrinks as the other tests run.
  const rows = page.getByRole("listitem", { name: /^Seat request from / });
  // The queue has arrived before it is read: a bare read can land on the
  // loading skeleton and find nothing.
  await expect(rows.first()).toBeVisible();
  const names = await rows.evaluateAll((items) =>
    items.map((item) => item.getAttribute("aria-label")),
  );

  const urgentAt = names.indexOf(`Seat request from ${NEVER_ANSWERED.urgent}`);
  const ceilingAt = names.indexOf(
    `Seat request from ${NEVER_ANSWERED.overCeiling}`,
  );
  expect(
    urgentAt,
    "the urgent request should be listed",
  ).toBeGreaterThanOrEqual(0);
  expect(ceilingAt, "the later request should be listed").toBeGreaterThan(
    urgentAt,
  );
});

test("a request that cannot be granted does not offer an accept", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/bookings");

  // 5 guests against 3 grantable seats. Accepting answers 409
  // grant_ceiling_exceeded, so the button is disabled rather than offered.
  const row = page
    .locator("li")
    .filter({ hasText: NEVER_ANSWERED.overCeiling });
  await expect(row).toContainText("not enough for this party");
  await expect(row.getByRole("button", { name: "Accept" })).toBeDisabled();
  // Declining is still available — that is the whole point of the screen.
  await expect(row.getByRole("button", { name: "Decline" })).toBeEnabled();
});

test("accepting says what the traveller actually has now", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/bookings");

  const who = mine(testInfo).accept;
  const row = page.getByRole("listitem", { name: `Seat request from ${who}` });
  await row.getByRole("button", { name: "Accept" }).click();

  // Held five seconds with an Undo before anything is sent (experiment A).
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

  // Accepting is not the end: they hold seats with a clock and must still pay.
  // An operator who reads "accepted" as "booked" will not chase it.
  const receipt = page
    .getByRole("listitem")
    .filter({ hasText: `Seats granted to ${who}` });
  await expect(receipt).toBeVisible({ timeout: 15_000 });
  await expect(receipt).toContainText("still have to pay");
  // The deadline is the number an operator chases a traveller against.
  await expect(receipt).toContainText(/If they have not paid by \d\d:\d\d/);

  /*
    The receipt must survive the page's own refresh. `RefreshOnFocus` calls
    `router.refresh()` on every focus and every minute; the server re-renders
    the queue WITHOUT the accepted request, and a receipt that lived inside
    that row went with it — flip to WhatsApp to tell the traveller to pay,
    flip back, and "still have to pay" was gone. It lives above the list now.
  */
  const refreshed = page.waitForResponse((r) => r.url().includes("_rsc"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("still have to pay");
  // The row itself is gone — the receipt is not a second copy of it.
  await expect(row).toHaveCount(0);

  // And it leaves the queue on a real navigation.
  await page.reload();
  await expect(page.getByText(who)).toHaveCount(0);
});

test("declining takes a second tap and asks why", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/bookings");

  const who = mine(testInfo).decline;
  const row = page.getByRole("listitem", { name: `Seat request from ${who}` });
  await row.getByRole("button", { name: "Decline" }).click();

  // A decline is cheap for the operator and final for the traveller, which is
  // the asymmetry that earns a confirming step.
  await expect(row.getByRole("group", { name: "Why?" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Decline" })).toBeDisabled();

  // The reason is a chip: its words are what a thumb presses.
  await row.getByText("Not running that day", { exact: true }).click();
  await expect(
    row.getByRole("radio", { name: "Not running that day" }),
  ).toBeChecked();
  // The sentence the traveller will read, the API's own, before it is sent.
  const first = who.split(" ")[0];
  await expect(row).toContainText(`${first} reads`);
  await expect(row).toContainText(
    "The operator isn't running that departure after all. Nothing was charged.",
  );
  await expectAccessible(page, "Bookings, a decline open on its reasons");
  await row.getByRole("button", { name: "Decline" }).click();

  // Held, then sent, then said: and the request has left the queue.
  const receipt = page
    .getByRole("listitem")
    .filter({ hasText: `Declined ${who}` });
  await expect(receipt).toBeVisible({ timeout: 15_000 });
  await expect(receipt).toContainText(
    "They read: The operator isn't running that departure after all.",
  );
  await expectAccessible(page, "Bookings, the receipt of a decline");
  await page.reload();
  await expect(page.getByText(who)).toHaveCount(0);
});

test("/bookings has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/bookings");
  await page.waitForLoadState("networkidle");

  await expectAccessible(page, "/bookings");
});

/* ==================================================== O10 · relay, call-off */

test("a note is unmistakably not sent to a phone", async ({ page }) => {
  await signIn(page);
  await page.goto("/today/slot_dawn");

  await page.getByRole("button", { name: "Message everyone booked" }).click();

  /*
    The most important sentence on the panel. "An operator who thinks they
    messaged somebody and did not is worse than one who knows they left a
    note." It is present whichever intent is chosen, because a note can ride
    along with any of them.
  */
  await expect(
    page.getByText(
      "This goes on their booking page. It is never sent to a phone.",
    ),
  ).toBeVisible();
});

test("the relay refuses a link, and says why", async ({ page }) => {
  await signIn(page);
  await page.goto("/today/slot_dawn");

  await page.getByRole("button", { name: "Message everyone booked" }).click();
  await page
    .getByRole("radio", { name: "The meeting point has changed" })
    .check();
  await page.getByLabel("New meeting point").fill("See https://x.example");
  await page.getByRole("button", { name: "Send it" }).click();

  // Not injection safety — a template variable holding a URL renders as
  // something nobody approved, and the provider may reject the whole message.
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "no links or line breaks",
  );
});

test("a relay to a departure says how many people it reached", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/today/slot_late_morning");

  await page.getByRole("button", { name: "Message everyone booked" }).click();
  await page.getByRole("radio", { name: "The time has changed" }).check();
  await page.getByLabel("New time").fill("09:30");
  await page.getByRole("button", { name: "Send it" }).click();

  // "Sent" is not an outcome an operator can check. One confirmed booking on
  // this departure, so one person, and by email, which is how it goes out
  // while there is no WhatsApp sender.
  await expect(page.getByText("Told 1 person by email")).toBeVisible();
});

test("a relay names the people it could not reach", async ({ page }) => {
  /*
    yuvoy-operator#89. `recipients` counts people a message is going to, and
    `notReached` the ones nothing could carry it to: on `slot_dawn` Priya left
    only a WhatsApp number, so a departure-wide update reaches two of three.
    This screen said "Told 3 people". A relay stores nothing in the mock, so
    both projects can send it.
  */
  await signIn(page);
  await page.goto("/today/slot_dawn");

  await page.getByRole("button", { name: "Message everyone booked" }).click();
  await page.getByRole("radio", { name: "The time has changed" }).check();
  await page.getByLabel("New time").fill("07:30");
  await page.getByRole("button", { name: "Send it" }).click();

  await expect(page.getByText("Told 2 people by email")).toBeVisible();
  await expect(
    page.getByText(/^1 person on this departure could not be sent this/),
  ).toBeVisible();
});
