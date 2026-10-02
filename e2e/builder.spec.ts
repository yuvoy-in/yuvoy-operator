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

/*
  The meeting-point map's tiles and its place search are on two outside hosts
  (yuvoy-operator#113). This suite reaches neither: a run must not depend on
  a third party, or load its tiles. Aborted, the map says it did not load and
  the pin is set the ways that need no network, which is what these drive. A
  test that needs search answers it with `page.route`, which wins over this.
*/
const MAP_HOSTS = /^https:\/\/(tiles\.openfreemap\.org|photon\.komoot\.io)\//;

test.beforeEach(async ({ context }) => {
  await context.route(MAP_HOSTS, (route) => route.abort());
});

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
  // And with no reel on it, which submit never required. Exact, because the
  // read-back of what it will look like says the same words in a sentence.
  await expect(
    page.getByText("Nothing on it yet", { exact: true }),
  ).toBeVisible();
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

test("Basics reads as labels and boxes, each reason one tap away", async ({
  page,
}) => {
  /*
    yuvoy-operator#110: "This need trimming. It's confusing." Required is said
    beside the three the save refuses without, one example stays under the
    name, and the reasons are folded rather than deleted.
  */
  await signIn(page);
  await page.goto("/account/listings/new");
  // The activity picker, and its reason, are drawn once there is a category.
  await page.getByLabel("Category", { exact: true }).selectOption("adventure");

  await expect(page.getByText("Required", { exact: true })).toHaveCount(3);
  await expect(
    page.getByLabel("Name", { exact: true }),
  ).toHaveAccessibleDescription("For example, “Try-dive at Nemo Reef”.");

  const reason = page.getByText(/decides which documents we need/);
  await expect(reason).toBeHidden();
  await page
    .locator("details")
    .filter({ has: reason })
    .getByText("Why?")
    .click();
  await expect(reason).toBeVisible();
});

