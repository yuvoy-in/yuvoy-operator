import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * O9's capacity half — the single most important number in the system.
 *
 * The assertions here are all about refusals, because that is what this screen
 * is for. A capacity screen that only proves you can raise a number has proved
 * nothing: the failure it exists to prevent is a boat leaving with people
 * still on the jetty.
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

/** A departure per project: capacity writes mutate shared server state. */
function mySlot(name: string) {
  return name === "mobile"
    ? "Try-dive at Nemo Reef"
    : "Snorkel trip to Elephant Beach";
}

test("the day links to capacity, and capacity lists the fortnight", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Seats and closed dates →" }).click();
  await page.waitForURL("**/capacity");
  await expect(page.getByRole("heading", { name: "Capacity" })).toBeVisible();
  await expect(page.getByText("Try-dive at Nemo Reef")).toBeVisible();
});

test("seats cannot go below what is already sold", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/capacity");

  const row = page
    .locator("li")
    .filter({ hasText: mySlot(testInfo.project.name) });
  const field = row.getByLabel("Seats offered");

  // slot_dawn has 5 sold of 8; slot_late_morning has 1 of 12.
  await field.fill("0");
  await row.getByRole("button", { name: "Set seats" }).click();

  /*
    "Not 'should not' — the database refuses it, because the alternative is a
    traveller with a paid booking and no seat, discovered at a jetty at six in
    the morning."
  */
  await expect(row.getByRole("alert")).toContainText("already sold");
  // And it names the number to type instead, rather than only refusing.
  await expect(row.getByRole("alert")).toContainText("exactly");
});

test("reducing to exactly what is sold is allowed", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/capacity");

  const title = mySlot(testInfo.project.name);
  const row = page.locator("li").filter({ hasText: title });
  const sold = testInfo.project.name === "mobile" ? "5" : "1";

  await row.getByLabel("Seats offered").fill(sold);
  await row.getByRole("button", { name: "Set seats" }).click();

  // That closes the departure without stranding anyone — the operator's way
  // out of a full boat, and the one reduction the API permits.
  await expect(row.getByText(`Now offering ${sold}.`)).toBeVisible();
  await expect(row.getByRole("alert")).toHaveCount(0);

  // And the row itself now says so. The action revalidates the page, and for
  // a month the mock's reads ignored its writes — "Now offering 5." rendered
  // beside a row still reading "5 of 8 sold · 3 left".
  await expect(
    row.getByText(new RegExp(`${sold} of ${sold} sold`)),
  ).toBeVisible();
});

test("closing dates says plainly that it did not cancel anybody", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/capacity");

  await page
    .getByRole("button", { name: "Close dates to new bookings" })
    .click();
  await page.getByRole("radio", { name: "Weather" }).check();
  await page.getByRole("button", { name: "Close them" }).click();

  /*
    "An operator who assumes closing the calendar cancelled the bookings will
    simply not turn up." Today has departures with bookings on them, so the
    owed count must be stated rather than a tick shown.
  */
  await expect(
    page.getByText("Those dates are closed to new bookings", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/You still owe \d+ booking/)).toBeVisible();
  await expect(page.getByText("did not cancel them")).toBeVisible();
});

test("an oversell is never rendered as a success", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/capacity");

  const row = page
    .locator("li")
    .filter({ hasText: mySlot(testInfo.project.name) });
  await row.getByRole("button", { name: "I sold seats at my counter" }).click();

  // Far more than the boat holds, on purpose.
  await row.getByLabel("Seats you sold at your counter").fill("50");
  await row.getByRole("button", { name: "Record it" }).click();

  /*
    "This is the one endpoint in the portal that deliberately refuses to be
    reassuring: an operator who taps 'I sold 3 at the counter' and sees a
    cheerful tick has not understood what they did to three people who paid
    us."
  */
  await expect(row.getByText("This oversold the departure")).toBeVisible();
  // The API's own words are rendered rather than replaced: it names how many
  // people are affected, which a generic "oversold" would lose.
  await expect(
    row.getByText(/paid for a seat that no longer exists/),
  ).toBeVisible();
  await expect(row.getByText(/Incident inc_/)).toBeVisible();
  // The sale still stands — refusing it would not un-sell the seats.
  await expect(row.getByText("The sale was still recorded")).toBeVisible();
  // And emphatically NOT the success wording.
  await expect(row.getByText(/recorded at your counter$/)).toHaveCount(0);

  // The second walk-up sale of the morning does not need a navigation: the
  // receipt offers a fresh form.
  await row.getByRole("button", { name: "Record another sale" }).click();
  await expect(row.getByLabel("Seats you sold at your counter")).toBeVisible();
});

test("/capacity has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/capacity");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
