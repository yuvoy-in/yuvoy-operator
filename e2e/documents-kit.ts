/**
 * What the two documents and notifications specs share: the dev code, sign-in
 * and the owner number (yuvoy-operator#178).
 */
import type { Page } from "@playwright/test";

export const DEV_CODE = "424242";

export const OWNER = "+919000000101";

export async function signIn(page: Page, phone = OWNER) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}