test("the Schedule step picks the days, and sends the week in one save", async ({
  page,
}) => {
  /*
    yuvoy-operator#111: "Add a day" seven times, with nothing carried from one
    row to the next, became seven chips, one time and one seat count for every
    day ticked, in the one `PUT` the API always took.
  */
  const title = unique("Week dive");
  await signIn(page);
  const id = await startDraft(page, title);
  await page.goto(`/account/listings/${id}/edit?step=schedule`);

  for (const day of ["Monday", "Wednesday", "Friday"]) {
    const chip = page.getByRole("button", { name: day, exact: true });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByLabel("Leaves at", { exact: true }).fill("07:30");
  await page.getByLabel("Seats", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Save the schedule" }).click();

  await expect(page.getByText("The weekly schedule is saved")).toBeVisible();
  await expect(page.getByText("3 days a week, from now on.")).toBeVisible();
});

test("a draft nobody has seen can be discarded, and its tile goes with it", async ({
  page,
}) => {
  /*
    yuvoy-operator#112. A draft exists from the moment step one is saved, so
    one started by mistake had no way back. Its own fresh draft, so no other
    test loses a fixture to it.
  */
  const title = unique("Throwaway");
  await signIn(page);
  const id = await startDraft(page, title);

  await page.goto(`/account/listings/${id}`);
  await page.getByRole("button", { name: "Discard this draft" }).click();
  // The question takes focus, and the loud button is inside it.
  await expect(page.getByText(`Discard “${title}”?`)).toBeFocused();
  await page.getByRole("button", { name: "Discard the draft" }).click();

  // Back on Business, which re-read without it.
  await page.waitForURL(/\/account$/);
  await expect(page.getByRole("link", { name: new RegExp(title) })).toHaveCount(
    0,
  );
  // And it is gone, not hidden: its own address finds nothing.
  await page.goto(`/account/listings/${id}`);
  await expect(
    page.getByRole("heading", { name: "There is nothing at that address" }),
  ).toBeVisible();
});

test("a draft that was sent, or a staff login, is offered no discard", async ({
  page,
}) => {
  // `exp_night` was sent and came back: a draft again, and a 409 to delete.
  await signIn(page);
  await page.goto("/account/listings/exp_night");
  await expect(page.getByRole("link", { name: "Edit" }).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Discard this draft" }),
  ).toHaveCount(0);

  // A staff login cannot change a draft, so it cannot discard one either.
  await page.context().clearCookies();
  await signIn(page, "+919000000103");
  await page.goto("/account/listings/exp_boat");
  await expect(
    page.getByRole("button", { name: "Discard this draft" }),
  ).toHaveCount(0);
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

/** The Location step of a new draft, with its pin control. */
async function openLocation(page: Page, title: string) {
  await signIn(page);
  const id = await startDraft(page, title);
  await page.goto(`/account/listings/${id}/edit?step=location`);
  const pin = page.getByRole("group", { name: "Pin on the map" });
  // No network to the tile host here: the map says so, and the rest works.
  await expect(pin.getByText(/The map did not load/)).toBeVisible();
  return { id, pin };
}

const searchBox = (pin: ReturnType<Page["getByRole"]>) =>
  pin.getByRole("searchbox", {
    name: "Search for a place, or paste a maps link",
  });

test("the meeting point takes a pin from a pasted link, keeps it, and lets it go", async ({
  page,
}) => {
  /*
    yuvoy-operator#113, as one walk: set without the map, saved by Next,
    read back from the API, removed, and saved as gone.
  */
  const { id, pin } = await openLocation(page, unique("Pin dive"));
  await expect(pin.getByText("No pin yet.")).toBeVisible();

  await searchBox(pin).fill("https://www.google.com/maps/@11.9695,92.9631,17z");
  await pin
    .getByRole("button", { name: /Put the pin at 11\.96950, 92\.96310/ })
    .click();
  await expect(
    pin.getByText("11.96950, 92.96310", { exact: true }),
  ).toBeVisible();
  await expect(
    pin.getByRole("link", { name: /Check it in Google Maps/ }),
  ).toHaveAttribute(
    "href",
    "https://www.google.com/maps/search/?api=1&query=11.9695,92.9631",
  );

  await page.getByLabel("Where to meet").fill("Beach 3 dive hut");
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForURL(/step=questions/);

  await page.goto(`/account/listings/${id}/edit?step=location`);
  const again = page.getByRole("group", { name: "Pin on the map" });
  await expect(
    again.getByText("11.96950, 92.96310", { exact: true }),
  ).toBeVisible();

  await again.getByRole("button", { name: "Remove the pin" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForURL(/step=questions/);

  await page.goto(`/account/listings/${id}/edit?step=location`);
  await expect(
    page
      .getByRole("group", { name: "Pin on the map" })
      .getByText("No pin yet."),
  ).toBeVisible();
});

test("a place found by name becomes the pin, and Enter never sends the step", async ({
  page,
}) => {
  /*
    Photon answered here the way it answered on 2 Oct 2026 for "havelock",
    trimmed, with the CORS header the real one sends.
  */
  await page.route(/^https:\/\/photon\.komoot\.io\/api\//, (route) =>
    route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [92.9956211, 11.9651954] },
            properties: {
              name: "Havelock island",
              county: "South Andaman",
              state: "Andaman and Nicobar Islands",
              country: "India",
            },
          },
        ],
      },
    }),
  );
  const { pin } = await openLocation(page, unique("Search dive"));

  await searchBox(pin).fill("havelock");
  await expect(
    pin.getByRole("button", { name: /Havelock island/ }),
  ).toBeVisible();
  // Enter takes the first place and stays on the step.
  await searchBox(pin).press("Enter");

  await expect(
    pin.getByText("11.96519, 92.99562", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/step=location/);
});

test("Use my location puts the pin where the phone is", async ({
  page,
  context,
}) => {
  /*
    The browser's own location, allowed for this origin by the
    Permissions-Policy (`geolocation=(self)`); with `geolocation=()` this is
    refused before the browser even asks.
  */
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 11.9695,
    longitude: 92.9631,
    accuracy: 10,
  });
  const { pin } = await openLocation(page, unique("Here dive"));

  await pin.getByRole("button", { name: "Use my location" }).click();

  await expect(
    pin.getByText("11.96950, 92.96310", { exact: true }),
  ).toBeVisible();
});

test("the Location step, pin and all, has no accessibility violations", async ({
  page,
}) => {
  const { pin } = await openLocation(page, unique("Axe dive"));
  await searchBox(pin).fill("11.9695, 92.9631");
  await expect(
    pin.getByRole("button", { name: /Put the pin at/ }),
  ).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
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
