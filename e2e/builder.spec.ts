import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The listing builder — yuvoy-operator#58 item 7.
 *
 * One draft, saved step by step. The claim the whole feature rests on is its
 * own done-when: "a listing can be started, closed half-way on Selling,
 * reopened from its tile at Selling with the Basics saved, finished and sent,
 * and it appears in review with no reel attached."
 *
 * Every test here writes, so each one creates its own listing. The two
 * Playwright projects share one Next server and a draft is mutable state.
 */

const DEV_CODE = "424242";

async function signIn(page: Page, phone = "+919000000101") {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/** A title nothing else in the suite can match. */
function unique(prefix: string) {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`;
}

/** Step 1, filled in and saved. Returns the draft's id, from the URL. */
async function startDraft(page: Page, title: string) {
  await page.goto("/account/listings/new");
  await page.getByLabel("Name", { exact: true }).fill(title);
  await page.getByLabel("Category", { exact: true }).selectOption("adventure");
  await page.getByLabel("Activity", { exact: true }).selectOption("scuba");
  await page.getByLabel("Where it runs").selectOption("andaman/havelock");
  await page.getByLabel("One line about it").fill("A first dive off the boat.");
  await page.getByRole("button", { name: "Next" }).click();

  await page.waitForURL(/\/account\/listings\/[^/]+\/edit\?step=selling/);
  const id = /\/listings\/([^/]+)\/edit/.exec(page.url())?.[1] ?? "";
  expect(
    id,
    "the draft was created and the URL replaced with its id",
  ).toBeTruthy();
  return id;
}

test("a listing is started, left half-way, and reopened where it was left", async ({
  page,
}) => {
  /*
    The done-when of item 7, as one walk. Closing the builder is the case that
    matters: nothing is remembered anywhere but the draft, so reopening has to
    derive where to land from `publishBlockers` rather than from a session.
  */
  const title = unique("Wall dive");
  await signIn(page);
  const id = await startDraft(page, title);

  // Closed half-way, by going somewhere else entirely.
  await page.goto("/account");
  await expect(
    page.getByRole("link", { name: new RegExp(title) }),
  ).toBeVisible();

  /*
    Reopened with no `?step=`, and it lands on Selling: Basics is saved, so the
    earliest step still holding a blocker is the price.
  */
  await page.goto(`/account/listings/${id}/edit`);
  await expect(page.getByRole("heading", { name: "Selling" })).toBeVisible();

  // And Basics kept what was typed.
  await page.goto(`/account/listings/${id}/edit?step=basics`);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(title);
  await expect(page.getByLabel("Activity", { exact: true })).toHaveValue(
    "scuba",
  );
});

test("each step saves on Next, and Review sends it", async ({ page }) => {
  const title = unique("Drift dive");
  await signIn(page);
  const id = await startDraft(page, title);

  // Selling.
  await page.getByLabel("Price").fill("4500");
  await expect(page.getByText(/You receive/)).toContainText("₹3,825");
  await page.getByRole("radio", { name: "Per person" }).check();
  await page.getByLabel("Most people per booking").fill("6");
  await page.getByLabel("How long", { exact: true }).fill("180");
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForURL(/step=schedule/);

  // Schedule is skippable: a draft's departures do not sell anyway.
  await expect(
    page.getByText(/Departures made on a draft do not sell/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await page.waitForURL(/step=location/);

  // Location and safety.
  await page.getByLabel("Where to meet").fill("Beach 3 dive hut");
  await page
    .getByLabel("What is included")
    .fill("Mask and fins\nOne guided dive");
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForURL(/step=questions/);

  // Questions, and the health warning that belongs on this step.
  await expect(page.getByText(/Do not ask about health here/)).toBeVisible();
  await page.getByRole("button", { name: "Add a question" }).click();
  await page.getByLabel("Question 1").fill("Have you dived before?");
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForURL(/step=media/);

  // Media is never required.
  await expect(page.getByText("Nothing on it yet")).toBeVisible();
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await page.waitForURL(/step=review/);

  /*
    Review reads the whole thing back, names the documents a listing like this
    needs without blocking on them, and offers the send.
  */
  await expect(
    page.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  await expect(page.getByText("1 question")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Documents a listing like this needs" }),
  ).toBeVisible();
  await expect(page.getByText("Needed").first()).toBeVisible();

  /*
    "200 → open `/account/listings/{id}`, badge In review." It gets there on its
    own: sending revalidates, the edit route re-renders, and a listing that is no
    longer a draft redirects to itself. The receipt would have been on a screen
    the operator is leaving, and the badge says the same thing where they land.
  */
  await page.getByRole("button", { name: "Send for review" }).click();
  await page.waitForURL(/\/account\/listings\/[^/]+$/);
  await expect(page.getByText("In review")).toBeVisible();
  // And with no reel on it, which submit never required.
  await expect(page.getByText("Nothing on it yet")).toBeVisible();
  expect(page.url()).toContain(id);
});

test("Send waits for the two fields approval demands and submit does not", async ({
  page,
}) => {
  /*
    `activityType` and `pricingUnit` are the two mandatory fields the submit
    gate does not enforce. Sending without them is accepted and then refused by
    a person days later, about controls the operator has right here.
  */
  const title = unique("Night drift");
  await signIn(page);

  await page.goto("/account/listings/new");
  await page.getByLabel("Name", { exact: true }).fill(title);
  await page.getByLabel("Category", { exact: true }).selectOption("adventure");
  await page.getByLabel("Where it runs").selectOption("andaman/havelock");
  await page.getByLabel("One line about it").fill("After dark, off the wall.");
  // Deliberately no activity type.
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForURL(/step=selling/);
  const id = /\/listings\/([^/]+)\/edit/.exec(page.url())?.[1] ?? "";

  await page.goto(`/account/listings/${id}/edit?step=review`);
  await expect(
    page.getByText("Say what kind of activity this is first."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send for review" }),
  ).toHaveCount(0);

  /*
    The bar says which step is still holding something, in words as well as
    colour: each segment is a link named for its step, and an unfinished one
    says so in its name.
  */
  await expect(
    page.getByRole("link", { name: "Step 1, Basics, still missing something" }),
  ).toBeVisible();
});

test("a step that is refused stays where it is and says why", async ({
  page,
}) => {
  /*
    "A failed save stays on the step and shows the error." Moving on from a step
    that did not save is how an operator loses twenty minutes and finds out at
    Review.
  */
  const title = unique("Cave dive");
  await signIn(page);
  const id = await startDraft(page, title);

  await page.goto(`/account/listings/${id}/edit?step=selling`);
  await page.getByLabel("Price").fill("0");
  // A basis IS chosen, so the refusal under test is the price and not the one
  // field with no default.
  await page.getByRole("radio", { name: "Per person" }).check();
  await page.getByRole("button", { name: "Next" }).click();

  // `.first()`: the step's own refusal, not the route announcer behind it.
  await expect(page.getByRole("alert").first()).toContainText(
    "A price in rupees",
  );
  await expect(page).toHaveURL(/step=selling/);
});

test("a listing that is no longer a draft is not built, it is amended", async ({
  page,
}) => {
  /*
    The two edit screens. A draft opens the builder; anything published opens
    the revision form, which proposes a change to something travellers are
    booking against.
  */
  await signIn(page);
  await page.goto("/account");
  await page
    .getByRole("link", { name: /^Reef dive(?![\w])/ })
    .first()
    .click();
  await page.waitForURL(/\/account\/listings\/[^/]+$/);
  await page.getByRole("link", { name: "Edit", exact: true }).click();

  await expect(page.getByRole("navigation", { name: "Steps" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Propose a change" }),
  ).toBeVisible();
});

test("the builder has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/account/listings/new");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
