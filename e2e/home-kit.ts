/**
 * What the two home and listing hub specs share: the dev code, sign-in, the two
 * test numbers, today and the needs-you list (yuvoy-operator#178).
 */
import type { Page } from "@playwright/test";

export const DEV_CODE = "424242";

export const OWNER = "+919000000101";

/** Arun, STAFF: gets the day and nothing to change. */
export const STAFF = "+919000000103";

export async function signIn(page: Page, phone = OWNER) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

export const needsYou = (page: Page) =>
  page.getByRole("region", { name: "Needs you" });

export const today = (page: Page) =>
  page.getByRole("region", { name: /^Today · \d+ departures? · \d+ guests?$/ });
