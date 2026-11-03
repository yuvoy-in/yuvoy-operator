/**
 * What the two builder specs share: the dev code, sign-in, the draft starter,
 * unique names and the map hosts (yuvoy-operator#178).
 */
import { expect, type Page } from "@playwright/test";

export const DEV_CODE = "424242";

export const MAP_HOSTS =
  /^https:\/\/(tiles\.openfreemap\.org|photon\.komoot\.io)\//;

export async function signIn(page: Page, phone = "+919000000101") {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/** A title nothing else in the suite can match. */
export function unique(prefix: string) {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`;
}

/** Step 1, filled in and saved. Returns the draft's id, from the URL. */
export async function startDraft(page: Page, title: string) {
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
