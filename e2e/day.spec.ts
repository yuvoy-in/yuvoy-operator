import { test, expect } from "@playwright/test";
import { expectAccessible } from "./axe";
import { DEV_CODE, signIn } from "./day-kit";

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

test("an operator signs in and lands on Home", async ({ page }) => {
  await signIn(page);
  /*
    The day's own line is the heading now (#56). The screen's `h1` says "Today"
    and is visually hidden: a heading naming the screen is the screen naming
    itself, and the useful heading is what is running today.
  */
  await expect(
    page.getByRole("heading", { name: /^Today · \d+ departures?/ }),
  ).toBeVisible();
  /*
    In the day itself. A bare text search across Home also finds the status
    line's folded reasons, and after the dive's only departure has sailed
    (late in the day on the wall clock) "Try-dive at Nemo Reef has no dates"
    is the first match, and it is hidden until the line is opened.
  */
  await expect(
    page
      .getByRole("region", { name: /^Today · \d+ departures?/ })
      .getByText("Try-dive at Nemo Reef")
      .first(),
  ).toBeVisible();
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
  await expect(
    page.getByRole("heading", { level: 1, name: "Today" }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("heading", { level: 1, name: "Today" }),
  ).toBeVisible();
});

test("the root sends a signed-in operator to the portal, not to sign in", async ({
  page,
}) => {
  // The half of #18 that already worked, pinned so it keeps working.
  await signIn(page);
  await page.goto("/");
  await page.waitForURL("**/today");
  await expect(
    page.getByRole("heading", { level: 1, name: "Today" }),
  ).toBeVisible();
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

test("calling off names the boat and its day, and Keep it changes nothing", async ({
  page,
}) => {
  await signIn(page);
  // Kept, never sent, so this can share a departure, but only one that
  // nothing else cancels.
  await page.goto("/today/slot_late_morning");

  /*
    "Call this departure off", the product's own words (yuvoy-operator#88 s3),
    and a named confirm (owner ruling, 3 Oct 2026): the time, the trip and the
    day, over the one loud button. The departure's id used to be typed back.
    Today or tomorrow, because the fixture's day is fixed when the mock
    starts and the suite can run across midnight.
  */
  await page.getByRole("button", { name: "Call this departure off" }).click();
  const confirm = page.locator("form", {
    has: page.getByRole("button", { name: "Call it off" }),
  });
  await expect(
    confirm.getByRole("heading", {
      name: /^Call off the 09:00 Snorkel trip to Elephant Beach, (today|tomorrow)\?$/,
    }),
  ).toBeVisible();
  // Nothing to type: the only field to write in is the note.
  await expect(confirm.getByRole("textbox")).toHaveCount(1);
  await expect(confirm.getByLabel("Anything to add (optional)")).toBeVisible();
  await expectAccessible(page, "the departure, its call-off confirm open");

  await page.getByRole("radio", { name: "Weather" }).check();
  await confirm.getByRole("button", { name: "Keep it" }).click();
  await expect(
    page.getByRole("button", { name: "Call this departure off" }),
  ).toBeVisible();

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

  await page.getByRole("button", { name: "Call this departure off" }).click();
  await page.getByRole("radio", { name: "Weather" }).check();
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
