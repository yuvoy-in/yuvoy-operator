/**
 * What the three day specs share: sign-in and the two requests no test answers
 * (yuvoy-operator#178).
 */
import type { Page } from "@playwright/test";

export const DEV_CODE = "424242";

export async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill("+919000000101");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/**
 * Requests that no test answers, so their assertions cannot be raced.
 *
 * Answering mutates state in the Next server process, which both Playwright
 * projects share. The mutating tests below take one fixture each, per project;
 * everything that reads the queue reads these two.
 */
export const NEVER_ANSWERED = {
  urgent: "Reuben Mathai",
  overCeiling: "Tomas Lindqvist",
};
