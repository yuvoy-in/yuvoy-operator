import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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

const DEV_CODE = "424242";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill("+919000000101");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("an operator signs in and lands on today", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByText("Try-dive at Nemo Reef")).toBeVisible();
});

test("the session token never reaches JavaScript", async ({ page }) => {
  await signIn(page);

  // httpOnly is the whole architecture. If this ever passes, an XSS on this
  // origin can carry a session away.
  const visible = await page.evaluate(() => document.cookie);
  expect(visible).not.toContain("opsess_");

  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "yvo_session");
  expect(session, "the session cookie should exist").toBeTruthy();
  expect(session!.httpOnly).toBe(true);
  expect(session!.sameSite).toBe("Lax");
});

test("a dead session lands on the sign-in form, not an error page", async ({
  page,
  baseURL,
}) => {
  /*
    A cookie whose session was revoked — the owner removed this person, or the
    session simply expired — exists exactly as hard as a live one. This used
    to brick the phone: requireOperator() cleared the dead cookie DURING
    RENDER, Next threw on the write, the throw pre-empted the redirect, and
    /sign-in bounced any cookie-holder straight back to /today. "That did not
    load", forever, for thirty days.

    The mock answers 401 to any token it did not mint, so a made-up one is a
    dead session. Nothing is signed in here, so both projects may run it.
  */
  await page.context().addCookies([
    {
      name: "yvo_session",
      value: "opsess_dead_e2e",
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto("/today");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Your phone number")).toBeVisible();

  // Signing in from that state must work — the dead cookie is overwritten in
  // the action phase, which is the only place a write is legal.
  await page.getByLabel("Your phone number").fill("+919000000101");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
});

test("a wrong code says one thing, whatever was wrong with it", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill("+919000000101");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill("000000");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Scoped to the form: Next's own route announcer is also role="alert", and
  // an unscoped query matches it too.
  await expect(page.locator("form").getByRole("alert")).toHaveText(
    "That code did not work. Ask for a new one.",
  );
});

test("the manifest is in the HTML, not only the RSC payload", async ({
  page,
  request,
}) => {
  await signIn(page);
  await page.getByText("Try-dive at Nemo Reef").click();
  await page.waitForURL("**/today/slot_dawn");

  // Fetched with the browser's cookies but without running JavaScript — which
  // is what one bar of signal effectively gives you before hydration.
  const cookies = await page.context().cookies();
  const jar = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await request.get("/today/slot_dawn", {
    headers: { cookie: jar },
  });
  const html = await res.text();
  const body = html.slice(html.indexOf("<body"));
  const visible = body.replace(/<script[\s\S]*?<\/script>/g, "");

  expect(visible).toContain("Asha Menon");
  expect(visible).toContain("YV-4K2M9P7Q");
  expect(visible).toContain("Beach 3 dive hut");
});

test("no traveller phone number appears anywhere on the manifest", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/today/slot_dawn");

  // O12. `OperatorBooking.contact` carries the name and only the name —
  // `whatsapp` was there and was removed deliberately. An operator with the
  // number can take next season's booking directly and cut us out.
  const html = await page.content();
  expect(html).not.toMatch(/\+\d{10,}/);
  expect(html.toLowerCase()).not.toContain("whatsapp");
});

test("a live hold is shown, and shown differently", async ({ page }) => {
  await signIn(page);
  await page.goto("/today/slot_dawn");

  // Omitting them "sends the operator into an argument they cannot win".
  await expect(page.getByText("Marco Bianchi")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Still paying" }),
  ).toBeVisible();
  await expect(
    page.getByText("Still paying. Not a confirmed seat yet", { exact: false }),
  ).toBeVisible();
});

test("marking somebody here sticks, and a second tap is not an error", async ({
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
  await row.getByRole("button", { name: "Here", exact: true }).click();
  await expect(row.getByRole("button", { name: "Here ✓" })).toBeVisible();

  // Idempotent server-side: "a second tap on a wet phone keeps the first
  // arrival time and is not an error somebody has to read while eleven people
  // wait."
  await row.getByRole("button", { name: "Here ✓" }).click();
  await expect(row.getByRole("alert")).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Here ✓" })).toBeVisible();

  // It survives a reload, because the manifest is re-read rather than patched.
  await page.reload();
  const after = page.locator("li").filter({ hasText: who });
  await expect(after.getByRole("button", { name: "Here ✓" })).toBeVisible();
});

test("terminal outcomes are absent before the departure has set off", async ({
  page,
}) => {
  await signIn(page);

  // slot_late_morning departs tomorrow morning, so it has never set off —
  // whatever hour this suite runs at. See `earlierToday` in the fixtures.
  await page.goto("/today/slot_late_morning");
  const row = page.locator("li").filter({ hasText: "Nadia Farouk" });
  await expect(row.getByRole("button", { name: "Here" })).toBeVisible();
  // Offering a button the API will refuse is how an operator learns to
  // distrust the screen.
  await expect(row.getByRole("button", { name: "Completed" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "No-show" })).toHaveCount(0);

  // slot_dawn is anchored to a few hours ago, so it has always departed.
  await page.goto("/today/slot_dawn");
  const early = page.locator("li").filter({ hasText: "Daniel Okafor" });
  await expect(early.getByRole("button", { name: "Completed" })).toBeVisible();
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

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}

/* ============================================================ O9 · requests */

/**
 * Requests that no test answers, so their assertions cannot be raced.
 *
 * Answering mutates state in the Next server process, which both Playwright
 * projects share. The mutating tests below take one fixture each, per project;
 * everything that reads the queue reads these two.
 */
const NEVER_ANSWERED = {
  urgent: "Reuben Mathai",
  overCeiling: "Tomas Lindqvist",
};

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
  const banner = page.getByRole("link", { name: /request(s)? waiting/ });
  await expect(banner).toBeVisible();
  // `req_urgent` is never answered, so "within the hour" is always true.
  await expect(banner).toContainText("within the hour");
});

test("requests arrive soonest-to-expire, and that order is not ours to change", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/requests");

  // The endpoint orders by how soon each expires, "because the queue's job is
  // to stop requests dying". Re-sorting by anything undoes what it is for.
  //
  // Asserted as RELATIVE position of two requests nothing answers, rather than
  // as the whole list — the list legitimately shrinks as the other tests run.
  const rows = page.locator("li").filter({ hasText: /min left|h left|d left/ });
  const names = await rows.locator("p.text-lg").allTextContents();

  const urgentAt = names.indexOf(NEVER_ANSWERED.urgent);
  const ceilingAt = names.indexOf(NEVER_ANSWERED.overCeiling);
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
  await page.goto("/requests");

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
  await page.goto("/requests");

  const who = mine(testInfo).accept;
  const row = page.locator("li").filter({ hasText: who });
  await row.getByRole("button", { name: "Accept" }).click();

  // Accepting is not the end: they hold seats with a clock and must still pay.
  // An operator who reads "accepted" as "booked" will not chase it.
  await expect(page.getByText(`Seats granted to ${who}`)).toBeVisible();
  await expect(page.getByText("still have to pay")).toBeVisible();
  // The deadline is the number an operator chases a traveller against.
  await expect(
    page.getByText(/If they have not paid by \d\d:\d\d/),
  ).toBeVisible();

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
  await expect(page.getByText(`Seats granted to ${who}`)).toBeVisible();
  await expect(page.getByText("still have to pay")).toBeVisible();
  // The row itself is gone — the receipt is not a second copy of it.
  await expect(row.getByRole("button", { name: "Accept" })).toHaveCount(0);

  // And it leaves the queue on a real navigation.
  await page.reload();
  await expect(page.getByText(who)).toHaveCount(0);
});

