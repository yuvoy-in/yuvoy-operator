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

test("an operator signs in and lands on Home", async ({ page }) => {
  await signIn(page);
  /*
    The day's own line is the heading now (#56). The screen's `h1` says "Home"
    and is visually hidden: a heading naming the screen is the screen naming
    itself, and the useful heading is what is running today.
  */
  await expect(
    page.getByRole("heading", { name: /^Today · \d+ departures?/ }),
  ).toBeVisible();
  await expect(page.getByText("Try-dive at Nemo Reef").first()).toBeVisible();
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

test("being bounced off a page comes back to that page, not to Today", async ({
  page,
  baseURL,
}) => {
  /*
    yuvoy-operator#18's second half, and the half that was actually missing.
    The root already routed by session — `/` 307s to `/today`, which 307s to
    `/sign-in` only when there is nobody signed in — but a session that ran out
    mid-visit lost the page it ran out on. "An operator who taps a link to a
    booking, gets bounced to sign-in and then lands on Today has to find that
    booking again, usually on a phone, usually while somebody is standing in
    front of them."
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

  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fcalendar$/);

  await page.getByLabel("Your phone number").fill("9000000101");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Back where they were headed, rather than on the day.
  await page.waitForURL("**/calendar");
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
});

test("a return path cannot be pointed off the site", async ({ page }) => {
  /*
    `?next=` is attacker-controlled by construction — anybody can send an
    operator a link to `operators.yuvoy.in/sign-in?next=…`. Unchecked it
    forwards them anywhere on the internet immediately AFTER a successful
    sign-in, from a real Yuvoy URL, at the moment they are most inclined to
    trust the next page. `safeReturnPath` bounds it; this is the rendered half
    of the same guard its unit tests cover exhaustively.
  */
  await page.goto("/sign-in?next=https://example.com/phish");
  await page.getByLabel("Your phone number").fill("9000000101");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/today");
  await expect(page).toHaveURL(/operators?\b|127\.0\.0\.1|localhost/);
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
});

test("the root sends a signed-in operator to the portal, not to sign in", async ({
  page,
}) => {
  // The half of #18 that already worked, pinned so it keeps working.
  await signIn(page);
  await page.goto("/");
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
  /*
    The departure row, not the listing tile: Home carries both since #56 and
    they share a title. Only the row goes to a manifest.

    Named rather than taken as `.first()`. The rows are sorted by time and
    `slot_dawn` is `earlierToday()`, which is now minus three hours: after 18:30
    it overtakes the 15:30 fixture and the first row becomes a different
    departure. That is the same class of bug the comment on `earlierToday`
    already describes, one layer along, and the fix is not to depend on the
    order at all.
  */
  await page
    .getByRole("region", { name: /departures?/ })
    .getByRole("link", { name: /Try-dive at Nemo Reef/ })
    .first()
    .click();
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

test("the manifest names who has no screening answer, and counts them", async ({
  page,
}) => {
  await signIn(page);
  // A try-dive: this departure asks a medical question.
  await page.goto("/today/slot_dawn");

  /*
    Two of four, and the denominator is the rows on screen rather than
    `totals.parties` — so this assertion fails if the summary ever starts
    counting something the reader cannot count back.
  */
  await expect(
    page.getByRole("heading", { name: "Medical question" }),
  ).toBeVisible();
  await expect(page.getByText("2 of 4 have no answer recorded")).toBeVisible();

  // Priya was asked and has not answered. Marco is a hold carrying no
  // screening at all on a departure where others have it — the ambiguous
  // case, resolved loudly on purpose.
  await expect(
    page.getByText("No screening answer recorded", { exact: false }),
  ).toHaveCount(2);

  // Daniel is flagged by the API. Rendered, and never explained.
  await expect(
    page.getByText("Check with them before boarding."),
  ).toBeVisible();
});

test("nothing about screening reaches a departure that never asks", async ({
  page,
}) => {
  await signIn(page);
  // A snorkel trip. No screener, so no party carries the field.
  await page.goto("/today/slot_late_morning");

  /*
    The false alarm this feature must not cause: "a false alarm on this signal
    teaches an instructor to skip the column", which is worse than having no
    column. Nadia looks identical to Marco on the wire — an absent `screening`
    — and only the rest of the manifest can tell them apart.
  */
  await expect(page.getByText("Nadia Farouk", { exact: true })).toBeVisible();
  await expect(page.getByText("Medical question")).toHaveCount(0);
  await expect(page.getByText(/screening answer/i)).toHaveCount(0);
  await expect(page.getByText(/before boarding/i)).toHaveCount(0);
});

test("the manifest never says what anybody disclosed", async ({ page }) => {
  await signIn(page);
  await page.goto("/today/slot_dawn");

  /*
    "A manifest is read on a jetty, out loud, in front of other customers. The
    instructor needs to know a party was screened, not what they said."

    Daniel's fixture carries `clear: true` and `answeredVersion: 3`. Neither
    may reach the page: the first is a statement about a person's health and
    the second is noise on a dock. This asserts against the served HTML rather
    than the visible text, so a value hidden in an attribute or an RSC payload
    fails too.
  */
  const html = (await page.content()).toLowerCase();
  for (const forbidden of [
    "declared",
    "cleared",
    "clear to dive",
    "answeredversion",
    "medically",
    "condition",
  ]) {
    expect(html).not.toContain(forbidden);
  }
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
  await expect(first).toContainText("answer within 24 min");
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
  await page.goto("/bookings");

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

test("/bookings has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/bookings");
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

  await page
    .getByRole("button", { name: "Tell everybody on this departure" })
    .click();
  await page.getByRole("radio", { name: "The time has changed" }).check();
  await page.getByLabel("New time").fill("07:30");
  await page.getByRole("button", { name: "Send it" }).click();

  await expect(page.getByText("Told 2 people by email")).toBeVisible();
  await expect(
    page.getByText(/^1 person on this departure could not be sent this/),
  ).toBeVisible();
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
  // Money is paise; the screen must render rupees. Online only: the card
  // party's fare (2 guests on A, 3 on B), and nothing for the one who paid at
  // the counter.
  await expect(page.getByText("Refunded online")).toBeVisible();
  await expect(
    page.getByText(testInfo.project.name === "mobile" ? "₹9,000" : "₹13,500"),
  ).toBeVisible();

  /*
    THE CASH NOBODY REFUNDS: yuvoy-operator#95. The counter-paying party's
    ₹4,500 is in the till, and the receipt used to say everybody had been
    refunded in full. It names the money instead, and the manifest lists who
    it belongs to until the return is recorded.
  */
  await expect(page.getByText("You are holding ₹4,500 in cash")).toBeVisible();
  await expect(page.getByText("This departure is called off")).toBeVisible();
  const owed = page.getByRole("region", { name: /that is not yours/ });
  await expect(owed).toContainText("₹4,500");
  await expect(owed).toContainText(
    testInfo.project.name === "mobile" ? "YV-CA5HA7K2" : "YV-CB5HB8M3",
  );

  // Two taps, because a record of money handed over cannot be undone.
  await owed.getByRole("button", { name: "I gave the cash back" }).click();
  await owed.getByRole("button", { name: "Yes, I gave it back" }).click();
  await expect(owed.getByText("₹4,500 recorded as given back")).toBeVisible();
  await owed.getByRole("button", { name: "Update the list" }).click();

  // Recorded, so the money is no longer named: the list is gone.
  await expect(
    page.getByRole("region", { name: /that is not yours/ }),
  ).toHaveCount(0);
});

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
  expect(body).toMatch(/do not show traveller phone numbers/i);
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

  const row = page.locator("li").filter({ hasText: NEVER_ANSWERED.urgent });
  await expect(row).toContainText(
    /(Today|Tomorrow|[A-Z][a-z]+day,? \d+ [A-Z][a-z]+) at \d\d:\d\d/,
  );
  await expect(row).toContainText(/asked (just now|\d+ (min|h|d) ago)/);
});
