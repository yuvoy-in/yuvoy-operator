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
  await page.getByLabel("The code we sent").fill(DEV_CODE);
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

test("a wrong code says one thing, whatever was wrong with it", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill("+919000000101");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("The code we sent").fill("000000");
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

  // slot_late_morning departs at 23:30 IST — later today, whenever this runs.
  await page.goto("/today/slot_late_morning");
  const row = page.locator("li").filter({ hasText: "Nadia Farouk" });
  await expect(row.getByRole("button", { name: "Here" })).toBeVisible();
  // Offering a button the API will refuse is how an operator learns to
  // distrust the screen.
  await expect(row.getByRole("button", { name: "Completed" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "No-show" })).toHaveCount(0);

  // slot_dawn departed at 06:45 IST, so they are available there.
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

  // And it leaves the queue.
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
