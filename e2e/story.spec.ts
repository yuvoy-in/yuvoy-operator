import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Your story — yuvoy-operator#41.
 *
 * What a traveller reads about a business before getting on its boat: the
 * operator's own words and photographs, and the two facts Yuvoy checks. The
 * split is the API's, and the assertion that matters most is that the checked
 * facts are stated rather than offered as inputs.
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

/** A one-pixel PNG: a real image for the host, and nothing to look at. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test("Business opens the story, and the checked facts are facts rather than inputs", async ({
  page,
}) => {
  await signIn(page);
  // The doors moved behind the gear on the profile, #58 item 9.
  await page.goto("/account/settings");
  await page.getByRole("link", { name: /Your story/ }).click();
  await page.waitForURL("**/story");
  await expect(
    page.getByRole("heading", { level: 1, name: "Your story" }),
  ).toBeVisible();

  const checked = page.getByRole("region", { name: "Checked by us" });
  await expect(checked.getByText("2014", { exact: true })).toBeVisible();
  await expect(
    checked.getByText("Beach No. 3, Havelock (Swaraj Dweep)"),
  ).toBeVisible();
  // The API's own reason, verbatim.
  await expect(
    checked.getByText(/change through us rather than in place/),
  ).toBeVisible();
  // "A disabled text field reads as a bug."
  await expect(checked.getByRole("textbox")).toHaveCount(0);
});

test("writing about the business: the floor, the count, and the save", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "the story is one shared document — single-tenant by design, so it runs on the primary project only",
  );
  await signIn(page);
  await page.goto("/story");

  const about = page.getByLabel("About your business");
  const save = page.getByRole("button", { name: "Save" });

  await about.fill("We dive.");
  await expect(page.getByText("8 of 600")).toBeVisible();
  await expect(save).toBeDisabled();

  const words =
    "Two instructors and one boat, out of Beach No. 3 since 2014. Tell us if you are nervous in the water.";
  await about.fill(words);
  await page
    .getByLabel("Languages your crew speaks")
    .fill("English, Hindi, english, Bengali");
  await save.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();

  // Read back from the server, not from the form that sent it.
  await page.reload();
  await expect(page.getByLabel("About your business")).toHaveValue(words);
  await expect(page.getByLabel("Languages your crew speaks")).toHaveValue(
    "English, Hindi, Bengali",
  );
});

test("a photograph of the operation goes on the page, and comes off it", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "the photographs are one shared gallery — single-tenant by design, so it runs on the primary project only",
  );
  await signIn(page);
  await page.goto("/story");

  const tiles = page
    .getByRole("region", { name: "Photographs" })
    .getByRole("listitem");
  const before = await tiles.count();

  await page.getByLabel("Add a photograph").setInputFiles({
    name: "boat.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.getByText("Added. It is on your page now.")).toBeVisible();
  await expect(tiles).toHaveCount(before + 1);

  // The newest takes the lowest free slot, which here is the last tile.
  const added = tiles.last();
  await added.getByRole("button", { name: /^Remove photograph/ }).click();
  await added.getByRole("button", { name: "Remove it" }).click();
  await expect(tiles).toHaveCount(before);
});

test("Preview your operator page opens the business's public page", async ({
  page,
}) => {
  /*
    There was no such button for two days: no operator endpoint returned the
    business's slug, and a button that guessed the address would lead to
    somebody else's page on the day the guess was wrong. `GET /me` carries
    `slug` now (yuvoy-api#164).

    The href is asserted rather than followed. It is a different origin and a
    different product; a test that navigated would be testing yuvoy-app, and
    there is no yuvoy-app running here.
  */
  await signIn(page);
  await page.goto("/story");

  const preview = page.getByRole("link", {
    name: /Preview your operator page/,
  });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute(
    "href",
    "https://app.yuvoy.in/o/reef-divers-havelock",
  );
  // A different product in a different tab, so a half-written story survives.
  await expect(preview).toHaveAttribute("target", "_blank");
  await expect(preview).toHaveAttribute("rel", /noreferrer/);
});

test("the About count is the letters typed, not the bytes", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "the story is one shared document — single-tenant by design, so it runs on the primary project only",
  );
  /*
    It counted bytes, because `SaveStory` checked Go's `len`. Every letter of
    Bengali or Devanagari is three of those, so a business writing in one got
    about 200 characters rather than 600 — and the screen carried a line
    excusing the discrepancy. The API counts characters now
    (yuvoy-operator#41).
  */
  await signIn(page);
  await page.goto("/story");

  const about = page.getByLabel("About your business");
  // Forty characters, one of them a curly apostrophe the phone types itself.
  await about.fill("We’re out past the reef by seven, daily.");
  await expect(page.getByText("40 of 600")).toBeVisible();
  await expect(page.getByText(/counts faster than you type/)).toHaveCount(0);

  // And a Bengali paragraph is measured in letters, where it used to be
  // refused at a third of its length.
  await about.fill("আ".repeat(120));
  await expect(page.getByText("120 of 600")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
});

test("/story has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/story");
  await page.waitForLoadState("networkidle");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