test("declining takes a second tap and asks why", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/requests");

  const who = mine(testInfo).decline;
  const row = page.locator("li").filter({ hasText: who });
  await row.getByRole("button", { name: "Decline" }).click();

  // A decline is cheap for the operator and final for the traveller, which is
  // the asymmetry that earns a confirming step.
  await expect(row.getByRole("group", { name: "Why?" })).toBeVisible();
  await expect(row.getByText("nothing was charged")).toBeVisible();

  await row.getByRole("radio", { name: "Not running that day" }).check();
  await row.getByRole("button", { name: "Decline" }).click();

  await expect(page.getByText(who)).toHaveCount(0);
});

test("/requests has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/requests");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});

/* ==================================================== O10 · relay, call-off */

test("a note is unmistakably not sent to a phone", async ({ page }) => {
  await signIn(page);
  await page.goto("/today/slot_dawn");

  await page
    .getByRole("button", { name: "Tell everybody on this departure" })
    .click();

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

  await page
    .getByRole("button", { name: "Tell everybody on this departure" })
    .click();
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

  await page
    .getByRole("button", { name: "Tell everybody on this departure" })
    .click();
  await page.getByRole("radio", { name: "The time has changed" }).check();
  await page.getByLabel("New time").fill("09:30");
  await page.getByRole("button", { name: "Send it" }).click();

  // "Sent" is not an outcome an operator can check. One confirmed booking on
  // this departure, so one person.
  await expect(page.getByText("Told 1 person")).toBeVisible();
});

test("calling off needs the departure's own id typed, not a checkbox", async ({
  page,
}) => {
  await signIn(page);
  // A wrong id changes nothing, so this can share a departure — but only one
  // that nothing else cancels.
  await page.goto("/today/slot_late_morning");

  await page.getByRole("button", { name: "This departure cannot run" }).click();
  await page.getByRole("radio", { name: "Weather" }).check();
  await page.getByLabel("Type the departure id to confirm").fill("wrong-id");
  await page.getByRole("button", { name: "Call it off" }).click();

  // "A checkbox is one mis-tap on a wet phone away from cancelling a full
  // boat, and this is the only action in the portal that cannot be undone."
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "Nothing was cancelled",
  );

  // The departure is still open.
  await page.reload();
  await expect(page.getByText("This departure is called off")).toHaveCount(0);
});

test("a call-off shows back exactly what it did", async ({
  page,
}, testInfo) => {
  await signIn(page);

  // A departure per project: calling off mutates shared server state, and it
  // is the one action that cannot be undone.
  const slot =
    testInfo.project.name === "mobile" ? "slot_calloff_a" : "slot_calloff_b";
  await page.goto(`/today/${slot}`);

  await page.getByRole("button", { name: "This departure cannot run" }).click();
  await page.getByRole("radio", { name: "Weather" }).check();
  await page.getByLabel("Type the departure id to confirm").fill(slot);
  await page.getByRole("button", { name: "Call it off" }).click();

  /*
    "Somebody who has just cancelled fourteen people's day should see that it
    happened, and how much went back." A confirmation with no numbers is the
    most consequential action in the product ending in silence.
  */
  await expect(
    page.getByRole("heading", { name: "What that did" }),
  ).toBeVisible();
  await expect(page.getByText("Bookings cancelled")).toBeVisible();
  await expect(page.getByText("Guests affected")).toBeVisible();
  await expect(page.getByText("Holds released")).toBeVisible();
  // Money is paise; the screen must render rupees.
  await expect(page.getByText(/₹[\d,]+/)).toBeVisible();
});
