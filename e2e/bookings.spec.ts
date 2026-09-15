import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Bookings: pills, one search box, and filters — yuvoy-operator#57.
 *
 * ## The claim the whole screen rests on
 *
 * **The server answers the search, the filters and the counts** (D-036). The
 * four badges are totals under the same filters, not counts of what a page
 * happened to load — which is what makes them worth reading at all, and what
 * the old screen could not do: it read two fixed windows of at most a hundred
 * rows each and apologised when a hundred came back.
 *
 * ## And the one the URL rests on
 *
 * "The URL carries `view`, `q`, `experienceId`, `from` and `to`, so back and
 * refresh restore the same pill, search and filters." An operator opens a
 * booking out of a search and presses back; landing at the top of an unfiltered
 * list means doing the search again.
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";
/** Arun, STAFF: sees the queue and may not answer it. */
const STAFF = "+919000000103";

async function signIn(page: Page, phone = OWNER) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/** The four pills, as the segmented control draws them. */
function pill(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Which bookings" })
    .getByRole("link", { name: new RegExp(`^${name}`) });
}

/**
 * The number on a pill.
 *
 * Read out of the text rather than compared as text: the label is uppercased in
 * CSS and carries a line break before the count, so comparing whole strings
 * tests the stylesheet. The number is the thing under test.
 */
async function pillCount(page: Page, name: string): Promise<number> {
  const text = await pill(page, name).innerText();
  return Number(text.replace(/\D+/g, ""));
}

test("the four pills carry counts, and the screen explains nothing", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/bookings");

  for (const name of ["Requests", "Upcoming", "Past", "Cancelled"]) {
    await expect(pill(page, name)).toBeVisible();
  }
  // A number on each, zeroes included.
  await expect(pill(page, "Requests")).toHaveText(/Requests\d+/);
  await expect(pill(page, "Cancelled")).toHaveText(/Cancelled\d+/);

  /*
    "The screen has no paragraph of explanation in any state other than an
    error." The old one carried an eyebrow, a subtitle, three anchor links, two
    section headings and two paragraphs about what the windows were.
  */
  const body = await page.locator("main").innerText();
  for (const gone of [
    "Who is coming",
    "Everyone who has booked you",
    "Waiting on you",
    "Nobody holds a seat until you say yes",
    "the last month and the next three",
    "Only the first 100 bookings",
  ]) {
    expect(body, `"${gone}" came off this screen`).not.toContain(gone);
  }
});

test("Bookings opens on Requests while any are waiting", async ({ page }) => {
  /*
    "Requests if `counts.requests > 0` in that response, otherwise Upcoming.
    Past and Cancelled are never the default." A request has a clock on it and a
    traveller behind it; nothing else on this screen expires.
  */
  await signIn(page);
  await page.goto("/bookings");

  await expect(pill(page, "Requests")).toHaveAttribute("aria-current", "page");
  // And the queue is what is under it, with its answer-by times.
  await expect(page.getByText("Reuben Mathai")).toBeVisible();
});

test("a pill is a URL, so back and refresh land where you were", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/bookings?view=past");

  await expect(pill(page, "Past")).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(pill(page, "Past")).toHaveAttribute("aria-current", "page");
});

test("searching a name narrows every pill at once", async ({ page }) => {
  /*
    op#57 item 4's own acceptance. The badges are the point: a search that
    narrowed only the rows under the open pill would leave an operator looking
    for somebody on three pills that all still said the old number.
  */
  await signIn(page);
  await page.goto("/bookings?view=upcoming");

  const before = await pillCount(page, "Upcoming");
  await page.getByPlaceholder("Guest name or booking reference").fill("asha");

  // Debounced at 300 ms, so the assertion waits for the URL rather than racing.
  await page.waitForURL(/q=asha/);
  await expect(page.getByText("Asha Menon")).toBeVisible();
  await expect.poll(() => pillCount(page, "Upcoming")).toBeLessThan(before);
});

test("a reference finds its booking, with or without the YV-", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/bookings?view=upcoming");

  const box = page.getByPlaceholder("Guest name or booking reference");
  await box.fill("YV-4K2M9P7Q");
  await page.waitForURL(/q=YV-4K2M9P7Q/);
  await expect(page.getByText("Asha Menon")).toBeVisible();

  // "Any part of the reference with or without `YV-`, case ignored."
  await box.fill("4k2m9p7q");
  await page.waitForURL(/q=4k2m9p7q/);
  await expect(page.getByText("Asha Menon")).toBeVisible();
});

