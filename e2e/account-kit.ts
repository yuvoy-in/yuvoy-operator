/**
 * What the two account specs share: the dev code, sign-in and the two test
 * numbers (yuvoy-operator#178).
 */
import type { Page } from "@playwright/test";

export const DEV_CODE = "424242";

export const OWNER = "+919000000101";

/** Signed up, verified nothing. `bookable: false`, both blockers theirs. */
export const PROSPECT = "+919000000105";

/** Signs in without asserting where it lands — that is the thing under test. */
export async function signIn(page: Page, phone: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
}
