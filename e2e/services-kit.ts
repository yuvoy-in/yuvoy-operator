/**
 * What the three services specs share: sign-in, a listing tile, the openers for
 * a listing and its edit screen, a draft starter and a row
 * (yuvoy-operator#178).
 */
import type { Page } from "@playwright/test";

export const DEV_CODE = "424242";

export async function signIn(page: Page, phone = "+919000000101") {
  await page.goto("/sign-in");
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Your code").fill(DEV_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/today");
}

/**
 * A listing's tile, by its title, wherever tiles are drawn.
 *
 * The accessible name of a tile is its title followed by its badge, so this
 * anchors at the start and stops at a word boundary: "Reef dive" must not also
 * match a "Reef dive 4kf2s" some other test created.
 */
export function tile(page: Page, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return page.getByRole("link", { name: new RegExp(`^${escaped}(?![\\w])`) });
}

/** One listing, as the profile opens it — #58 item 4. */
export async function openListing(page: Page, title: string) {
  await page.goto("/account");
  await tile(page, title).first().click();
  await page.waitForURL(/\/account\/listings\/[^/]+$/);
}

/** Its edit form: the profile, the listing, then Edit — #58 items 4 and 6. */
export async function openEdit(page: Page, title: string) {
  await openListing(page, title);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.waitForURL(/\/edit$/);
}

/**
 * Step 1 of the builder, filled in and saved. Returns the draft's id.
 *
 * `/account/listings/new` is the builder's first step since #58 item 7, and the
 * one-screen create form it replaced is deleted. Everything that used to fill
 * that form in one go now fills Basics and walks on.
 */
export async function startDraft(
  page: Page,
  title: string,
  category = "adventure",
) {
  await page.goto("/account/listings/new");
  await page.getByLabel("Name", { exact: true }).fill(title);
  await page.getByLabel("Category", { exact: true }).selectOption(category);
  await page.getByLabel("Where it runs").selectOption("andaman/havelock");
  await page.getByRole("button", { name: "Next" }).click();
  await page.waitForURL(/\/account\/listings\/[^/]+\/edit\?step=selling/);
  return /\/listings\/([^/]+)\/edit/.exec(page.url())?.[1] ?? "";
}

/**
 * The one row the edit screen draws.
 *
 * Scoped to `main`, because on the desktop project the primary nav is a rail of
 * list items and `getByRole("listitem").first()` matches "Today" in it. That is
 * the shape of bug that passes on one project and fails on the other, which is
 * the worst way for a check to be wrong.
 */
export function row(page: Page) {
  return page.getByRole("main").getByRole("listitem").first();
}