test("the box never offers to search by phone", async ({ page }) => {
  /*
    D-018. "A traveller gives us a number so we can tell them about their
    booking, not so it can be added to an operator's contacts" — a placeholder
    offering to search by one would promise a capability this portal must not
    have, and somebody would ask us why it does not work.
  */
  await signIn(page);
  await page.goto("/bookings");

  const body = (await page.locator("main").innerText()).toLowerCase();
  expect(body).not.toContain("phone");
});

test("a listing filter narrows every pill, and Clear puts them all back", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/bookings?view=upcoming");

  const before = await pillCount(page, "Upcoming");
  await page.getByLabel("Which listing").selectOption({ label: "Reef dive" });
  await page.waitForURL(/experienceId=/);
  await expect.poll(() => pillCount(page, "Upcoming")).toBeLessThan(before);

  /*
    Clear is drawn only while something is set. A Clear that is always there is
    a control that does nothing most of the time, and an operator learns to
    ignore it.
  */
  await page.getByRole("button", { name: "Clear" }).click();
  await expect.poll(() => pillCount(page, "Upcoming")).toBe(before);
  await expect(page.getByRole("button", { name: "Clear" })).toHaveCount(0);
});

test("a date filter narrows to a day, and stays on the pill", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/bookings?view=upcoming");

  await page.getByLabel("Which dates").selectOption("today");
  await page.waitForURL(/from=/);
  // The pill is kept: Clear removes the filters, never the pill.
  await expect(pill(page, "Upcoming")).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/view=upcoming/);
});

test("rows are dense, grouped by day, and carry no reference", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/bookings?view=upcoming");

  // The day header, one line, with the totals of what is loaded.
  await expect(
    page
      .getByRole("heading", {
        level: 2,
        name: /· \d+ bookings? · \d+ guests?$/,
      })
      .first(),
  ).toBeVisible();

  /*
    "No reference on the row; it stays on `/bookings/{id}`." A row is scanned at
    a jetty for a name and a time; the reference is what somebody reads out once
    they have found them.
  */
  const rows = page.locator("main li");
  await expect(rows.first()).not.toContainText("YV-");
});

test("a row opens its booking", async ({ page }) => {
  await signIn(page);
  await page.goto("/bookings?view=upcoming");
  await page
    .locator("main")
    .getByRole("link", { name: /\d\d:\d\d/ })
    .first()
    .click();
  await page.waitForURL(/\/bookings\/.+/);
  await expect(
    page.getByRole("link", { name: /Back to bookings/i }),
  ).toBeVisible();
});

test("a search that finds nothing says so, and offers Clear", async ({
  page,
}) => {
  /*
    A different sentence from an empty pill. "No upcoming bookings" to somebody
    who has searched reads as a broken search, and "no bookings match" to
    somebody who has not reads as a fault.
  */
  await signIn(page);
  await page.goto("/bookings?view=upcoming&q=zzzznobody");

  await expect(page.getByText("No bookings match")).toBeVisible();
  await expect(page.getByRole("link", { name: "Clear" })).toBeVisible();
  await expect(page.getByText("No upcoming bookings")).toHaveCount(0);
});

test("the Cancelled pill holds bookings, never a declined request", async ({
  page,
}) => {
  /*
    op#57 item 10. "A request that was declined or ran out of time never became
    a booking, so it is on no pill and on no list." Asserted because the
    tempting reading of "Cancelled" is everything that did not happen.
  */
  await signIn(page);
  await page.goto("/bookings?view=cancelled");

  await expect(page.locator("main")).toContainText("Ishaan Roy");
  // The declined request's traveller is on no pill at all.
  await expect(page.locator("main")).not.toContainText("Reuben Mathai");
});

test("a staff login is told who can answer, on the Requests pill only", async ({
  page,
}) => {
  await signIn(page, STAFF);
  await page.goto("/bookings?view=requests");
  await expect(
    page.getByText("Only owners, admins and managers can answer requests"),
  ).toBeVisible();

  // Not on the others: it is an answer to a question nobody asked there.
  await page.goto("/bookings?view=upcoming");
  await expect(
    page.getByText("Only owners, admins and managers can answer requests"),
  ).toHaveCount(0);
});

test("/bookings has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/bookings?view=upcoming");
  await expect(pill(page, "Upcoming")).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
