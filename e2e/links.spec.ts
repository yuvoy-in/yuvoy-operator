import { test, expect, type Page } from "@playwright/test";

/**
 * A booking, its departure and its conversation, linked (operator audit 5.2),
 * and Back that returns where the operator came from (5.8).
 *
 * Back is still a plain link to a stated place, never history: the opener's
 * address rides in `?from=`, and the screen opened accepts only the portal's
 * own screens from it.
 */

const DEV_CODE = "424242";
const OWNER = "+919000000101";
/** Asha, on the dawn try-dive: a departure with one listing at that minute. */
const ASHA = { booking: "bkg_1", reference: "YV-4K2M9P7Q", slot: "slot_dawn" };

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(OWNER);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

test("a manifest row opens its booking, and the booking's Back returns to the departure", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/today/${ASHA.slot}`);
  const row = page.getByRole("listitem").filter({ hasText: ASHA.reference });
  await row.getByRole("link", { name: "Booking" }).click();

  await page.waitForURL(`**/bookings/${ASHA.booking}?from=*`);
  await expect(
    page.getByRole("link", { name: "Back to the departure" }),
  ).toHaveAttribute("href", `/today/${ASHA.slot}`);
});

test("a booking opens its departure, and Back walks back the way it came", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/bookings/${ASHA.booking}`);
  await page.getByRole("link", { name: /^The departure/ }).click();

  await page.waitForURL(`**/today/${ASHA.slot}?from=*`);
  const back = page.getByRole("link", { name: "Back to the booking" });
  await expect(back).toHaveAttribute("href", `/bookings/${ASHA.booking}`);

  // One step back to the booking, whose own Back is still the list.
  await back.click();
  await page.waitForURL(`**/bookings/${ASHA.booking}`);
  await expect(
    page.getByRole("link", { name: "Back to bookings" }),
  ).toHaveAttribute("href", "/bookings");
});

test("a booking opened from a search goes back to the search", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(`/bookings?q=${ASHA.reference}`);
  await page
    .locator("main")
    .getByRole("link")
    .filter({ hasText: "Asha Menon" })
    .first()
    .click();

  await page.waitForURL(`**/bookings/${ASHA.booking}?from=*`);
  await expect(
    page.getByRole("link", { name: "Back to bookings" }),
  ).toHaveAttribute(
    "href",
    new RegExp(`^/bookings\\?(view=\\w+&)?q=${ASHA.reference}$`),
  );
});

test("a Back address edited to leave the portal goes to the stated place instead", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(
    `/bookings/${ASHA.booking}?from=${encodeURIComponent("https://evil.example/today")}`,
  );
  await expect(
    page.getByRole("link", { name: "Back to bookings" }),
  ).toHaveAttribute("href", "/bookings");

  await page.goto(
    `/today/${ASHA.slot}?from=${encodeURIComponent("//evil.example")}`,
  );
  await expect(
    page.getByRole("link", { name: "Back to the day" }),
  ).toHaveAttribute("href", "/today");
});

test("a conversation opened from Messages goes back to Messages", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/messages");
  await page.locator("li").filter({ hasText: ASHA.reference }).click();
  await page.waitForURL(`**/bookings/${ASHA.booking}?from=*`);
  await expect(
    page.getByRole("link", { name: "Back to messages" }),
  ).toHaveAttribute("href", "/messages");
});
