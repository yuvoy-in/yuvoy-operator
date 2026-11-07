import { test, expect, type Page } from "@playwright/test";
import { expectAccessible } from "./axe";
import { MAP_HOSTS, signIn, unique, startDraft } from "./builder-kit";

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

/*
  The meeting-point map's tiles and its place search are on two outside hosts
  (yuvoy-operator#113). This suite reaches neither: a run must not depend on
  a third party, or load its tiles. Aborted, the map says it did not load and
  the pin is set the ways that need no network, which is what these drive. A
  test that needs search answers it with `page.route`, which wins over this.
*/

test.beforeEach(async ({ context }) => {
  await context.route(MAP_HOSTS, (route) => route.abort());
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

  await expectAccessible(page, "the builder's Location step, a pin offered");
});

test("the builder has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/account/listings/new");
  await page.waitForLoadState("networkidle");

  await expectAccessible(page, "the builder, a new listing");
});
